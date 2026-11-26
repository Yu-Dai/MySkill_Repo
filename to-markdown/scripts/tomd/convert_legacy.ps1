# 用本機的 Office 把舊格式另存成新格式。
# 由 legacy.py 呼叫，參數從環境變數讀取：
#   TOMD_SRC 來源檔完整路徑
#   TOMD_DST 輸出檔完整路徑
#   TOMD_APP excel、powerpoint 或 word

$ErrorActionPreference = 'Stop'
$src = $env:TOMD_SRC
$dst = $env:TOMD_DST

switch ($env:TOMD_APP) {
    'excel' {
        $app = New-Object -ComObject Excel.Application
        try {
            $app.Visible = $false
            $app.DisplayAlerts = $false
            $app.AutomationSecurity = 3          # 開檔時停用巨集
            $book = $app.Workbooks.Open($src, 0, $true)   # 不更新連結、唯讀
            $book.SaveAs($dst, 51)               # 51 = xlsx
            $book.Close($false)
        }
        finally {
            $app.Quit()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
        }
    }
    'word' {
        $app = New-Object -ComObject Word.Application
        try {
            $app.Visible = $false
            $app.DisplayAlerts = 0
            $app.AutomationSecurity = 3
            $doc = $app.Documents.Open($src, $false, $true)   # 不詢問轉換、唯讀
            $doc.SaveAs2($dst, 12)               # 12 = docx
            $doc.Close($false)
        }
        finally {
            $app.Quit()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
        }
    }
    'powerpoint' {
        $app = New-Object -ComObject PowerPoint.Application
        $pres = $null
        try {
            $app.AutomationSecurity = 3
            $pres = $app.Presentations.Open($src, -1, 0, 0)   # 唯讀、不顯示視窗
            $pres.SaveCopyAs($dst, 24)           # 24 = pptx
        }
        finally {
            if ($pres) { $pres.Close() }
            # 使用者可能正開著其他簡報：只有在沒有任何簡報開啟時才關閉 PowerPoint
            if ($app.Presentations.Count -eq 0) { $app.Quit() }
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
        }
    }
    default { throw "未知的程式：$($env:TOMD_APP)" }
}
