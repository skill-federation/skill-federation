# skillfed (Python installer)

**Find vetted agent skills for your task, mid-flow** — a no-clone installer for
[Skill Federation](https://github.com/skill-federation/skill-federation). Drops the curl-tier
finder skill + `/skillfed` command into Claude Code (`~/.claude` or `./.claude`); only abstract
wishes ever leave your machine. Browse and search the indexed catalog on the web at
[skillfed.io](https://skillfed.io).

```bash
uvx skillfed                  # curl tier, user scope (~/.claude) — no hooks, and complete without them
uvx skillfed --hook end       # + a nudge after a plan is approved  (--hook none|start|end|both)
uvx skillfed --harness claude-code   # target harness (default; the only one supported today)
uvx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
uvx skillfed --scope project  # install into ./.claude

# or, with pipx:
pipx run skillfed
```

Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just work
normally: the skill carries its own triggers (starting a plan, finishing one, hitting a gap
mid-task), so it offers itself with no hook registered. Hooks are a per-harness convenience that
only repeats those triggers, which is why `--hook none` is the default; `--with-hook` still works
as an alias for `--hook end`.

Stdlib only, zero dependencies. The runtime finder itself needs just `curl`. This package is one
of three install paths — see the project README for the curl bootstrap and `npx skillfed`.

## Build (maintainers)

```bash
node ../scripts/vendor-payload.mjs   # vendor the 6 payload files into src/skillfed/payload/
python -m build                      # sdist + wheel in dist/
```
