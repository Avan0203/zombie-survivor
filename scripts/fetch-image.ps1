param([Parameter(Mandatory = $true)][string]$PromptFile, [Parameter(Mandatory = $true)][string]$Out, [string]$Model = "wan2.7-image-pro", [string]$Size = "1024*1024")
$Endpoint = "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
$apiKey = $env:ANTHROPIC_AUTH_TOKEN
if (-not $apiKey) { throw "ANTHROPIC_AUTH_TOKEN is not set" }
$prompt = (Get-Content -LiteralPath $PromptFile -Raw).Trim()
$body = @{ model = $Model; input = @{ messages = @(@{ role = "user"; content = @(@{ text = $prompt }) }) }; parameters = @{ size = $Size } } | ConvertTo-Json -Depth 8 -Compress
$response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers @{ Authorization = "Bearer $apiKey" } -ContentType "application/json" -Body $body -TimeoutSec 600
$imageUrl = $response.output.choices | ForEach-Object { $_.message.content } | Where-Object { $_.image } | Select-Object -First 1 -ExpandProperty image
if (-not $imageUrl) { throw ("no image url: " + ($response | ConvertTo-Json -Depth 8 -Compress)) }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
Invoke-WebRequest -Uri $imageUrl -OutFile $Out
Write-Output ("saved " + $Out + " from " + $imageUrl)
