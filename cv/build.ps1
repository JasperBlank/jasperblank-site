# Builds cv.tex into JasperBlank_CV.pdf with LuaLaTeX.
#
#   .\cv\build.ps1            -> cv/JasperBlank_CV.pdf   (draft, not published)
#   .\cv\build.ps1 -Publish   -> also copies into public/ and docs/
#
# LuaLaTeX rather than pdfLaTeX because Awesome-CV uses fontspec/HarfBuzz.
# The class is vendored in awesome-cv/ so builds do not depend on the network.

param([switch]$Publish)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $PSScriptRoot 'JasperBlank_CV.pdf'

Push-Location $PSScriptRoot
try {
  $env:TEXINPUTS = ".;$PSScriptRoot\awesome-cv;"

  # Twice: the footer's \thepage and hyperref bookmarks need a settled .aux.
  foreach ($pass in 1, 2) {
    $log = lualatex --enable-installer --interaction=nonstopmode --halt-on-error cv.tex 2>&1
    if ($LASTEXITCODE -ne 0) {
      $log | Select-String -Pattern '^!' -Context 0, 4 | ForEach-Object { $_.ToString() }
      throw "LuaLaTeX failed on pass $pass"
    }
  }

  if (Test-Path 'cv.pdf') {
    Move-Item 'cv.pdf' $out -Force
  } else {
    throw "No cv.pdf produced"
  }

  Remove-Item 'cv.aux', 'cv.log', 'cv.out' -ErrorAction SilentlyContinue

  $kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
  Write-Host "Built $out ($kb KB)"
}
finally {
  Pop-Location
}

if ($Publish) {
  foreach ($dir in @('public', 'docs')) {
    $dest = Join-Path $root $dir
    if (Test-Path $dest) {
      Copy-Item $out (Join-Path $dest 'JasperBlank_CV.pdf') -Force
      Write-Host "Published to $dir/JasperBlank_CV.pdf"
    }
  }
}
