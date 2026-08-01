/**
 * The four installers' hook registrations — the same guard hooks.test.mjs applies to the
 * plugin's hooks.json, applied to the places that actually write a user's settings.json.
 *
 * hooks.test.mjs proves the PLUGIN wiring. But `install.sh`, `install.ps1`, `installer/cli.mjs`
 * and `python-installer/.../cli.py` each carry their OWN copy of the (event, matcher, needle,
 * command, timeout) tuple as static string literals, and nothing checked them. The expensive
 * mistake is the one hooks.test.mjs names: `hookEventName` disagreeing with the event the
 * command is registered under — the payload parses, the hook runs, and Claude Code drops the
 * context on the floor. Four hand-maintained copies is four chances to introduce it.
 *
 * The second guard is the idempotency needle. Every installer detects prior registration by
 * substring-matching a filename against the stored command. If a needle is not a substring of
 * its OWN command, the installer re-registers on every run; if it is a substring of the OTHER
 * one, installing one mode silently suppresses the other.
 *
 * Parsed out of the sources, never executed — running four installers in four languages to
 * assert on string literals would test the harness, not the literals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const HOOKS_DIR = path.join(ROOT, "integrations", "claude-code", "hooks");

const read = (p) => fs.readFileSync(p, "utf8");

// event -> what the installer must pair with it. `payload` is the JSON that ultimately reaches
// Claude Code: the start command runs start_nudge.sh, which cats plan_start_nudge.json.
const EXPECTED = {
  UserPromptSubmit: { needle: "start_nudge.sh", payload: "plan_start_nudge.json", matcher: "" },
  PostToolUse: { needle: "plan_nudge.json", payload: "plan_nudge.json", matcher: "ExitPlanMode" },
};

/** Everything between each occurrence of `delim` and the next (or EOF). */
function chunks(src, delim) {
  const parts = src.split(delim);
  return parts.slice(1);
}

const first = (re, s, fallback = "") => {
  const m = re.exec(s);
  return m ? m[1] : fallback;
};

/** install.sh — `register_entry <event> <matcher> <needle> "$CMD_VAR" <timeout> <label>` */
function fromShell() {
  const src = read(path.join(ROOT, "install.sh"));
  const vars = Object.fromEntries(
    [...src.matchAll(/^\s*(START_CMD|END_CMD)="(.*)"$/gm)].map((m) => [m[1], m[2]])
  );
  const regs = [
    ...src.matchAll(/register_entry\s+(\w+)\s+(\S+)\s+(\S+)\s+"\$(\w+)"\s+(\d+)/g),
  ];
  return regs.map((m) => ({
    event: m[1],
    matcher: m[2].replace(/"/g, ""),
    needle: m[3],
    command: vars[m[4]] ?? "",
    timeout: Number(m[5]),
  }));
}

/** install.ps1 — `$entries += ,@(label, event, needle, matcher, (command), timeout)` */
function fromPowerShell() {
  const src = read(path.join(ROOT, "install.ps1"));
  const vars = Object.fromEntries(
    [...src.matchAll(/\$(\w+)\s*=\s*\(Join-Path \$skillDir '([^']+)'\)/g)].map((m) => [m[1], m[2]])
  );
  return [...src.matchAll(/\$entries \+= ,@\((.*)\)\s*$/gm)].map((m) => {
    const strs = [...m[1].matchAll(/'([^']*)'/g)].map((s) => s[1]);
    const refs = [...m[1].matchAll(/\$(\w+)/g)].map((r) => vars[r[1]] ?? `$${r[1]}`);
    return {
      event: strs[1],
      needle: strs[2],
      matcher: strs[3],
      // the command is built by concatenation: literal fragments + the resolved path variable
      command: [...strs.slice(4), ...refs].join(" "),
      timeout: Number(first(/,\s*(\d+)\s*$/, m[1], "0")),
    };
  });
}

/** installer/cli.mjs — one object literal per `out.push({ … })` */
function fromNode() {
  const src = read(path.join(ROOT, "installer", "cli.mjs"));
  const vars = Object.fromEntries(
    [...src.matchAll(/const (\w+) = join\(skillDir, '([^']+)'\)/g)].map((m) => [m[1], m[2]])
  );
  return chunks(src, "out.push({").map((c) => ({
    event: first(/event:\s*'([^']+)'/, c),
    needle: first(/needle:\s*'([^']+)'/, c),
    matcher: first(/matcher:\s*'([^']+)'/, c),
    command: first(/command:\s*`([^`]+)`/, c).replace(
      /\$\{(\w+)\}/g,
      (_, v) => vars[v] ?? `\${${v}}`
    ),
    timeout: Number(first(/timeout:\s*(\d+)/, c, "0")),
  }));
}

/** python-installer cli.py — one dict per `out.append({ … })` */
function fromPython() {
  const src = read(path.join(ROOT, "python-installer", "src", "skillfed", "cli.py"));
  const vars = Object.fromEntries(
    [...src.matchAll(/(\w+) = str\(skill_dir \/ "([^"]+)"\)/g)].map((m) => [m[1], m[2]])
  );
  return chunks(src, "out.append({").map((c) => ({
    event: first(/"event":\s*"([^"]+)"/, c),
    needle: first(/"needle":\s*"([^"]+)"/, c),
    matcher: first(/"matcher":\s*"([^"]+)"/, c),
    command: first(/"command":\s*f?'([^']*)'/, c).replace(
      /\{(\w+)\}/g,
      (_, v) => vars[v] ?? `{${v}}`
    ),
    timeout: Number(first(/"timeout":\s*(\d+)/, c, "0")),
  }));
}

const INSTALLERS = {
  "install.sh": fromShell,
  "install.ps1": fromPowerShell,
  "installer/cli.mjs": fromNode,
  "python-installer/src/skillfed/cli.py": fromPython,
};

test("every installer registers exactly the two known events, once each", () => {
  for (const [name, parse] of Object.entries(INSTALLERS)) {
    const entries = parse();
    assert.equal(entries.length, 2, `${name}: parsed ${entries.length} registrations, expected 2`);
    assert.deepEqual(
      entries.map((e) => e.event).sort(),
      ["PostToolUse", "UserPromptSubmit"],
      `${name}: registered events`
    );
  }
});

test("each event is paired with ITS OWN command, in every installer", () => {
  for (const [name, parse] of Object.entries(INSTALLERS)) {
    for (const e of parse()) {
      const want = EXPECTED[e.event];
      assert.ok(want, `${name}: unknown event ${e.event}`);
      assert.equal(e.needle, want.needle, `${name}: ${e.event} probes the wrong filename`);
      assert.ok(
        e.command.includes(want.needle),
        `${name}: ${e.event} command does not name ${want.needle} — ` +
          `the idempotency check can never match, so every re-run re-registers it. Got: ${e.command}`
      );
      const other = Object.values(EXPECTED).find((x) => x.needle !== want.needle).needle;
      assert.equal(
        e.command.includes(other),
        false,
        `${name}: ${e.event} command also contains ${other} — the two checks cross-match`
      );
    }
  }
});

test("the payload each command prints declares the event it is registered under", () => {
  // The mistake this whole file exists for: hookEventName disagreeing with the registered
  // event. The payload parses, the hook runs, and the context is silently discarded.
  for (const [name, parse] of Object.entries(INSTALLERS)) {
    for (const e of parse()) {
      const file = path.join(HOOKS_DIR, EXPECTED[e.event].payload);
      const payload = JSON.parse(read(file));
      assert.equal(
        payload.hookSpecificOutput.hookEventName,
        e.event,
        `${name}: registers ${path.basename(file)} under ${e.event}, but the file says ` +
          `"${payload.hookSpecificOutput.hookEventName}"`
      );
    }
  }
});

test("matcher: ExitPlanMode on PostToolUse, and no matcher at all on UserPromptSubmit", () => {
  for (const [name, parse] of Object.entries(INSTALLERS)) {
    for (const e of parse()) {
      assert.equal(
        e.matcher || "",
        EXPECTED[e.event].matcher,
        `${name}: ${e.event} matcher. PostToolUse without ExitPlanMode fires after every tool ` +
          `call; UserPromptSubmit has no tool name to match on, so the key must be omitted`
      );
    }
  }
});

test("timeouts are sane, and UserPromptSubmit stays under its 30s cap", () => {
  for (const [name, parse] of Object.entries(INSTALLERS)) {
    for (const e of parse()) {
      assert.ok(Number.isInteger(e.timeout) && e.timeout > 0, `${name}: ${e.event} timeout`);
      if (e.event === "UserPromptSubmit") {
        assert.ok(e.timeout <= 30, `${name}: UserPromptSubmit caps the timeout at 30s`);
      }
    }
  }
});

test("all four installers agree, tuple for tuple", () => {
  const norm = (parse) =>
    parse()
      .map((e) => `${e.event}|${e.matcher || ""}|${e.needle}|${e.timeout}`)
      .sort();
  const [ref, ...rest] = Object.entries(INSTALLERS);
  const expected = norm(ref[1]);
  for (const [name, parse] of rest) {
    assert.deepEqual(norm(parse), expected, `${name} drifted from ${ref[0]}`);
  }
});

test("install.sh's no-python fallback prints the same pairing it would have written", () => {
  // The fallback echoes a paste-in snippet when there is no interpreter to merge JSON. It is a
  // fifth hand-written copy of the tuple, and a wrong one silently teaches the user the bug.
  const src = read(path.join(ROOT, "install.sh"));
  const vars = Object.fromEntries(
    [...src.matchAll(/^\s*(START_CMD_JSON|END_CMD_JSON)='?(.*?)'?$/gm)].map((m) => [m[1], m[2]])
  );
  const start = /hooks\.UserPromptSubmit\s*\+=(.*)$/m.exec(src);
  const end = /hooks\.PostToolUse\s*\+=(.*)$/m.exec(src);
  assert.ok(start && end, "the no-python fallback no longer prints both snippets");
  assert.match(start[1], /START_CMD_JSON/);
  assert.match(end[1], /END_CMD_JSON/);
  assert.match(vars.START_CMD_JSON, /start_nudge\.sh/);
  assert.match(vars.END_CMD_JSON, /plan_nudge\.json/);
  assert.match(end[1], /ExitPlanMode/, "the pasted PostToolUse entry needs its matcher");
  assert.equal(/matcher/.test(start[1]), false, "the pasted UserPromptSubmit entry takes no matcher");
});
