#!/usr/bin/env python3
"""ToMarkdown 指令列進入點。

用法：
    python to_markdown.py 檔案或資料夾 [更多檔案...] -o 輸出資料夾 --mode fast|precise
    python to_markdown.py --check

--mode 必填：沒有指定時不會轉檔，而是印出要問使用者的問題。
一次可以給多個檔案或資料夾。單一檔案失敗不會中斷其他檔案。
"""

import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tomd import csv_conv, docx, mdutil, pdf, pptx, vision, xlsx  # noqa: E402

CONVERTERS = {
    ".xlsx": xlsx.convert, ".xlsm": xlsx.convert, ".csv": csv_conv.convert,
    ".docx": docx.convert, ".docm": docx.convert,
    ".pptx": pptx.convert, ".pptm": pptx.convert, ".ppsx": pptx.convert,
    ".pdf": pdf.convert,
}
# 舊格式不直接處理：請使用者自己用 Office 開啟後另存成新格式
LEGACY = {
    ".xls": ("Excel", ".xlsx"), ".xlsb": ("Excel", ".xlsx"),
    ".ppt": ("PowerPoint", ".pptx"), ".pps": ("PowerPoint", ".pptx"),
    ".doc": ("Word", ".docx"), ".rtf": ("Word", ".docx"),
}
SUPPORTED = set(CONVERTERS) | set(LEGACY)
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


def precise_status(config):
    """回傳 (精準模式是否可用, 說明)。會實際測試連線，不會印出金鑰。"""
    problem = vision.validate(config)
    if problem:
        return False, problem
    try:
        vision.Client(config).ping()
    except vision.VisionError as error:
        return False, "設定已填，但連線測試失敗：%s" % error
    return True, "設定已填，連線測試通過"


def ask_mode(config):
    """沒有指定 --mode 時：不轉檔，印出要問使用者的問題。"""
    ready, detail = precise_status(config)
    print("[需要先詢問使用者] 還沒有指定轉換方式，這次沒有轉換任何檔案。")
    print("請把下面的問題原樣問使用者，等使用者回答之後，")
    print("再加上 --mode fast 或 --mode precise 重新執行同一個指令。不要替使用者決定。")
    print()
    print("    要用哪一種方式轉換？")
    print("    1. 快速（預設）：只用腳本抽出文字、表格、圖片，幾秒內完成。")
    print("    2. 精準：另外請看圖模型描述每張圖、補上腳本抽不到的表格，圖多時需要幾分鐘。")
    if ready:
        print("       目前可用。")
    else:
        print("       目前不可用：%s" % detail)
        print("       要用精準方式，需要先把設定補好。")
    return 3


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
        print("pptx 投影片截圖：需要本機的 PowerPoint，轉檔時才會實際呼叫")
    else:
        print("pptx 投影片截圖：不可用（這台不是 Windows）")
    print("舊格式（xls、ppt、doc）：不支援，需要使用者先另存成 xlsx、pptx、docx")

    print("設定檔：%s（%s）" % (config_path, "存在" if config else "不存在或是空的"))
    ready, detail = precise_status(config)
    print("精準模式：%s（%s）" % ("可用" if ready else "不可用", detail))
    return 0 if ready else 1


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(
        description="把 xlsx、csv、docx、pptx、pdf 轉成給 LLM 閱讀的 Markdown")
    parser.add_argument("inputs", nargs="*", help="檔案或資料夾，可以給多個")
    parser.add_argument("-o", "--out", default="md_out", help="輸出資料夾（預設 md_out）")
    parser.add_argument("--mode", choices=("fast", "flash", "precise"),
                        help="必填。fast（同 flash）只用腳本；precise 會呼叫看圖模型。"
                             "要先問過使用者才能決定")
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
    if mode is None:
        return ask_mode(config)
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
        if os.path.splitext(path)[1].lower() in CONVERTERS)

    done = failed = skipped = resave = 0
    for path in files:
        name = os.path.basename(path)
        stem, ext = os.path.splitext(name)
        ext = ext.lower()
        if ext in LEGACY:
            app, new_ext = LEGACY[ext]
            print("[需要另存] %s：%s 是舊格式，無法直接轉換。請告訴使用者：用 %s 開啟這個檔案，"
                  "選「檔案」→「另存新檔」，存檔類型選 %s，再把新檔案拿來轉。"
                  % (name, ext, app, new_ext))
            resave += 1
            continue
        if ext not in CONVERTERS:
            print("[略過] %s：不支援的格式" % name)
            skipped += 1
            continue
        out_stem = stem if stems[stem.lower()] == 1 else "%s_%s" % (stem, ext[1:])
        options = dict(base_options, source_name=name, out_stem=out_stem)
        try:
            result = CONVERTERS[ext](path, args.out, options)
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
        for notice in result.notices:
            print("  [提醒] " + notice)
        done += 1

    print("\n完成 %d 個，失敗 %d 個，略過 %d 個，需要使用者先另存新檔 %d 個。輸出資料夾：%s"
          % (done, failed, skipped, resave, os.path.abspath(args.out)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
