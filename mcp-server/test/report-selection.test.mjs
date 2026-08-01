/**
 * report_selection: the dual-write, and the one thing it must never do.
 *
 * The endpoint still REQUIRES a non-empty `chosen` and ignores unknown fields, so the client
 * sends the rich `outcomes` map AND a legacy pair derived from it. The derivation has exactly
 * one dangerous failure mode: `chosen: "None"` is not "I don't know", it is the assertion that
 * every candidate shown was wrong — a hard negative in the label flywheel. Emitting it because
 * the map arrived as a JSON string, or carried the word "Used" instead of "Read", records the
 * opposite of what happened for a wish the catalog answered.
 *
 * So the rules under test: "None" only when every label read as a Reject; a near-miss word is
 * read as the outcome it obviously is; and anything genuinely unreadable reports NOTHING at all
 * (reporting is advisory — index.mjs turns the throw into {reported:false, note}). Asserted
 * against a real local server on the actual POST body, not on the client's own return value.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      /* recorded as {} — assertions will say so */
    }
    seen.push({ url: req.url, body: parsed });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, chosen: parsed.chosen }));
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
process.env.SKILLFED_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.SKILLFED_TENANT = "test-tenant";

const { federation } = await import("../federation.mjs");

after(() => server.close());

/** Report once and hand back what actually hit the wire. */
async function send(args) {
  seen.length = 0;
  const res = await federation.reportSelection("q_1", args);
  assert.equal(seen.length, 1, "exactly one POST");
  assert.equal(seen[0].url, "/report_selection");
  return { sent: seen[0].body, res };
}

/** Assert the call refuses AND that nothing was recorded. */
async function refuses(args, why) {
  seen.length = 0;
  await assert.rejects(() => federation.reportSelection("q_1", args), Error, why);
  assert.equal(seen.length, 0, `${why}: something still reached the endpoint`);
}

test("a Read is a hit — chosen is the skill that was read, never None", async () => {
  const { sent } = await send({
    outcomes: {
      "own/seo-audit": ["Read", "current checklist; used its 3 canonical checks"],
      "agg/mirror": ["Reject", "vendored duplicate"],
    },
  });
  assert.equal(sent.chosen, "own/seo-audit");
  assert.deepEqual(sent.rejected, ["agg/mirror"]);
});

test("an Install outranks a Read; the first Read wins among Reads", async () => {
  const install = await send({
    outcomes: { "a/read": ["Read", "ok"], "b/install": ["Install", "keeping it"] },
  });
  assert.equal(install.sent.chosen, "b/install");

  const reads = await send({
    outcomes: { "a/first": ["Read", "most useful"], "b/second": ["Read", "also fine"] },
  });
  assert.equal(reads.sent.chosen, "a/first", "the tool asks for most-useful-first ordering");
});

test('"None" is reported only when every candidate was genuinely rejected', async () => {
  const { sent } = await send({
    outcomes: { "a/x": ["Reject", "wrong framework"], "b/y": ["Reject", "abandoned"] },
  });
  assert.equal(sent.chosen, "None");
  assert.deepEqual(sent.rejected, ["a/x", "b/y"]);
});

test("the rich map is dual-written alongside the legacy pair", async () => {
  const { sent } = await send({
    outcomes: { "a/x": ["Read", "why a"], "b/y": ["Reject", "why b"] },
  });
  assert.deepEqual(Object.keys(sent).sort(), ["chosen", "outcomes", "query_id", "rejected", "tenant"]);
  assert.deepEqual(sent.outcomes, { "a/x": ["Read", "why a"], "b/y": ["Reject", "why b"] });
  assert.equal(sent.query_id, "q_1");
});

test("an outcomes map serialized as a JSON STRING is parsed, not discarded", async () => {
  // Expected mistake: the sibling `sketch` field is documented over and over as a STRING.
  const { sent } = await send({
    outcomes: JSON.stringify({ "a/x": ["Read", "helped"], "b/y": ["Reject", "no"] }),
  });
  assert.equal(sent.chosen, "a/x");
  assert.deepEqual(sent.outcomes, { "a/x": ["Read", "helped"], "b/y": ["Reject", "no"] });
});

test("an unusable outcomes map reports NOTHING — it never degrades to chosen:None", async () => {
  // The regression this file exists for: each of these used to POST chosen:"None", i.e. "every
  // candidate was wrong", and come back reported:true.
  for (const bad of [
    [["a/x", "Read"]], // an array, not a map
    "not json at all",
    "[1,2,3]", // parses, but not to an object
    42,
    {}, // empty map
    "",
  ]) {
    await refuses({ outcomes: bad }, `outcomes=${JSON.stringify(bad)}`);
  }
});

test("a near-miss outcome word is read as a hit, not as a total rejection", async () => {
  for (const word of ["Used", "read it", "Consulted", "useful", "applied", "installed"]) {
    const { sent } = await send({ outcomes: { "a/x": [word, "why"] } });
    assert.equal(sent.chosen, "a/x", `"${word}" collapsed into ${sent.chosen}`);
    assert.deepEqual(sent.rejected, []);
    // the agent's own word survives verbatim — the projection is for the legacy pair only
    assert.deepEqual(sent.outcomes["a/x"], [word, "why"]);
  }
});

test("a genuinely unreadable label refuses rather than inventing a rejection", async () => {
  await refuses({ outcomes: { "a/x": ["Maybe", "hm"] } }, "unreadable label");
  await refuses({ outcomes: { "a/x": ["¯\\_(ツ)_/¯", ""] } }, "unreadable label 2");
});

test("an explicit chosen overrides an unreadable map, and the drop is disclosed", async () => {
  const { sent, res } = await send({ outcomes: [1, 2], chosen: "a/x", rejected: ["b/y"] });
  assert.equal(sent.chosen, "a/x");
  assert.deepEqual(sent.rejected, ["b/y"]);
  assert.equal("outcomes" in sent, false, "an unreadable map must not be forwarded");
  assert.match(res.note, /outcomes/, "the dropped map has to be said out loud");
});

test("the legacy-only payload still works — no outcomes at all", async () => {
  const { sent } = await send({ chosen: "a/x", rejected: ["b/y", "c/z"] });
  assert.deepEqual(sent, {
    tenant: "test-tenant",
    query_id: "q_1",
    chosen: "a/x",
    rejected: ["b/y", "c/z"],
  });
});

test("a call carrying no information at all reports nothing", async () => {
  await refuses({}, "no outcomes and no chosen");
  await refuses(undefined, "no argument");
  await refuses({ chosen: "   " }, "blank chosen");
});

test("reasoning is coerced to a string and a bare label is accepted", async () => {
  const { sent } = await send({ outcomes: { "a/x": "Read", "b/y": ["Reject"] } });
  assert.deepEqual(sent.outcomes, { "a/x": ["Read", ""], "b/y": ["Reject", ""] });
  assert.equal(sent.chosen, "a/x");
});
