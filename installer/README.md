# skillfed (npm installer)

**Find vetted agent skills for your task, mid-flow** — a no-clone installer for
[Skill Federation](https://github.com/skill-federation/skill-federation). Drops the curl-tier
finder skill + `/skillfed` command into Claude Code (`~/.claude` or `./.claude`); only abstract
wishes ever leave your machine. Browse and search the indexed catalog on the web at
[skillfed.io](https://skillfed.io).

```bash
npx skillfed                  # curl tier, user scope (~/.claude) — no hooks, and complete without them
npx skillfed --hook end       # + a nudge after a plan is approved  (--hook none|start|end|both)
npx skillfed --harness claude-code   # target harness (default; the only one supported today)
npx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
npx skillfed --scope project  # install into ./.claude
```

Install one published skill by its catalog slug or page URL:

```bash
npx skillfed install owner/repository/skill
npx skillfed install https://skillfed.io/owner/repository/skill --scope project
```

The published-skill path validates the record ID, license, file paths, origin, sizes, and
SHA-256 hashes before writing under `.claude/skills/`. It never executes downloaded content.
Use `--dry-run` to inspect the plan, or `--force` to replace an existing directory while
keeping its previous contents in a `.bak` directory. Unlicensed records require the explicit
`--allow-unlicensed` acknowledgement.

Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just work
normally: the skill carries its own triggers (starting a plan, finishing one, hitting a gap
mid-task), so it offers itself with no hook registered. Hooks are a per-harness convenience that
only repeats those triggers, which is why `--hook none` is the default; `--with-hook` still works
as an alias for `--hook end`.

Zero runtime dependencies (Node ≥18, stdlib only). The finder itself needs just `curl`. This is
one of three install paths — see the project README for the curl bootstrap and `uvx skillfed`.

## Build (maintainers)

`npm pack` / `npm publish` runs `prepack` automatically, which vendors the 6 payload files from
`integrations/claude-code/` into `payload/` via `scripts/vendor-payload.mjs`.
