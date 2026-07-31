# skillfed (npm installer)

**Find vetted agent skills for your task, mid-flow** — a no-clone installer for
[Skill Federation](https://github.com/skill-federation/skill-federation). Drops the curl-tier
finder skill + `/skillfed` command into Claude Code (`~/.claude` or `./.claude`); only abstract
wishes ever leave your machine. Browse and search the indexed catalog on the web at
[skillfed.io](https://skillfed.io).

```bash
npx skillfed                  # curl tier, user scope (~/.claude)
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
