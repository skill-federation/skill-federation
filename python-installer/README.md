# skillfed (Python installer)

No-clone installer for [Skill Federation](https://github.com/skill-federation/skill-federation).
Drops the curl-tier finder skill + `/skillfed` command into `~/.claude` (or `./.claude`).

```bash
uvx skillfed                  # curl tier, user scope (~/.claude)
uvx skillfed --with-hook      # + plan-approval nudge
uvx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
uvx skillfed --scope project  # install into ./.claude

# or, with pipx:
pipx run skillfed
```

Then **restart Claude Code** and run `/skillfed <what you're trying to do>`.

Stdlib only, zero dependencies. The runtime finder itself needs just `curl`. This package is one
of three install paths — see the project README for the curl bootstrap and `npx skillfed`.

## Build (maintainers)

```bash
node ../scripts/vendor-payload.mjs   # vendor the 3 payload files into src/skillfed/payload/
python -m build                      # sdist + wheel in dist/
```
