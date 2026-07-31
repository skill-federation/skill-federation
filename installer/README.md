# skillfed

**Find vetted agent skills for your task, mid-flow.** Try a live
[Skill Federation](https://github.com/skill-federation/skill-federation) search without
installing anything:

```bash
npx skillfed find "optimize a slow PostgreSQL query using EXPLAIN and indexes"
```

The command reads no project files. It sends only the exact text inside the quotes, so keep it
capability-level and do not include code, secrets, customer data, or private task context.

Running `npx skillfed` with no command installs the curl-tier finder skill and `/skillfed`
command into Claude Code (`~/.claude` or `./.claude`):

```bash
npx skillfed                  # install, user scope (~/.claude)
npx skillfed --with-hook      # + plan-approval nudge
npx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
npx skillfed --scope project  # install into ./.claude
```

Then **restart Claude Code** and run `/skillfed <what you're trying to do>`.

Zero runtime dependencies (Node ≥18, stdlib only). The finder itself needs just `curl`. This is
one of three install paths — see the project README for the curl bootstrap and `uvx skillfed`.

## Build (maintainers)

`npm pack` / `npm publish` runs `prepack` automatically, which vendors the 3 payload files from
`integrations/claude-code/` into `payload/` via `scripts/vendor-payload.mjs`.
