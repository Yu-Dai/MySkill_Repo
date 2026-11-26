@echo off
rem ToMarkdown 啟動檔：有隨附的執行環境就用它，否則用系統的 Python。
setlocal
set "HERE=%~dp0"
if exist "%HERE%runtime\python.exe" (
    "%HERE%runtime\python.exe" "%HERE%scripts\to_markdown.py" %*
) else (
    python "%HERE%scripts\to_markdown.py" %*
)
exit /b %ERRORLEVEL%
