#!/usr/bin/env python3
"""ToMarkdown 指令列進入點。

用法：
    python to_markdown.py 檔案或資料夾 [更多檔案...] -o 輸出資料夾 [--mode fast|precise]
    python to_markdown.py --check

一次可以給多個檔案或資料夾。單一檔案失敗不會中斷其他檔案。
"""

import argparse
import collections
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tomd import csv_conv, docx, legacy, mdutil, pdf, pptx, vision, xlsx  # noqa: E402

CONVERTERS = {
    ".xlsx": xlsx.convert, ".xlsm": xlsx.convert, ".csv": csv_conv.convert,
    ".docx": docx.convert, ".docm": docx.convert,
    ".pptx": pptx.convert, ".pptm": pptx.convert, ".ppsx": pptx.convert,
    ".pdf": pdf.convert,
}
SUPPORTED = set(CONVERTERS) | set(legacy.FORMATS)
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_config(path):
    path = path or os.path.join(SKILL_DIR, "config.json")
    if not os.path.exists(path):
        return {}, path
    with open(path, encoding="utf-8") as handle:
        return json.load(handle), path


def collect(inputs):
    files = []
    for item in inputs:
        if os.path.isdir(item):
            for folder, _, names in os.walk(item):
                for name in sorted(names):
                    ext = os.path.splitext(name)[1].lower()
                    if not name.startswith("~$") and ext in SUPPORTED:
                        files.append(os.path.join(folder, name))
        else:
            files.append(item)
    return files


def check(config, config_path):
    """回報環境與設定狀態，讓使用者（或 AI）決定能用哪種模式。不會印出金鑰。"""
    print("Python：%s" % sys.version.split()[0])
    print("xlsx、csv、docx、pptx：可用")
    try:
        pdf._load_libs()
        print("pdf：可用")
    except RuntimeError:
        print("pdf：不可用（缺少 pdfplumber、pypdfium2）")
    if os.name == "nt":
        print("舊格式（xls、ppt、doc）與投影片截圖：需要本機的 Office，轉檔時才會實際呼叫")
    else:
        print("舊格式與投影片截圖：這台不是 Windows，投影片截圖不可用")

    print("設定檔：%s（%s）" % (config_path, "存在" if config else "不存在或是空的"))
    problem = vision.validate(config)
    if problem:
        print("精準模式：不可用。" + problem)
        return 1
    try:
        vision.Client(config).ping()
    except vision.VisionError as error:
        print("精準模式：不可用。設定已填，但連線測試失敗：%s" % error)
        return 1
    print("精準模式：可用（設定已填，連線測試通過）")
    return 0


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(
        description="把 xlsx、csv、docx、pptx、pdf（含舊格式 xls、ppt、doc）轉成給 LLM 閱讀的 Markdown")
    parser.add_argument("inputs", nargs="*", help="檔案或資料夾，可以給多個")
    parser.add_argument("-o", "--out", default="md_out", help="輸出資料夾（預設 md_out）")
    parser.add_argument("--mode", choices=("fast", "flash", "precise"), default="fast",
                        help="fast（預設，同 flash）只用腳本；precise 會呼叫看圖模型")
    parser.add_argument("--check", action="store_true",
                        help="只檢查環境與設定，回報哪些格式與模式可用")
    parser.add_argument("--no-slide-images", action="store_true",
                        help="pptx 不產生投影片截圖")
    parser.add_argument("--config", help="設定檔路徑（預設為技能資料夾內的 config.json）")
    args = parser.parse_args()
    mode = "fast" if args.mode == "flash" else args.mode

    config, config_path = load_config(args.config)
    if args.check:
        return check(config, config_path)
    if not args.inputs:
        parser.error("請給要轉換的檔案或資料夾")
    if mode == "precise":
        problem = vision.validate(config)
        if problem:
            print(problem)
            return 2

    base_options = dict(config.get("output", {}), mode=mode)
    if args.no_slide_images:
        base_options["slide_images"] = False
    os.makedirs(args.out, exist_ok=True)

    files = collect(args.inputs)
    # 同名不同格式的檔案，輸出檔名加上格式，避免互相覆蓋
    stems = collections.Counter(
        os.path.splitext(os.path.basename(path))[0].lower() for path in files
        if os.path.splitext(path)[1].lower() in SUPPORTED)

    done = failed = skipped = 0
    with tempfile.TemporaryDirectory(prefix="tomd_") as work_dir:
        for path in files:
            name = os.path.basename(path)
            stem, ext = os.path.splitext(name)
            ext = ext.lower()
            if ext not in SUPPORTED:
                print("[略過] %s：不支援的格式" % name)
                skipped += 1
                continue
            out_stem = stem if stems[stem.lower()] == 1 else "%s_%s" % (stem, ext[1:])
            options = dict(base_options, source_name=name, out_stem=out_stem)
            try:
                source = path
                if ext in legacy.FORMATS:
                    source = legacy.convert(path, work_dir)
                    ext = os.path.splitext(source)[1].lower()
                result = CONVERTERS[ext](source, args.out, options)
            except Exception as error:  # 單一檔案失敗不影響其他檔案
                print("[失敗] %s：%s" % (name, error))
                failed += 1
                continue

            if mode == "precise":
                try:
                    result.markdown, ai_stats = vision.annotate(
                        result.markdown, args.out, config, result.warnings)
                    result.stats.update(ai_stats)
                except Exception as error:  # 看圖失敗時仍保留腳本抽取的結果
                    result.warnings.append("精準模式處理失敗，輸出只含腳本抽取的內容：%s" % error)

            target = os.path.join(args.out, out_stem + ".md")
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
