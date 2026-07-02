# Contributing to Skill Federation

Thanks for helping make skill discovery private and trustworthy. There are three main ways to
contribute — and they're deliberately different, because the catalog is not the code.

## Ways to contribute

### 1. Report a bug or request a feature
Open an [issue](https://github.com/skill-federation/skill-federation/issues). For bugs, include
your OS, install tier (curl / `npx` / `uvx` / MCP), and the exact command you ran. For the finder,
the wish-list JSON and the `search_wishlist.py` output (redact anything you consider sensitive —
though by design the wishes carry no task content) help a lot.

### 2. Suggest a skill for the catalog
The catalog is **not** edited by pull request. Skills are ingested, de-duplicated, and
**scanned before promotion** (see [Security](SECURITY.md)) — that gate is the whole point, so new
skills can't be added by merging a file. To propose one, open an issue with the **`skill-suggestion`**
label and link the upstream `SKILL.md`. We fetch a copy, scan it, and promote it only if it passes.
If you maintain a skill and want its **license** recorded (many upstream skills declare none), say
so — a declared license is what lets us serve it with clean attribution.

### 3. Improve the code or an integration
The finder, installers, and MCP server live here and *do* take pull requests. See below.

## Development setup

No build step for the core finder — it's Python standard library only.

```
integrations/search_wishlist.py   the wish-list finder (async fan-out search)
integrations/skillfed_client.py   the client seam (hosted endpoint or local core)
integrations/local_skills.py      installed-skill detection + candidate filtering
installer/                        npm package `skillfed`   (npx no-clone path)
python-installer/                 PyPI package `skillfed`  (uvx / pipx path)
mcp-server/                       optional typed MCP tools (`skillfed-mcp`)
scripts/vendor-payload.mjs        vendors the payload into both packages (single source of truth)
```

Point the client at a federation endpoint and run a wish-list:

```bash
export SKILLFED_ENDPOINT="https://your-federation.example.com"   # or the keyless demo default
echo '{"wishlist":[{"name":"pdf","description":"extract tables from PDFs","keywords":["pdf","tables"]}]}' \
  | python integrations/search_wishlist.py -
```

`integrations/sample_wishlist.json` is a ready example.

## Pull request guidelines

- **Keep the privacy floor.** No change may cause the client to send anything beyond the abstract
  wish (description + paraphrased formulations + keywords + capability sketch). The plan, brief,
  file contents, and outputs must never cross the boundary. PRs that widen what's sent will be
  declined on principle, not preference.
- **Preserve the client seam.** Talk to the federation only through `skillfed_client.py` so the
  hosted demo and a local core stay swappable.
- **Match the surrounding style.** Standard-library Python, terse module docstrings, no new
  dependencies in the core finder without discussion.
- **One concern per PR.** Small, reviewable changes merge faster.
- If your change edits the payload, run `scripts/vendor-payload.mjs` so both packages stay in sync.

## Code of conduct

Be respectful and assume good faith. Harassment or bad-faith behavior isn't welcome. Report
conduct concerns via a private [security advisory](SECURITY.md) if you'd rather not use a public
issue.
