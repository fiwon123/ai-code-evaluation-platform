# Cross-platform dev-sandbox entry point for native Windows (#436)
#
# The Makefile cannot run on cmd.exe/PowerShell because the preflight recipes
# use POSIX shell constructs. This shim delegates to the stdlib Python launcher
# with the same overlay-selection rules (socket + agent) as the Makefile.

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$Command = "help",

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) {
    $Python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $Python) {
    Write-Error "Python was not found on PATH. Install Python 3 (https://www.python.org/) and retry."
    exit 1
}

$Launcher = Join-Path $ScriptDir "dev-up.py"
& $Python.Source $Launcher $Command @Args
exit $LASTEXITCODE
