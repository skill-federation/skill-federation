# Publishing the installer packages

Two packages give Skill Federation its no-clone install paths:

| Package | Registry | Dir | Invocation |
|---|---|---|---|
| `skillfed` | npm | [`installer/`](installer/) | `npx skillfed` |
| `skillfed` | PyPI | [`python-installer/`](python-installer/) | `uvx skillfed` / `pipx run skillfed` |
| `skillfed-mcp` | npm | [`mcp-server/`](mcp-server/) | registered by `--with-npx` as `npx -y skillfed-mcp` |

> [!NOTE]
> **Status — v0.1.0 is live.** `skillfed` (npm + PyPI) and `skillfed-mcp` (npm) are all
> published, and the curl/`irm` bootstrap is served from `main`. The release pipeline is
> **tokenless OIDC** for every future version, so this doc is now the **release runbook** for
> v0.2.0 onward — the first-release bootstrap is preserved below as history.

> The **curl bootstrap** (`irm|iex`, `curl|bash`) needs no publishing — it's live, served from
> `install.ps1`/`install.sh` on `main`. Publishing only powers the `npx`/`uvx` lines.

**The GitHub Actions pipeline below releases new versions** — the cloud builds and publishes via
OIDC, so you need no local Node/Python and no tokens. The manual sections are a runtime-equipped
fallback.

---

## CI pipeline — release by pushing a tag (recommended)

Two workflows publish on any `v*` tag (or manual *Run workflow*):
[`.github/workflows/release-pypi.yml`](.github/workflows/release-pypi.yml) and
[`release-npm.yml`](.github/workflows/release-npm.yml).

Both registries publish **tokenless via OIDC**. (PyPI was tokenless from the start via a pending
publisher; npm became tokenless after v0.1.0, since npm only lets you configure Trusted Publishing
*after* a package's first version — [npm docs](https://docs.npmjs.com/trusted-publishers/).)

### Release a new version

```bash
# 1. bump the version in all four manifests:
#    installer/package.json · python-installer/pyproject.toml ·
#    mcp-server/package.json · integrations/claude-code/.claude-plugin/plugin.json
# 2. tag + push:
git tag v0.2.0
git push origin v0.2.0          # both workflows fire; watch the Actions tab
```

Then smoke-test: `npx -y skillfed@latest --help` and `uvx skillfed --help`.

> [!IMPORTANT]
> If you also publish to the **MCP Registry** (§4), keep `mcp-server/server.json` in lockstep:
> its top-level `version` **and** `packages[0].version` must equal the `skillfed-mcp` version you
> just published to npm. The registry rejects a `server.json` whose npm version isn't live.

<details>
<summary>How v0.1.0 was first bootstrapped (history + remaining cleanup)</summary>

One-time setup, already done:
1. Pushed the repo + workflows to GitHub.
2. **PyPI pending publisher** (tokenless) — pypi.org → *Publishing* → *Add a pending publisher*:
   project `skillfed`, owner `skill-federation`, repo `skill-federation`, workflow
   `release-pypi.yml`, environment blank.
3. **npm bootstrap token** — a granular token with **bypass-2FA** + **All packages** + read/write,
   stored as the `NPM_TOKEN` GitHub secret, published v0.1.0. (npm's `EOTP` error means the token
   is missing the bypass-2FA flag.)

**Final cleanup → npm tokenless forever** (the workflow is already on the OIDC form — npm ≥ 11.5.1,
no `NODE_AUTH_TOKEN`):
1. npmjs.com → each package (`skillfed`, `skillfed-mcp`) → **Settings → Trusted Publisher** → add
   GitHub Actions (repo `skill-federation/skill-federation`, workflow `release-npm.yml`).
2. Delete the `NPM_TOKEN` secret and the bootstrap token.

</details>

---

## Manual fallback

You need a machine with **Node ≥18** (for the npm packages) and **Python ≥3.9 + `uv` or
`pip`** (for the PyPI package). This repo's dev box has neither, so run the steps below
elsewhere.

### 0. One-time prep

```bash
# from the repo root, vendor the 3 payload files into both packages
node scripts/vendor-payload.mjs
```

`npm publish` runs this automatically (via `installer/`'s `prepack`), but the Python build does
**not** — so always run it before `python -m build`.

Both packages are at version `0.1.0`. A registry refuses to overwrite an existing version, so
**bump the version** (in `package.json` / `pyproject.toml`) before every re-publish.

---

## 1. npm — `skillfed` (manual)

### Check the name
```bash
npm view skillfed            # "npm error 404 ... is not in this registry" = available
```

### Account + auth (one-time)
1. Create an account at <https://www.npmjs.com/signup> (skip if you have one).
2. Enable 2FA: npmjs.com → avatar → **Access Tokens** / **Account** → Two-Factor Auth →
   choose **Authorization and Publishing** (npm requires 2FA for publish by default).
3. Log in from the terminal:
   ```bash
   npm login            # opens a browser / prompts for OTP
   npm whoami           # confirms you're authenticated
   ```

### Dry-run, then publish
```bash
cd installer
npm publish --dry-run    # runs prepack (vendors payload) + lists the exact files that ship
# review the file list: it MUST include cli.mjs + payload/SKILL.md, plan_nudge.json, skillfed.md
npm publish              # unscoped public name → no --access flag needed; enter your 2FA OTP
```

### Verify
```bash
npm view skillfed
npx -y skillfed@latest --help     # should print usage and exit
```

### Also publish `skillfed-mcp`
`--with-npx` registers `npx -y skillfed-mcp` (published, so npx fetches it on first run). To
re-publish it manually:
```bash
cd ../mcp-server
npm publish --dry-run
npm publish
```

---

## 2. PyPI — `skillfed` (manual)

### Check the name
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/skillfed/json   # 404 = available
```

### Account + token (one-time)
1. Create an account at <https://pypi.org/account/register/> and **verify your email**.
2. Enable 2FA (PyPI mandates it): Account settings → **Two factor authentication**.
3. Create an API token: Account settings → **API tokens** → *Add API token*. For the first
   upload (the project doesn't exist yet) scope it to **"Entire account"**; after the first
   release, create a new token scoped to just the `skillfed` project and delete the broad one.
   Copy the token (`pypi-…`) — it's shown once.

### Build
```bash
# from repo root
node scripts/vendor-payload.mjs          # MUST run first — payload is git-ignored
pip install --upgrade build twine        # or use uv: `uv tool install twine`
cd python-installer
python -m build                          # writes dist/skillfed-0.1.0.tar.gz + .whl
twine check dist/*                       # validates metadata + README rendering
```

### Test on TestPyPI first (recommended)
```bash
twine upload --repository testpypi dist/*
#   username: __token__     password: <your TestPyPI token>  (separate account at test.pypi.org)
uvx --index-url https://test.pypi.org/simple/ --from skillfed skillfed --help
```

### Publish to real PyPI
```bash
twine upload dist/*
#   username: __token__     password: pypi-<your token>
```

### Verify
```bash
uvx skillfed --help          # or:  pipx run skillfed --help
```

---

## 3. Post-publish

- Smoke-test every advertised line in the README: `npx skillfed`, `uvx skillfed`,
  `pipx run skillfed`, and the curl/`irm` bootstrap.
- Tag the release (`git tag v0.1.0 && git push --tags`).
- Future releases: bump the version, re-run `node scripts/vendor-payload.mjs`, rebuild, re-publish.

---

## 4. MCP Registry — `skillfed-mcp` (registry.modelcontextprotocol.io)

Lists `skillfed-mcp` in the **official MCP registry**, which MCP clients query for server discovery.
The registry stores only metadata — it validates against the **published npm package**, so the npm
release must land *first*.

Already committed to the repo (no action needed each release, just keep versions in sync):
- [`mcp-server/server.json`](mcp-server/server.json) — the registry manifest
  (`name: io.github.skill-federation/skillfed-mcp`).
- `mcpName` field in [`mcp-server/package.json`](mcp-server/package.json) — the registry matches
  this against `server.json`'s `name` to prove ownership. **It must ship inside the published npm
  tarball**, so it's committed alongside the version bump.

### One-time / per-release steps (interactive — needs GitHub auth)

```bash
# 1. Publish skillfed-mcp to npm WITH the mcpName field (via the normal tag pipeline in §"CI
#    pipeline", or manually per §1). Confirm the field made it into the tarball:
npm view skillfed-mcp@<version> mcpName        # → io.github.skill-federation/skillfed-mcp

# 2. Install the mcp-publisher CLI (Windows PowerShell):
$arch = if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") {"arm64"} else {"amd64"}
Invoke-WebRequest "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile mcp-publisher.tar.gz
tar xf mcp-publisher.tar.gz mcp-publisher.exe   # then put mcp-publisher.exe on PATH

# 3. Authenticate. The io.github.skill-federation/ namespace requires the GitHub account you log in
#    with to be a member of the skill-federation org (device-flow):
mcp-publisher login github

# 4. Publish (reads mcp-server/server.json):
cd mcp-server
mcp-publisher publish

# 5. Verify:
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.skill-federation/skillfed-mcp"
```

> Optional: automate step 4 in `release-npm.yml` after the npm publish — the registry ships an
> official GitHub Action so future releases update the registry entry automatically.
