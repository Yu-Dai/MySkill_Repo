#!/usr/bin/env python3
"""ToMarkdown 指令列進入點。

用法：
    python to_markdown.py 檔案或資料夾 [更多檔案...] -o 輸出資料夾 [--mode fast|precise]

一次可以給多個檔案或資料夾。單一檔案失敗不會中斷其他檔案。
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tomd import csv_conv, docx, mdutil, pdf, pptx, vision, xlsx  # noqa: E402

CONVERTERS = {
    ".xlsx": xlsx.convert, ".xlsm": xlsx.convert, ".csv": csv_conv.convert,
    ".docx": docx.convert, ".docm": docx.convert,
    ".pptx": pptx.convert, ".pptm": pptx.convert,
    ".pdf": pdf.convert,
}
PLANNED = set()
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_config(path):
    path = path or os.path.join(SKILL_DIR, "config.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def collect(inputs):
    files = []
    for item in inputs:
        if os.path.isdir(item):
            for folder, _, names in os.walk(item):
                for name in sorted(names):
                    ext = os.path.splitext(name)[1].lower()
                    if not name.startswith("~$") and (ext in CONVERTERS or ext in PLANNED):
                        files.append(os.path.join(folder, name))
        else:
            files.append(item)
    return files


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(description="把 xlsx、csv、docx、pptx、pdf 轉成給 LLM 閱讀的 Markdown")
    parser.add_argument("inputs", nargs="+", help="檔案或資料夾，可以給多個")
    parser.add_argument("-o", "--out", default="md_out", help="輸出資料夾（預設 md_out）")
    parser.add_argument("--mode", choices=("fast", "precise"), default="fast")
    parser.add_argument("--no-slide-images", action="store_true",
                        help="pptx 不產生投影片截圖")
    parser.add_argument("--config", help="設定檔路徑（預設為技能資料夾內的 config.json）")
    args = parser.parse_args()

    config = load_config(args.config)
    if args.mode == "precise":
        problem = vision.validate(config)
        if problem:
            print(problem)
            return 2
    options = dict(config.get("output", {}), mode=args.mode)
    if args.no_slide_images:
        options["slide_images"] = False
    os.makedirs(args.out, exist_ok=True)

    done = failed = skipped = 0
    for path in collect(args.inputs):
        name = os.path.basename(path)
        ext = os.path.splitext(name)[1].lower()
        if ext not in CONVERTERS:
            reason = "尚未支援" if ext in PLANNED else "不支援的格式"
            print("[略過] %s：%s" % (name, reason))
            skipped += 1
            continue
        try:
            result = CONVERTERS[ext](path, args.out, options)
        except Exception as error:  # 單一檔案失敗不影響其他檔案
            print("[失敗] %s：%s" % (name, error))
            failed += 1
            continue

        if args.mode == "precise":
            try:
                result.markdown, ai_stats = vision.annotate(
                    result.markdown, args.out, config, result.warnings)
                result.stats.update(ai_stats)
            except Exception as error:  # 看圖失敗時仍保留腳本抽取的結果
                result.warnings.append("精準模式處理失敗，輸出只含腳本抽取的內容：%s" % error)

        target = os.path.join(args.out, os.path.splitext(name)[0] + ".md")
        with open(target, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(result.markdown)
        missing = mdutil.check_coverage(result)
        stats = "，".join("%s=%s" % item for item in result.stats.items())
        print("[完成] %s -> %s（%s）" % (name, target, stats))
        if missing:
            print("  [檢查] 有 %d 段來源文字沒有出現在輸出，前幾段：%s"
                  % (len(missing), "、".join(repr(text[:30]) for text in missing[:5])))
        else:
            print("  [檢查] 文字覆蓋通過")
        for warning in result.warnings:
            print("  [警告] " + warning)
        done += 1

    print("\n完成 %d 個，失敗 %d 個，略過 %d 個。輸出資料夾：%s"
          % (done, failed, skipped, os.path.abspath(args.out)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
