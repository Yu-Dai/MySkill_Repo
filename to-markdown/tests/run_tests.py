"""回歸測試：把 tests/samples 轉一次，和 tests/expected 逐檔比對。

用法：python tests/run_tests.py
改了輸出格式後，確認差異是預期的，再把新輸出複製到 tests/expected。
沒有安裝 PDF 套件時會略過 pdf 樣本。
"""

import filecmp
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "to_markdown.py")
EXPECTED = os.path.join(HERE, "expected")


def main():
    try:
        import pdfplumber  # noqa: F401
        has_pdf = True
    except ImportError:
        has_pdf = False

    with tempfile.TemporaryDirectory() as out:
        subprocess.run([sys.executable, SCRIPT, os.path.join(HERE, "samples"),
                        "-o", out, "--no-slide-images"], check=False,
                       stdout=subprocess.DEVNULL)
        failed = 0
        for name in sorted(os.listdir(EXPECTED)):
            if not name.endswith(".md"):
                continue
            if name == "spec_demo.md" and not has_pdf:
                print("[略過] %s（沒有安裝 PDF 套件）" % name)
                continue
            actual = os.path.join(out, name)
            same = os.path.exists(actual) and filecmp.cmp(
                actual, os.path.join(EXPECTED, name), shallow=False)
            print("[%s] %s" % ("通過" if same else "不符", name))
            failed += 0 if same else 1
    print("全部通過" if not failed else "%d 個檔案與預期不符" % failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
