"""舊格式（.xls、.ppt、.doc 等）先轉成新格式，再交給一般的轉檔流程。

Windows 上用本機已安裝的 Office 另存新檔；其他系統若有 LibreOffice 則用它。
不自己解析舊的二進位格式，因為那需要額外套件，而且品質不如 Office 自己轉。
"""

import os
import shutil
import subprocess

# 舊副檔名 -> (新副檔名, 用哪個 Office 程式)
FORMATS = {
    ".xls": (".xlsx", "excel"), ".xlsb": (".xlsx", "excel"), ".xlt": (".xlsx", "excel"),
    ".ppt": (".pptx", "powerpoint"), ".pps": (".pptx", "powerpoint"),
    ".doc": (".docx", "word"), ".rtf": (".docx", "word"),
}
_APP_NAMES = {"excel": "Excel", "powerpoint": "PowerPoint", "word": "Word"}
_PS_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "convert_legacy.ps1")


def convert(path, work_dir):
    """把舊格式轉成新格式，回傳新檔案的路徑。失敗時丟出 RuntimeError。"""
    stem, ext = os.path.splitext(os.path.basename(path))
    new_ext, app = FORMATS[ext.lower()]
    target = os.path.join(work_dir, stem + new_ext)

    if os.name == "nt":
        env = dict(os.environ, TOMD_SRC=os.path.abspath(path),
                   TOMD_DST=os.path.abspath(target), TOMD_APP=app)
        with open(_PS_SCRIPT, encoding="utf-8") as handle:
            script = handle.read()
        try:
            done = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", "-"],
                input=script, env=env, capture_output=True, text=True, timeout=300)
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError("無法呼叫 %s 轉換舊格式：%s" % (_APP_NAMES[app], error))
        if done.returncode != 0 or not os.path.exists(target):
            detail = (done.stderr or done.stdout or "").strip().splitlines()
            raise RuntimeError("%s 無法把這個檔案另存成 %s：%s"
                               % (_APP_NAMES[app], new_ext, detail[-1] if detail else "未知原因"))
        return target

    office = shutil.which("soffice") or shutil.which("libreoffice")
    if not office:
        raise RuntimeError("%s 是舊格式，需要 Windows 上的 %s（或 LibreOffice）先轉成 %s"
                           % (ext, _APP_NAMES[app], new_ext))
    try:
        subprocess.run([office, "--headless", "--convert-to", new_ext[1:],
                        "--outdir", work_dir, path],
                       capture_output=True, timeout=300, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("LibreOffice 轉換失敗：%s" % error)
    if not os.path.exists(target):
        raise RuntimeError("LibreOffice 無法把這個檔案轉成 %s" % new_ext)
    return target
