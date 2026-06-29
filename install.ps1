<#
  Skill Federation - installer (Windows / PowerShell)

  Auto-detects what's on the machine and installs the right tier:
    - ALWAYS: the curl-based finder (skill + /skillfed command) - zero runtime, just curl.
    - -WithHook   : register the plan-approval nudge hook in settings.json (safe merge + backup).
    - -WithNpx    : also register the Node MCP server (requires node) for typed-tool ergonomics.
    - -WithPython : print the advanced/CI Python-helper setup.

  Examples:
    .\install.ps1                  # curl tier, user scope (~/.claude)
    .\install.ps1 -WithHook        # + auto-trigger after plan approval
    .\install.ps1 -WithNpx         # + Node MCP tools (if node present)
    .\install.ps1 -Scope project   # install into ./.claude instead of ~/.claude
#>
[CmdletBinding()]
param(
  [ValidateSet('user','project')] [string]$Scope = 'user',
  [string]$Target,
  [switch]$WithHook,
  [switch]$WithNpx,
  [switch]$WithPython,
  [string]$Endpoint = 'https://qurini-skill-federation.hf.space'
)
$ErrorActionPreference = 'Stop'

$repo     = $PSScriptRoot
$src      = Join-Path $repo 'integrations\claude-code'
$skillSrc = Join-Path $src  'skills\skill-federation\SKILL.md'
$nudgeSrc = Join-Path $src  'hooks\plan_nudge.json'
$cmdSrc   = Join-Path $src  'commands\skillfed.md'

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

$hasCurl = (Have 'curl.exe') -or (Have 'curl')
$hasNode = Have 'node'
$hasPy   = (Have 'python') -or (Have 'python3')

Write-Host "Skill Federation installer" -ForegroundColor Cyan
Write-Host ("  target : {0}  (scope={1})" -f $Target, $Scope)
Write-Host ("  curl   : {0}" -f $(if ($hasCurl) { 'yes' } else { 'NO - the runtime path needs curl!' }))
Write-Host ("  node   : {0}" -f $(if ($hasNode) { 'yes' } else { 'no' }))
Write-Host ("  python : {0}" -f $(if ($hasPy)   { 'yes' } else { 'no' }))
Write-Host ""

# ALWAYS: curl tier (skill + command) - no JSON edits, works immediately
$skillDir = Join-Path $Target 'skills\skill-federation'
New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
Copy-Item $skillSrc (Join-Path $skillDir 'SKILL.md')        -Force
Copy-Item $nudgeSrc (Join-Path $skillDir 'plan_nudge.json') -Force
$cmdDir = Join-Path $Target 'commands'
New-Item -ItemType Directory -Force -Path $cmdDir | Out-Null
Copy-Item $cmdSrc (Join-Path $cmdDir 'skillfed.md') -Force
Write-Host "[curl] installed finder skill + /skillfed command (zero runtime)" -ForegroundColor Green
if (-not $hasCurl) { Write-Warning "curl was not found - install it or the finder cannot reach the federation at runtime." }

# -WithHook: register the plan-approval nudge (safe merge + backup)
if ($WithHook) {
  $nudgeAbs = (Join-Path $skillDir 'plan_nudge.json') -replace '\\','/'
  $cmd = 'curl -s "file://' + $nudgeAbs + '"'
  $settingsPath = Join-Path $Target 'settings.json'
  $S = JRead $settingsPath
  if (-not $S.ContainsKey('hooks'))                { $S['hooks'] = New-Object 'System.Collections.Generic.Dictionary[string,object]' }
  $hooks = $S['hooks']
  if (-not $hooks.ContainsKey('PostToolUse'))      { $hooks['PostToolUse'] = @() }
  $ptu = @($hooks['PostToolUse'])
  $already = $false
  foreach ($e in $ptu) { if ($e.ContainsKey('hooks')) { foreach ($hh in @($e['hooks'])) { if ("$($hh['command'])" -like '*plan_nudge.json*') { $already = $true } } } }
  if ($already) {
    Write-Host "[hook] already registered; skipped" -ForegroundColor DarkGray
  } else {
    Backup $settingsPath
    $entry = @{ matcher = 'ExitPlanMode'; hooks = @(@{ type = 'command'; command = $cmd; timeout = 20 }) }
    $hooks['PostToolUse'] = $ptu + $entry
    JWrite $S $settingsPath
    Write-Host "[hook] registered plan-approval nudge in settings.json" -ForegroundColor Green
  }
}

# -WithNpx: register the Node MCP server (project-scoped .mcp.json)
if ($WithNpx) {
  if (-not $hasNode) {
    Write-Warning "[npx] node not found - skipping the MCP tier (curl tier is installed and works)."
  } else {
    $mcpPath     = Join-Path (Get-Location) '.mcp.json'
    $serverIndex = (Join-Path $repo 'mcp-server\index.mjs') -replace '\\','/'
    $M = JRead $mcpPath
    if (-not $M.ContainsKey('mcpServers')) { $M['mcpServers'] = New-Object 'System.Collections.Generic.Dictionary[string,object]' }
    Backup $mcpPath
    $M['mcpServers']['skillfed-mcp'] = @{ command = 'node'; args = @($serverIndex); env = @{ SKILLFED_ENDPOINT = $Endpoint } }
    JWrite $M $mcpPath
    Write-Host "[npx] registered Node MCP server -> $mcpPath (local-node form)" -ForegroundColor Green
    if (-not (Test-Path (Join-Path $repo 'mcp-server\node_modules'))) {
      Write-Host ("      run once:  npm install --prefix `"{0}`"" -f (Join-Path $repo 'mcp-server')) -ForegroundColor Yellow
    }
    Write-Host "      after publishing skillfed-mcp to npm, swap to: command=npx args=-y,skillfed-mcp" -ForegroundColor DarkGray
  }
}

# -WithPython: advanced/CI tier (print setup; no machine changes)
if ($WithPython) {
  $pyExe = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $pyExe) { $pyExe = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
  Write-Host "[python] advanced/CI tier - set these (PowerShell):" -ForegroundColor Green
  Write-Host ("  setx SKILLFED_HOME `"{0}`"" -f (Join-Path $repo 'integrations'))
  Write-Host ("  setx SKILLFED_ENDPOINT `"{0}`"" -f $Endpoint)
  if ($pyExe) { Write-Host ("  setx SKILLFED_PY `"{0}`"" -f $pyExe) } else { Write-Warning "  no python interpreter found" }
  Write-Host ("  smoke test: python `"{0}`" `"{1}`"" -f (Join-Path $repo 'integrations\search_wishlist.py'), (Join-Path $repo 'integrations\sample_wishlist.json'))
}

Write-Host ""
Write-Host "Done. Restart Claude Code, then run:  /skillfed <what you're trying to do>" -ForegroundColor Cyan
Write-Host ('Endpoint: ' + $Endpoint + '  (override with $env:SKILLFED_ENDPOINT)') -ForegroundColor DarkGray
