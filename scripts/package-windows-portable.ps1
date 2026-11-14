# 在 NSIS 构建之后，把免安装 zip 和安装器一起放到 dist-windows/。
# 免安装目录与安装后的资源布局一致：exe 旁边是 file-icon.ico 和 resources/。
# 用法（仓库根目录，且已经跑过 tauri build --bundles nsis）：
#   pwsh scripts/package-windows-portable.ps1
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$release = Join-Path $repoRoot "src-tauri/target/x86_64-pc-windows-msvc/release"
$exe = Join-Path $release "yanzhi-notes.exe"
$nsisDir = Join-Path $release "bundle/nsis"
$out = Join-Path $repoRoot "dist-windows"
$stage = Join-Path $out "yanzhi-notes"
$zip = Join-Path $out "yanzhi-notes-windows-x64.zip"

if (-not (Test-Path -LiteralPath $exe)) {
  throw "找不到 $exe。请先运行: pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis"
}

$nsis = @(Get-ChildItem -LiteralPath $nsisDir -Filter *.exe -File -ErrorAction SilentlyContinue)
if ($nsis.Count -eq 0) {
  throw "找不到 NSIS 安装器: $nsisDir"
}

if (Test-Path -LiteralPath $out) {
  Remove-Item -LiteralPath $out -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage "resources") | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $stage "yanzhi-notes.exe")
Copy-Item -LiteralPath (Join-Path $repoRoot "src-tauri/icons/file-icon.ico") -Destination (Join-Path $stage "file-icon.ico")
Copy-Item -LiteralPath (Join-Path $repoRoot "src-tauri/resources/yanzhi-reference.docx") -Destination (Join-Path $stage "resources/yanzhi-reference.docx")
Copy-Item -LiteralPath (Join-Path $repoRoot "src-tauri/resources/yanzhi-highlight.theme") -Destination (Join-Path $stage "resources/yanzhi-highlight.theme")

$zipTmp = Join-Path ([System.IO.Path]::GetTempPath()) "yanzhi-notes-windows-x64.zip"
if (Test-Path -LiteralPath $zipTmp) {
  Remove-Item -LiteralPath $zipTmp -Force
}
Compress-Archive -Path $stage -DestinationPath $zipTmp -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force
Move-Item -LiteralPath $zipTmp -Destination $zip
foreach ($installer in $nsis) {
  Copy-Item -LiteralPath $installer.FullName -Destination $out
}

Write-Host "Windows artifacts:"
Get-ChildItem -LiteralPath $out | ForEach-Object { Write-Host $_.Name }
