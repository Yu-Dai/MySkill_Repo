# 用本機的 PowerPoint 把指定投影片匯出成 PNG。
# 由 pptx.py 呼叫，參數從環境變數讀取：
#   TOMD_PPTX   簡報的完整路徑
#   TOMD_OUT    輸出資料夾
#   TOMD_SLIDES 要匯出的投影片編號，逗號分隔
#   TOMD_WIDTH  圖片寬度（像素）

$ErrorActionPreference = 'Stop'
$path = $env:TOMD_PPTX
$outDir = $env:TOMD_OUT
$numbers = $env:TOMD_SLIDES -split ',' | ForEach-Object { [int]$_ }
$width = [int]$env:TOMD_WIDTH

$app = New-Object -ComObject PowerPoint.Application
$pres = $null
try {
    # 參數依序為：唯讀、不另開未命名副本、不顯示視窗
    $pres = $app.Presentations.Open($path, -1, 0, 0)
    $height = [int]($width * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
    foreach ($n in $numbers) {
        $file = Join-Path $outDir ('slide-{0:D2}.png' -f $n)
        $pres.Slides.Item($n).Export($file, 'PNG', $width, $height)
    }
}
finally {
    if ($pres) { $pres.Close() }
    # 使用者可能正開著其他簡報：只有在沒有任何簡報開啟時才關閉 PowerPoint
    if ($app.Presentations.Count -eq 0) { $app.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
