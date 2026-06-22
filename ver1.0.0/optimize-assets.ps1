$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$assetRoot = Join-Path $root "assets_v1.0.0"
$npx = "C:\Program Files\nodejs\npx.cmd"

if (-not (Test-Path -LiteralPath $npx)) {
  throw "Node.js npx was not found at $npx"
}

Get-ChildItem (Join-Path $assetRoot "js") -Recurse -Filter "*.js" |
  Where-Object { $_.Name -notlike "*.min.js" } |
  ForEach-Object {
    $output = Join-Path $_.DirectoryName "$($_.BaseName).min.js"
    & $npx --yes terser $_.FullName --compress --comments false --output $output
    if ($LASTEXITCODE -ne 0) { throw "Terser failed for $($_.FullName)" }
  }

Get-ChildItem (Join-Path $assetRoot "css") -Filter "*.css" |
  Where-Object { $_.Name -notlike "*.min.css" } |
  ForEach-Object {
    $output = Join-Path $_.DirectoryName "$($_.BaseName).min.css"
    & $npx --yes lightningcss-cli --minify --output-file $output $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Lightning CSS failed for $($_.FullName)" }
  }

Write-Host "Minified JS and CSS assets are current."
