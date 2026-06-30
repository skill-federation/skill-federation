# Publishing the installer packages

Two packages give Skill Federation its no-clone install paths:

| Package | Registry | Dir | Invocation |
|---|---|---|---|
| `skillfed` | npm | [`installer/`](installer/) | `npx skillfed` |
| `skillfed` | PyPI | [`python-installer/`](python-installer/) | `uvx skillfed` / `pipx run skillfed` |
| `skillfed-mcp` | npm | [`mcp-server/`](mcp-server/) | registered by `--with-npx` as `npx -y skillfed-mcp` |

> The **curl bootstrap** (`irm|iex`, `curl|bash`) needs none of this — it goes live the moment
> the updated `install.ps1`/`install.sh` are pushed to `main`. Publishing only powers the
> `npx`/`uvx` lines.

**Recommended: the GitHub Actions pipeline below** — the cloud builds and publishes, so you need
no local Node/Python and (almost) no tokens. The manual sections after it are the fallback for a
runtime-equipped machine.

---

## CI pipeline — release by pushing a tag (recommended)

Two workflows publish on any `v*` tag (or manual *Run workflow*):
[`.github/workflows/release-pypi.yml`](.github/workflows/release-pypi.yml) and
[`release-npm.yml`](.github/workflows/release-npm.yml).

**Token story (honest):**
- **PyPI** — fully tokenless. Trusted Publishing's *pending publisher* covers even the first
  release.
- **npm** — npm only allows configuring OIDC Trusted Publishing *after* a package has ≥1 version
  ([npm docs](https://docs.npmjs.com/trusted-publishers/)), so the **first** release uses a
  granular automation token kept in **GitHub Secrets** (never in chat or on disk). After v0.1.0
  lands you switch npm to tokenless OIDC too.

### One-time setup

1. **Push the repo + workflows to GitHub** (`origin` is already `skill-federation/skill-federation`).

2. **PyPI pending publisher** (tokenless) — pypi.org → *Your account* → **Publishing** → *Add a
   pending publisher*:
   | Field | Value |
   |---|---|
   | PyPI Project Name | `skillfed` |
   | Owner | `skill-federation` |
   | Repository name | `skill-federation` |
   | Workflow name | `release-pypi.yml` |
   | Environment | *(leave blank)* |

3. **npm token for the first release** — npmjs.com → *Access Tokens* → **Generate → Granular
   Access Token**: read+write on packages, scoped to `skillfed` and `skillfed-mcp` (or all).
   Copy it, then in the GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret**: name `NPM_TOKEN`, value = the token. (This is the only secret, and it
   lives only in GitHub's encrypted store.)

### Release

```bash
git tag v0.1.0
git push origin v0.1.0          # both workflows fire; watch the Actions tab
```

Then smoke-test: `npx -y skillfed@latest --help` and `uvx skillfed --help`.

### After the first npm release → go fully tokenless

1. npmjs.com → each package (`skillfed`, `skillfed-mcp`) → **Settings → Trusted Publisher** →
   add GitHub Actions (repo `skill-federation/skill-federation`, workflow `release-npm.yml`).
2. In `release-npm.yml`: bump `node-version` so npm ≥ 11.5.1 (e.g. add a
   `run: npm install -g npm@latest` step) and delete the two `NODE_AUTH_TOKEN` lines.
3. Delete the `NPM_TOKEN` secret. Future tags publish with no token, provenance automatic.

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

### Also publish `skillfed-mcp` (optional but recommended)
`--with-npx` registers `npx -y skillfed-mcp`, which only resolves once that package exists:
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
