# Install git pre-push hook for AI log submission (Windows PowerShell).
# Run once after cloning: powershell -ExecutionPolicy Bypass -File scripts\setup_hooks.ps1

$ErrorActionPreference = 'Stop'

$HookFile = '.git/hooks/pre-push'

# Git on Windows runs hooks via Git Bash. The file MUST be UTF-8 without BOM
# and LF-only; PowerShell Set-Content -Encoding UTF8 writes a BOM + CRLF, which
# makes git fail with: cannot spawn .git/hooks/pre-push: No such file or directory
$HookBody = @"
#!/bin/sh
# Pre-push: sweep recent Antigravity / Gemini prompts, then submit AI logs.
python scripts/log_antigravity.py --auto || true
python scripts/submit_log.py || true
exit 0
"@
$HookBody = $HookBody -replace "`r`n", "`n"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $HookFile), $HookBody, $utf8)
Write-Host "[ai-log] Git pre-push hook installed."

if (-not (Test-Path .ai-log)) { New-Item -ItemType Directory -Path .ai-log | Out-Null }
if (-not (Test-Path .ai-log/.gitkeep)) { New-Item -ItemType File -Path .ai-log/.gitkeep | Out-Null }

Write-Host "[ai-log] Setup complete. Configure AI_LOG_SERVER in your .env file."
