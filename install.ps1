<#
  Skill Federation - installer (Windows / PowerShell)

  Auto-detects what's on the machine and installs the right tier:
    - ALWAYS: the curl-based finder (skill + /skillfed command) - zero runtime, just curl.
    - -Hook MODE  : register 0-2 nudge hooks in settings.json (safe merge + backup). Default none.
    - -WithNpx    : also register the Node MCP server (requires node) for typed-tool ergonomics.
    - -WithPython : print the advanced/CI Python-helper setup.

  Hooks are a per-harness convenience and nothing more - they only repeat triggers the skill
  already carries in its own body. The default is -Hook none: the skill is complete, and
  portable to any harness (or none at all), with no hook registered. Both nudge files and the
  gate script are installed whatever the mode, so switching -Hook later needs no re-fetch.

  Examples:
    .\install.ps1                  # curl tier, user scope (~/.claude), no hooks
    .\install.ps1 -Hook end        # + the end-of-plan nudge
    .\install.ps1 -Hook both       # + the start-of-plan nudge as well
    .\install.ps1 -WithNpx         # + Node MCP tools (if node present)
    .\install.ps1 -Scope project   # install into ./.claude instead of ~/.claude
#>
[CmdletBinding()]
param(
  [ValidateSet('user','project')] [string]$Scope = 'user',
  [string]$Target,
  # -Harness is validated by hand (not [ValidateSet]) so an unknown value exits 2 with a
  # message naming what is supported, matching install.sh / cli.mjs / cli.py.
  [string]$Harness = 'claude-code',
  [ValidateSet('none','start','end','both')] [string]$Hook = 'none',
  [switch]$WithHook,
  [switch]$WithNpx,
  [switch]$WithPython,
  [string]$Endpoint = 'https://qurini-skill-federation.hf.space',
  [string]$RawBase  = 'https://raw.githubusercontent.com/skill-federation/skill-federation/main'
)
$ErrorActionPreference = 'Stop'

# Harnesses we know how to install into -> whether the harness has a hook mechanism at all.
# -Hook is rejected for any harness whose value is $false.
$Harnesses = @{ 'claude-code' = $true }
if (-not $Harnesses.ContainsKey($Harness)) {
  [Console]::Error.WriteLine("error: unknown -Harness '$Harness'; supported: " + (($Harnesses.Keys | Sort-Object) -join ', '))
  exit 2
}
# Resolution order: explicit -Hook wins, then the legacy -WithHook switch, then none.
$HookMode = if ($PSBoundParameters.ContainsKey('Hook')) { $Hook } elseif ($WithHook) { 'end' } else { 'none' }
if ($HookMode -ne 'none' -and -not $Harnesses[$Harness]) {
  [Console]::Error.WriteLine("error: harness '$Harness' has no hook support - drop -Hook/-WithHook. The skill is complete without hooks.")
  exit 2
}

# $PSScriptRoot is the checkout dir when run from a clone, and EMPTY when piped through
# `iex` (the no-clone bootstrap: irm <url>/install.ps1 | iex). That emptiness is the signal
# that auto-selects remote mode below — each payload file is fetched from $RawBase instead.
$repo = $PSScriptRoot
# Curl-tier payload, as forward-slash paths under the repo root (also the $RawBase URL tail).
# Both nudges and the gate script ship regardless of $HookMode so switching modes needs no re-fetch.
$PAYLOAD = @(
  'integrations/claude-code/skills/skill-federation/SKILL.md',
  'integrations/claude-code/skills/skill-federation/demand-sketch.md',
  'integrations/claude-code/hooks/plan_nudge.json',
  'integrations/claude-code/hooks/plan_start_nudge.json',
  'integrations/claude-code/hooks/start_nudge.sh',
  'integrations/claude-code/commands/skillfed.md'
)

if (-not $Target) {
  $Target = if ($Scope -eq 'user') { Join-Path $HOME '.claude' } else { Join-Path (Get-Location) '.claude' }
}

function Have([string]$n) { [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Backup([string]$p) { if (Test-Path $p) { Copy-Item $p "$p.bak" -Force; Write-Host "  backed up -> $p.bak" -ForegroundColor DarkGray } }
# JSON via JavaScriptSerializer: round-trips Dictionary/object[] faithfully and (unlike PS 5.1
# ConvertTo-Json) does NOT unwrap single-element arrays, so it can't corrupt an existing hooks array.
Add-Type -AssemblyName System.Web.Extensions
$script:JSer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:JSer.MaxJsonLength = [int]::MaxValue
function JRead([string]$path) {
  if (Test-Path $path) { $raw = Get-Content $path -Raw; if ($raw.Trim()) { return $script:JSer.DeserializeObject($raw) } }
  return (New-Object 'System.Collections.Generic.Dictionary[string,object]')
}
function JWrite($obj, [string]$path) { [IO.File]::WriteAllText($path, $script:JSer.Serialize($obj)) }
# Insert a nested Dictionary under $key. MUST use .Add(), not `$d[$key] = $v`: PowerShell's
# indexer assignment on a generic Dictionary stores the value PSObject-WRAPPED (the wrapper is
# invisible to a later read, which unwraps), and JavaScriptSerializer then walks the wrapper's
# PSParameterizedProperty members and throws "a circular reference was detected". That made
# every hook/npx registration against a MISSING or hooks-less settings.json fail at the write.
function JEnsureMap($d, [string]$key) {
  if (-not $d.ContainsKey($key)) { $d.Add($key, (New-Object 'System.Collections.Generic.Dictionary[string,object]')) }
  return $d[$key]
}

$hasCurl = (Have 'curl.exe') -or (Have 'curl')
$hasNode = Have 'node'
$hasPy   = (Have 'python') -or (Have 'python3')
# The END nudge is curl (ships with Win10+). The START nudge is `sh <script>`, and on Windows
# `sh` exists only with Git Bash. UserPromptSubmit fires on EVERY prompt, so a missing shell
# there does not degrade once - it fails on every single turn. Checked before registering.
$hasSh   = (Have 'sh') -or (Have 'sh.exe')

# Fetch a URL to a file: prefer curl.exe (ships Win10+, handles TLS cleanly); fall back to
# Invoke-WebRequest with TLS 1.2 forced (PS 5.1 can default to TLS 1.0 and get refused).
function FetchTo([string]$url, [string]$dest) {
  if ($hasCurl) {
    & curl.exe -fsSL $url -o $dest
    if ($LASTEXITCODE -ne 0) { throw "fetch failed ($LASTEXITCODE): $url" }
  } else {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  }
}
# Resolve one payload file to $dest: copy from the local checkout if we have one, else fetch
# it from raw GitHub ($RawBase). $rel is a forward-slash repo-root-relative path.
function ResolveSource([string]$rel, [string]$dest) {
  $local = if ($repo) { Join-Path $repo ($rel -replace '/','\') } else { $null }
  if ($local -and (Test-Path $local)) {
    Copy-Item $local $dest -Force
  } else {
    FetchTo "$RawBase/$rel" $dest
    Write-Host ("  fetched <- {0}" -f $rel) -ForegroundColor DarkGray
  }
}
$RemoteMode = -not ($repo -and (Test-Path (Join-Path $repo ($PAYLOAD[0] -replace '/','\'))))

Write-Host "Skill Federation installer" -ForegroundColor Cyan
Write-Host ("  source : {0}" -f $(if ($RemoteMode) { "remote ($RawBase)" } else { "local clone ($repo)" }))
Write-Host ("  target : {0}  (scope={1})" -f $Target, $Scope)
Write-Host ("  harness: {0}  (hooks: {1})" -f $Harness, $HookMode)
Write-Host ("  curl   : {0}" -f $(if ($hasCurl) { 'yes' } else { 'NO - the runtime path needs curl!' }))
Write-Host ("  node   : {0}" -f $(if ($hasNode) { 'yes' } else { 'no' }))
Write-Host ("  python : {0}" -f $(if ($hasPy)   { 'yes' } else { 'no' }))
Write-Host ("  sh     : {0}" -f $(if ($hasSh)   { 'yes' } else { 'no  (needed only by -Hook start/both)' }))
Write-Host ""

# ALWAYS: curl tier (skill + command) - no JSON edits, works immediately.
# Each file is copied from the local clone or fetched from raw GitHub (no-clone bootstrap).
$skillDir = Join-Path $Target 'skills\skill-federation'
New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
$cmdDir = Join-Path $Target 'commands'
New-Item -ItemType Directory -Force -Path $cmdDir | Out-Null
ResolveSource 'integrations/claude-code/skills/skill-federation/SKILL.md'         (Join-Path $skillDir 'SKILL.md')
ResolveSource 'integrations/claude-code/skills/skill-federation/demand-sketch.md' (Join-Path $skillDir 'demand-sketch.md')
ResolveSource 'integrations/claude-code/hooks/plan_nudge.json'                    (Join-Path $skillDir 'plan_nudge.json')
ResolveSource 'integrations/claude-code/hooks/plan_start_nudge.json'              (Join-Path $skillDir 'plan_start_nudge.json')
ResolveSource 'integrations/claude-code/hooks/start_nudge.sh'                     (Join-Path $skillDir 'start_nudge.sh')
ResolveSource 'integrations/claude-code/commands/skillfed.md'                     (Join-Path $cmdDir   'skillfed.md')
Write-Host "[curl] installed finder skill + /skillfed command (zero runtime)" -ForegroundColor Green
if (-not $hasCurl) { Write-Warning "curl was not found - install it or the finder cannot reach the federation at runtime." }

# -Hook: register 0-2 nudge entries (safe merge, idempotent, ONE backup before the first write).
#
# Each entry's Needle is the idempotency probe, and each is a substring of ITS OWN command only:
# the start command names start_nudge.sh, the end command names plan_nudge.json, and neither
# string occurs in the other. (Note that "plan_start_nudge.json" does NOT contain
# "plan_nudge.json" either - re-verify by hand if any of these files is ever renamed.)
if ($HookMode -ne 'none') {
  $settingsPath = Join-Path $Target 'settings.json'
  $S = JRead $settingsPath
  $hooks = JEnsureMap $S 'hooks'

  # Descriptors hold STRINGS AND INTS ONLY. The entry hashtable itself is built fresh inside
  # the loop below: a Hashtable carried as a property of a [pscustomobject] comes back
  # PSObject-wrapped, and JavaScriptSerializer then walks the wrapper's PSParameterizedProperty
  # members and dies with "a circular reference was detected".
  $entries = @()
  if ($HookMode -eq 'start' -or $HookMode -eq 'both') {
    if (-not $hasSh) {
      Write-Warning ("no 'sh' on PATH - the start-of-plan hook runs `"sh <script>`" and " +
        "UserPromptSubmit fires on EVERY prompt, so it would fail on every turn, not once. " +
        "Install Git Bash, or re-run with -Hook end. Registering anyway; the skill itself " +
        "needs no hook at all.")
    }
    $startAbs = (Join-Path $skillDir 'start_nudge.sh') -replace '\\','/'
    # NOTE: Matcher is '' -> the `matcher` key is OMITTED below, not set to $null (which would
    # serialize as "matcher":null). UserPromptSubmit carries no tool name to match on; the
    # script self-gates on permission_mode read from its own stdin instead.
    $entries += ,@('start-of-plan nudge', 'UserPromptSubmit', 'start_nudge.sh', '', ('sh "' + $startAbs + '"'), 10)
  }
  if ($HookMode -eq 'end' -or $HookMode -eq 'both') {
    $nudgeAbs = (Join-Path $skillDir 'plan_nudge.json') -replace '\\','/'
    $entries += ,@('end-of-plan nudge', 'PostToolUse', 'plan_nudge.json', 'ExitPlanMode', ('curl -s "file://' + $nudgeAbs + '"'), 20)
  }

  $backedUp = $false
  $dirty = $false
  foreach ($e in $entries) {
    $label = [string]$e[0]; $evt = [string]$e[1]; $needle = [string]$e[2]
    $matcher = [string]$e[3]; $command = [string]$e[4]; $timeout = [int]$e[5]
    if (-not $hooks.ContainsKey($evt)) { $hooks[$evt] = @() }
    $arr = @($hooks[$evt])
    $already = $false
    foreach ($x in $arr) {
      if ($x.ContainsKey('hooks')) {
        foreach ($hh in @($x['hooks'])) { if ("$($hh['command'])" -like ('*' + $needle + '*')) { $already = $true } }
      }
    }
    if ($already) {
      Write-Host ("[hook] {0} already registered; skipped" -f $label) -ForegroundColor DarkGray
      continue
    }
    if (-not $backedUp) { Backup $settingsPath; $backedUp = $true }
    $entry = @{}
    if ($matcher) { $entry['matcher'] = $matcher }
    $entry['hooks'] = @(@{ type = 'command'; command = $command; timeout = $timeout })
    $hooks[$evt] = $arr + $entry
    $dirty = $true
    Write-Host ("[hook] registered {0} ({1}) in settings.json" -f $label, $evt) -ForegroundColor Green
  }
  if ($dirty) { JWrite $S $settingsPath }
}

# -WithNpx: register the Node MCP server (project-scoped .mcp.json)
if ($WithNpx) {
  if (-not $hasNode) {
    Write-Warning "[npx] node not found - skipping the MCP tier (curl tier is installed and works)."
  } else {
    $mcpPath  = Join-Path (Get-Location) '.mcp.json'
    $localSrv = if ($repo) { Join-Path $repo 'mcp-server\index.mjs' } else { $null }
    $M = JRead $mcpPath
    $servers = JEnsureMap $M 'mcpServers'
    Backup $mcpPath
    if ($localSrv -and (Test-Path $localSrv)) {
      # Clone mode: point at the local server file.
      $servers['skillfed-mcp'] = @{ command = 'node'; args = @(($localSrv -replace '\\','/')); env = @{ SKILLFED_ENDPOINT = $Endpoint } }
      JWrite $M $mcpPath
      Write-Host "[npx] registered Node MCP server -> $mcpPath (local-node form)" -ForegroundColor Green
      if (-not (Test-Path (Join-Path $repo 'mcp-server\node_modules'))) {
        Write-Host ("      run once:  npm install --prefix `"{0}`"" -f (Join-Path $repo 'mcp-server')) -ForegroundColor Yellow
      }
    } else {
      # Remote/no-clone mode: there's no local mcp-server/, so register the published npx form.
      $servers['skillfed-mcp'] = @{ command = 'npx'; args = @('-y','skillfed-mcp'); env = @{ SKILLFED_ENDPOINT = $Endpoint } }
      JWrite $M $mcpPath
      Write-Host "[npx] registered Node MCP server -> $mcpPath (npx -y skillfed-mcp)" -ForegroundColor Green
      Write-Host "      note: uses the published skillfed-mcp on npm (npx fetches it on first run)." -ForegroundColor DarkGray
    }
  }
}

# -WithPython: advanced/CI tier (print setup; no machine changes)
if ($WithPython) {
  $pyExe = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $pyExe) { $pyExe = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
  Write-Host "[python] advanced/CI tier - set these (PowerShell):" -ForegroundColor Green
  if ($RemoteMode) {
    # No local checkout: the advanced Python helpers live in the repo. Point the user at it.
    Write-Host "  the advanced Python helpers need the repo on disk - clone it:" -ForegroundColor Yellow
    Write-Host ("    git clone {0}" -f ($RawBase -replace '/raw\.githubusercontent\.com/','/github.com/' -replace '/main$',''))
    Write-Host "  or run the pip installer:  uvx skillfed --with-python   (see python-installer/)"
    Write-Host ("  then: setx SKILLFED_ENDPOINT `"{0}`"" -f $Endpoint)
  } else {
    Write-Host ("  setx SKILLFED_HOME `"{0}`"" -f (Join-Path $repo 'integrations'))
    Write-Host ("  setx SKILLFED_ENDPOINT `"{0}`"" -f $Endpoint)
    if ($pyExe) { Write-Host ("  setx SKILLFED_PY `"{0}`"" -f $pyExe) } else { Write-Warning "  no python interpreter found" }
    Write-Host ("  smoke test: python `"{0}`" `"{1}`"" -f (Join-Path $repo 'integrations\search_wishlist.py'), (Join-Path $repo 'integrations\sample_wishlist.json'))
  }
}

Write-Host ""
Write-Host "Done. Restart Claude Code, then run:  /skillfed <what you're trying to do>" -ForegroundColor Cyan
Write-Host ('Endpoint: ' + $Endpoint + '  (override with $env:SKILLFED_ENDPOINT)') -ForegroundColor DarkGray
