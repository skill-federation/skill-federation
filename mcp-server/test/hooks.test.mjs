/**
 * Hook payload well-formedness.
 *
 * A hook is a JSON blob a shell command prints to stdout — nothing type-checks it, and a
 * malformed one fails silently in a live session (Claude Code just gets nothing). The
 * expensive mistake is `hookEventName` disagreeing with the event the command is registered
 * under: the payload parses, the hook runs, and the context is dropped on the floor.
 *
 * So: parse both nudges, resolve every command back to a file on disk (through
 * start_nudge.sh's indirection), and assert each payload names the event that invokes it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const PLUGIN_ROOT = path.join(ROOT, "integrations", "claude-code");
const HOOKS_DIR = path.join(PLUGIN_ROOT, "hooks");
const HOOKS_JSON = path.join(HOOKS_DIR, "hooks.json");

const read = (p) => fs.readFileSync(p, "utf8");
const readJSON = (p) => JSON.parse(read(p));

/** Files a hook command names, via ${CLAUDE_PLUGIN_ROOT} (bare or behind file://). */
function referencedFiles(command) {
  const out = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g;
  for (const m of command.matchAll(re)) out.push(path.join(PLUGIN_ROOT, m[1]));
  return out;
}

/** A shell wrapper is not the payload — follow it to the .json it prints. */
function expand(file) {
  if (!file.endsWith(".sh")) return [file];
  const dir = path.dirname(file);
  const code = read(file)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l)) // comments name other files (hooks.json) they never print
    .join("\n");
  const names = new Set([...code.matchAll(/([A-Za-z0-9_-]+\.json)/g)].map((m) => m[1]));
  return [...names].map((n) => path.join(dir, n));
}

/** event name -> payload files reachable from the commands registered under it */
function registrations() {
  const cfg = readJSON(HOOKS_JSON);
  const map = new Map();
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    const payloads = new Set();
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        const direct = referencedFiles(hook.command);
        assert.ok(
          direct.length > 0,
          `${event}: command references no plugin file: ${hook.command}`
        );
        for (const f of direct) for (const p of expand(f)) payloads.add(p);
      }
    }
    map.set(event, [...payloads]);
  }
  return map;
}

test("hooks.json parses and carries a description", () => {
  const cfg = readJSON(HOOKS_JSON);
  assert.equal(typeof cfg.description, "string");
  assert.ok(cfg.description.trim().length > 0);
  assert.equal(typeof cfg.hooks, "object");
  assert.ok(Object.keys(cfg.hooks).length >= 1);
});

test("every registered command references a file that exists", () => {
  const cfg = readJSON(HOOKS_JSON);
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    for (const entry of entries) {
      assert.ok(Array.isArray(entry.hooks), `${event}: entry has no hooks[]`);
      for (const hook of entry.hooks) {
        assert.equal(hook.type, "command", `${event}: unsupported hook type ${hook.type}`);
        assert.ok(Number.isInteger(hook.timeout), `${event}: hook needs an integer timeout`);
        for (const f of referencedFiles(hook.command)) {
          assert.ok(fs.existsSync(f), `${event}: command points at a missing file: ${f}`);
          for (const p of expand(f)) {
            assert.ok(fs.existsSync(p), `${event}: ${path.basename(f)} prints a missing ${p}`);
          }
        }
      }
    }
  }
});

test("both nudges parse, and hookEventName equals the event they are registered under", () => {
  const reg = registrations();
  let checked = 0;
  for (const [event, payloads] of reg) {
    assert.ok(payloads.length > 0, `${event}: no payload file reachable`);
    for (const p of payloads) {
      const payload = readJSON(p); // throws on malformed JSON — that is the assertion
      const out = payload.hookSpecificOutput;
      assert.ok(out, `${path.basename(p)}: no hookSpecificOutput`);
      assert.equal(
        out.hookEventName,
        event,
        `${path.basename(p)} says "${out.hookEventName}" but is registered under "${event}"`
      );
      assert.equal(typeof out.additionalContext, "string");
      assert.ok(
        out.additionalContext.trim().length > 0,
        `${path.basename(p)}: empty additionalContext`
      );
      checked++;
    }
  }
  assert.equal(checked, 2, "expected exactly two nudge payloads (start + end)");
});

test("both nudge files are registered — neither is dead weight", () => {
  const reachable = new Set([...registrations().values()].flat().map((p) => path.basename(p)));
  assert.ok(reachable.has("plan_nudge.json"), "end-of-plan nudge is not registered");
  assert.ok(reachable.has("plan_start_nudge.json"), "start-of-plan nudge is not registered");
});

test("the two nudge filenames cannot cross-match by substring", () => {
  // All four installers detect prior registration by substring-matching the filename. If one
  // name ever contains the other, installing one mode silently suppresses the other.
  const a = "plan_nudge.json";
  const b = "plan_start_nudge.json";
  assert.equal(a.includes(b), false);
  assert.equal(b.includes(a), false);
});

test("the UserPromptSubmit hook self-gates on plan mode", () => {
  // That event fires on EVERY prompt. Without the gate the nudge is injected constantly.
  const sh = read(path.join(HOOKS_DIR, "start_nudge.sh"));
  assert.match(sh, /permission_mode/, "no permission_mode gate in start_nudge.sh");
  assert.match(sh, /exit 0/, "the gate must exit 0 (silent), never non-zero");
  assert.match(sh, /^#!\/bin\/sh/, "needs a shebang: installers run it via sh, plus chmod +x");

  const cfg = readJSON(HOOKS_JSON);
  const ups = cfg.hooks.UserPromptSubmit;
  assert.ok(ups, "no UserPromptSubmit registration");
  for (const entry of ups) {
    assert.equal("matcher" in entry, false, "UserPromptSubmit takes no matcher — omit the key");
    for (const hook of entry.hooks) {
      assert.ok(hook.timeout <= 30, "UserPromptSubmit caps the timeout at 30s");
    }
  }
});

test("the end-of-plan hook is still matched on ExitPlanMode", () => {
  const cfg = readJSON(HOOKS_JSON);
  const post = cfg.hooks.PostToolUse;
  assert.ok(post, "no PostToolUse registration");
  assert.ok(
    post.some((e) => e.matcher === "ExitPlanMode"),
    "PostToolUse must be matched on ExitPlanMode, or it fires after every tool call"
  );
});
