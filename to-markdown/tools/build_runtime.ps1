# 建立免安裝的執行環境（runtime 資料夾），並打包成 zip 供內網電腦使用。
#
# 這個腳本要在「可以連外網」的 Windows 電腦上執行，而且該電腦要先裝好 Python
# （只用來下載套件，版本不拘）。產生的 runtime 不需要安裝，解壓到技能資料夾即可。
#
# 用法（在 to-markdown 資料夾內）：
#   powershell -File tools\build_runtime.ps1
#   powershell -File tools\build_runtime.ps1 -PythonVersion 3.12.10
#
# 注意：這個腳本尚未在 Windows 上實際執行過，第一次使用請逐步確認。

param(
    [string]$PythonVersion = '3.12.10'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$zip = Join-Path $root ("to-markdown-runtime-py$PythonVersion-win64.zip")
$parts = $PythonVersion.Split('.')
$tag = $parts[0] + $parts[1]                     # 例如 312
$shortVersion = $parts[0] + '.' + $parts[1]      # 例如 3.12

if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
New-Item -ItemType Directory -Path $runtime | Out-Null

# 1. 下載官方的免安裝版 Python
$url = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$embed = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
Write-Host "下載 $url"
Invoke-WebRequest -Uri $url -OutFile $embed
Expand-Archive -Path $embed -DestinationPath $runtime

# 2. 讓免安裝版 Python 找得到 Lib\site-packages
$pth = Join-Path $runtime "python$tag._pth"
Add-Content -Path $pth -Value 'Lib\site-packages'

# 3. 下載 PDF 需要的套件（指定目標平台與 Python 版本，只拿編譯好的版本）
$site = Join-Path $runtime 'Lib\site-packages'
New-Item -ItemType Directory -Path $site -Force | Out-Null
python -m pip install --target $site --platform win_amd64 --python-version $shortVersion `
    --implementation cp --only-binary=:all: --upgrade `
    -r (Join-Path $root 'requirements-pdf.txt')
if ($LASTEXITCODE -ne 0) { throw '套件下載失敗' }

# 4. 確認執行環境可用
& (Join-Path $runtime 'python.exe') -c "import pdfplumber, pypdfium2; print('runtime OK', pdfplumber.__version__)"
if ($LASTEXITCODE -ne 0) { throw '執行環境測試失敗' }

# 5. 打包
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $runtime -DestinationPath $zip
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "完成：$zip（$size MB）"
Write-Host '把這個 zip 帶進內網，解壓到 to-markdown 資料夾，使其中有 runtime\python.exe 即可。'
