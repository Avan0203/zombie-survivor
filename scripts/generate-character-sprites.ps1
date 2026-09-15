param(
  [string]$OutputDirectory
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outputDirectory = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $root "public\assets\characters" }
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function Add-Pixel {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Color]$Color,
    [int]$X,
    [int]$Y,
    [int]$Width = 1,
    [int]$Height = 1
  )

  $brush = [System.Drawing.SolidBrush]::new($Color)
  $Graphics.FillRectangle($brush, $X, $Y, $Width, $Height)
  $brush.Dispose()
}

function New-SpriteSheet {
  param(
    [string]$Path,
    [scriptblock]$DrawFrame
  )

  $bitmap = [System.Drawing.Bitmap]::new(256, 32, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

  for ($frame = 0; $frame -lt 8; $frame++) {
    & $DrawFrame $graphics ($frame * 32) $frame
  }

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$outline = [System.Drawing.ColorTranslator]::FromHtml("#1B1B1B")
$shadow = [System.Drawing.ColorTranslator]::FromHtml("#101510")
$survivorSkin = [System.Drawing.ColorTranslator]::FromHtml("#B98A62")
$survivorSkinLight = [System.Drawing.ColorTranslator]::FromHtml("#D4A77A")
$survivorJacket = [System.Drawing.ColorTranslator]::FromHtml("#48523A")
$survivorJacketLight = [System.Drawing.ColorTranslator]::FromHtml("#7E885D")
$survivorVest = [System.Drawing.ColorTranslator]::FromHtml("#2C332E")
$survivorPants = [System.Drawing.ColorTranslator]::FromHtml("#30384A")
$survivorPantsLight = [System.Drawing.ColorTranslator]::FromHtml("#59617A")
$boot = [System.Drawing.ColorTranslator]::FromHtml("#25221E")
$rifle = [System.Drawing.ColorTranslator]::FromHtml("#222628")
$rifleLight = [System.Drawing.ColorTranslator]::FromHtml("#7A765F")
$scarf = [System.Drawing.ColorTranslator]::FromHtml("#9A3A32")

$zombieSkinDark = [System.Drawing.ColorTranslator]::FromHtml("#317D57")
$zombieSkin = [System.Drawing.ColorTranslator]::FromHtml("#9AC87D")
$zombieSkinLight = [System.Drawing.ColorTranslator]::FromHtml("#C6D99A")
$zombieShirt = [System.Drawing.ColorTranslator]::FromHtml("#4D5984")
$zombieShirtDark = [System.Drawing.ColorTranslator]::FromHtml("#343B5A")
$zombiePants = [System.Drawing.ColorTranslator]::FromHtml("#1A1932")
$wound = [System.Drawing.ColorTranslator]::FromHtml("#891E2B")
$woundLight = [System.Drawing.ColorTranslator]::FromHtml("#C84A3C")

$survivorDrawer = {
  param($g, $ox, $frame)

  $phase = $frame % 4
  $bob = @(0, -1, 0, 1)[$phase]
  $leftStep = @(-2, 1, 2, 1)[$phase]
  $rightStep = @(2, 1, -2, -1)[$phase]
  $armSwing = @(-1, 0, 1, 0)[$phase]

  Add-Pixel $g $outline ($ox + 10) (6 + $bob) 12 16
  Add-Pixel $g $survivorJacket ($ox + 11) (7 + $bob) 10 14
  Add-Pixel $g $survivorJacketLight ($ox + 12) (8 + $bob) 4 10
  Add-Pixel $g $survivorVest ($ox + 16) (9 + $bob) 5 13
  Add-Pixel $g $shadow ($ox + 17) (11 + $bob) 2 8

  Add-Pixel $g $outline ($ox + 12) (4 + $bob) 8 8
  Add-Pixel $g $survivorSkin ($ox + 13) (5 + $bob) 6 6
  Add-Pixel $g $survivorSkinLight ($ox + 14) (5 + $bob) 3 2
  Add-Pixel $g $outline ($ox + 12) (3 + $bob) 9 3
  Add-Pixel $g $survivorVest ($ox + 13) (4 + $bob) 7 2
  Add-Pixel $g $outline ($ox + 14) (8 + $bob) 2 1
  Add-Pixel $g $outline ($ox + 20) (6 + $bob) 2 2
  Add-Pixel $g $scarf ($ox + 11) (10 + $bob) 4 2
  Add-Pixel $g $scarf ($ox + 10) (11 + $bob) 2 3

  Add-Pixel $g $outline ($ox + 8) (10 + $bob) 4 12
  Add-Pixel $g $survivorJacket ($ox + 9) (11 + $bob) 3 10
  Add-Pixel $g $survivorSkin ($ox + 8) (18 + $bob + $armSwing) 3 3
  Add-Pixel $g $outline ($ox + 20) (10 + $bob - $armSwing) 4 12
  Add-Pixel $g $survivorJacketLight ($ox + 20) (11 + $bob - $armSwing) 3 9
  Add-Pixel $g $survivorSkinLight ($ox + 21) (19 + $bob - $armSwing) 3 3

  Add-Pixel $g $outline ($ox + 8) (18 + $bob + $armSwing) 19 4
  Add-Pixel $g $rifle ($ox + 7) (19 + $bob + $armSwing) 23 2
  Add-Pixel $g $rifleLight ($ox + 17) (18 + $bob + $armSwing) 5 1
  Add-Pixel $g $outline ($ox + 28) (18 + $bob + $armSwing) 4 2
  Add-Pixel $g $outline ($ox + 7) (20 + $bob + $armSwing) 3 8
  Add-Pixel $g $rifle ($ox + 8) (21 + $bob + $armSwing) 2 6

  Add-Pixel $g $outline ($ox + 11) (22 + $bob) 5 8
  Add-Pixel $g $outline ($ox + 18) (22 + $bob) 5 8
  Add-Pixel $g $survivorPants ($ox + 12) (22 + $bob) 3 6
  Add-Pixel $g $survivorPants ($ox + 19) (22 + $bob) 3 6
  Add-Pixel $g $survivorPantsLight ($ox + 12) (23 + $bob) 1 4
  Add-Pixel $g $survivorPantsLight ($ox + 20) (23 + $bob) 1 4

  Add-Pixel $g $boot ($ox + 10 + $leftStep) (27 + $bob) 6 4
  Add-Pixel $g $boot ($ox + 18 + $rightStep) (27 + $bob) 6 4
  Add-Pixel $g $outline ($ox + 9 + $leftStep) (30 + $bob) 7 2
  Add-Pixel $g $outline ($ox + 18 + $rightStep) (30 + $bob) 7 2
}

$zombieDrawer = {
  param($g, $ox, $frame)

  $phase = $frame % 4
  $bob = @(0, -1, 0, 1)[$phase]
  $leftStep = @(-2, 1, 2, 1)[$phase]
  $rightStep = @(2, 1, -2, -1)[$phase]
  $armSwing = @(1, -1, -2, -1)[$phase]

  Add-Pixel $g $outline ($ox + 10) (9 + $bob) 12 13
  Add-Pixel $g $zombieShirtDark ($ox + 11) (10 + $bob) 10 11
  Add-Pixel $g $zombieShirt ($ox + 13) (11 + $bob) 8 8
  Add-Pixel $g $wound ($ox + 18) (13 + $bob) 3 5
  Add-Pixel $g $woundLight ($ox + 19) (14 + $bob) 2 2

  Add-Pixel $g $outline ($ox + 12) (3 + $bob) 9 10
  Add-Pixel $g $zombieSkinDark ($ox + 13) (4 + $bob) 7 8
  Add-Pixel $g $zombieSkin ($ox + 14) (5 + $bob) 6 6
  Add-Pixel $g $zombieSkinLight ($ox + 15) (5 + $bob) 3 2
  Add-Pixel $g $outline ($ox + 14) (8 + $bob) 2 1
  Add-Pixel $g $outline ($ox + 19) (7 + $bob) 2 1
  Add-Pixel $g $wound ($ox + 16) (11 + $bob) 5 2
  Add-Pixel $g $woundLight ($ox + 18) (11 + $bob) 2 1
  Add-Pixel $g $outline ($ox + 11) (4 + $bob) 3 4
  Add-Pixel $g $outline ($ox + 20) (4 + $bob) 3 4

  Add-Pixel $g $outline ($ox + 7) (11 + $bob - $armSwing) 5 14
  Add-Pixel $g $zombieSkinDark ($ox + 8) (12 + $bob - $armSwing) 3 11
  Add-Pixel $g $zombieSkin ($ox + 7) (22 + $bob - $armSwing) 4 4
  Add-Pixel $g $outline ($ox + 21) (11 + $bob + $armSwing) 5 14
  Add-Pixel $g $zombieSkinDark ($ox + 21) (12 + $bob + $armSwing) 3 11
  Add-Pixel $g $zombieSkinLight ($ox + 22) (22 + $bob + $armSwing) 4 4

  Add-Pixel $g $outline ($ox + 11) (22 + $bob) 5 9
  Add-Pixel $g $outline ($ox + 18) (22 + $bob) 5 9
  Add-Pixel $g $zombiePants ($ox + 12) (22 + $bob) 3 7
  Add-Pixel $g $zombiePants ($ox + 19) (22 + $bob) 3 7
  Add-Pixel $g $zombieShirtDark ($ox + 11 + $leftStep) (29 + $bob) 7 3
  Add-Pixel $g $zombieShirtDark ($ox + 18 + $rightStep) (29 + $bob) 7 3
  Add-Pixel $g $outline ($ox + 10 + $leftStep) (30 + $bob) 8 2
  Add-Pixel $g $outline ($ox + 18 + $rightStep) (30 + $bob) 8 2
}

New-SpriteSheet -Path (Join-Path $outputDirectory "survivor-walk-v2.png") -DrawFrame $survivorDrawer
New-SpriteSheet -Path (Join-Path $outputDirectory "zombie-walk-v2.png") -DrawFrame $zombieDrawer

Write-Output "Generated:"
Get-ChildItem $outputDirectory -Filter "*-walk-v2.png" | ForEach-Object {
  $image = [System.Drawing.Image]::FromFile($_.FullName)
  Write-Output ("{0} {1}x{2}" -f $_.FullName, $image.Width, $image.Height)
  $image.Dispose()
}
