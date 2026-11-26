"""精準模式：請看圖模型描述圖片、轉寫腳本處理不了的頁面。

對已經轉好的 Markdown 做後處理，所以五種格式共用同一套邏輯：
找出圖片連結，呼叫模型，把結果以引言區塊插在連結後面。

API 採 OpenAI 相容的 chat completions 格式。金鑰放在哪個 header 由設定檔決定，
因為有些閘道不用 Authorization: Bearer，而是自訂的 header（例如 api-key）。
"""

import base64
import hashlib
import io
import json
import os
import re
import struct
import urllib.error
import urllib.request

_IMAGE_RE = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+_assets/[^)\s]+)\)$")
_PAGE_RE = re.compile(r"^> \[此頁.*\]\(([^)\s]+_assets/page-\d+\.png)\)$")
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)
_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}
_CONTEXT_LIMIT = 3000
_MIN_SIDE_PX = 48
_MAX_FAILURES = 3

MARK_DESCRIBE = "[AI 描述，請對照原圖]"
MARK_TRANSCRIBE = "[AI 轉寫，請對照原圖]"

_PROMPTS = {
    "describe": (
        "你在協助建立技術文件的知識庫。請用繁體中文描述這張圖，讓沒看到圖的人也能理解："
        "圖的類型（方塊圖、時序圖、電路圖、流程圖、照片、畫面截圖等）、主要元件與彼此的關係、"
        "圖上所有可辨識的文字、數值與單位。只描述看得到的內容；看不清楚的地方請直接說看不清楚，"
        "不要猜測。不要加開場白或結語。"),
    "slide": (
        "這是一張簡報投影片的截圖。請用繁體中文說明這張投影片的圖解在表達什麼："
        "各方塊之間的關係、流程順序、分支條件。下方附有程式從投影片抽出的文字與連接關係，"
        "若其中有錯誤或遺漏請明確指出。只根據圖上看得到的內容，不要推測。不要加開場白或結語。"),
    "transcribe": (
        "這是一頁技術文件的截圖，程式抽取的文字可能不完整。請用繁體中文處理這一頁："
        "把頁面上的表格轉寫成 Markdown 表格；圖表、時序圖、方塊圖則用文字描述其內容、訊號與數值。"
        "十六進位值、位元範圍、訊號名稱、單位必須照原樣抄寫；看不清楚的字用 [?] 標示，不可猜測。"
        "下方附有程式已經抽出的文字，其中正確的部分不需要重複。不要加開場白或結語。"),
}


class VisionError(Exception):
    pass


def validate(config):
    """檢查設定是否足以呼叫 API。回傳錯誤訊息，沒問題時回傳 None。"""
    vision = config.get("vision") or {}
    missing = [key for key in ("base_url", "model")
               if not vision.get(key) or "你的" in vision[key] or vision[key] == "模型名稱"]
    key = os.environ.get("TOMD_API_KEY") or vision.get("api_key", "")
    if not key or "你的" in key:
        missing.append("api_key（或環境變數 TOMD_API_KEY）")
    if missing:
        return "精準模式需要先在 config.json 的 vision 區塊填好：" + "、".join(missing)
    return None


def _image_size(data):
    """讀出 PNG 或 GIF 的寬高；其他格式回傳 None。"""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    return None


def _shrink(data, mime, max_side):
    """圖片太大時縮小。沒有安裝 Pillow 就原樣送出。"""
    try:
        from PIL import Image
    except ImportError:
        return data, mime
    try:
        picture = Image.open(io.BytesIO(data))
        if max(picture.size) <= max_side:
            return data, mime
        picture.thumbnail((max_side, max_side))
        buffer = io.BytesIO()
        picture.convert("RGB").save(buffer, "PNG")
        return buffer.getvalue(), "image/png"
    except Exception:
        return data, mime


class Client:
    def __init__(self, config):
        vision = config["vision"]
        base = vision["base_url"].rstrip("/")
        self.url = base if base.endswith("/chat/completions") else base + "/chat/completions"
        self.model = vision["model"]
        key = os.environ.get("TOMD_API_KEY") or vision["api_key"]
        self.headers = {
            "Content-Type": "application/json",
            vision.get("api_key_header") or "Authorization":
                (vision.get("api_key_prefix") or "") + key,
        }
        self.timeout = int(vision.get("timeout_seconds", 120))
        self.max_side = int(vision.get("max_image_side_px", 1600))

    def ask(self, prompt, data, mime):
        data, mime = _shrink(data, mime, self.max_side)
        body = json.dumps({
            "model": self.model,
            "temperature": 0,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {
                    "url": "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))}},
            ]}],
        }).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, headers=self.headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:200]
            raise VisionError("HTTP %d：%s" % (error.code, " ".join(detail.split())))
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise VisionError(str(error))
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise VisionError("回應格式不符預期：%s" % json.dumps(payload, ensure_ascii=False)[:200])
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        return _THINK_RE.sub("", content or "").strip()


def _quote(mark, text, inline):
    lines = text.splitlines()
    if inline and len(lines) == 1:
        return "> %s %s" % (mark, lines[0])
    return "\n".join(["> " + mark, ">"] + [("> " + line).rstrip() for line in lines])


def annotate(markdown, out_dir, config, warnings):
    """回傳 (加上 AI 內容的 Markdown, 統計)。"""
    client = Client(config)
    lines = markdown.split("\n")
    stats = {"ai_calls": 0, "ai_cached": 0, "ai_skipped": 0}
    cache_path, cache = None, {}
    failures = 0
    stopped = False

    # 每個圖片所在段落（以 ## 標題為界）的文字，當作提示的對照資料
    section_of, sections, current = {}, {}, 0
    for index, line in enumerate(lines):
        if line.startswith("## "):
            current = index
        section_of[index] = current
        if not _IMAGE_RE.match(line) and not line.startswith("> "):
            sections.setdefault(current, []).append(line)

    out = []
    for index, line in enumerate(lines):
        out.append(line)
        page = _PAGE_RE.match(line)
        image = _IMAGE_RE.match(line)
        if not page and not image:
            continue
        link = page.group(1) if page else image.group(2)
        if page:
            kind = "transcribe"
        elif image.group(1).startswith("slide-"):
            kind = "slide"
        else:
            kind = "describe"

        path = os.path.join(out_dir, link.replace("/", os.sep))
        mime = _MIME.get(os.path.splitext(path)[1].lower())
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError:
            continue
        size = _image_size(data)
        if mime is None or (size and max(size) < _MIN_SIDE_PX):
            stats["ai_skipped"] += 1
            continue

        if cache_path is None:
            cache_path = os.path.join(os.path.dirname(path), "vision_cache.json")
            try:
                with open(cache_path, encoding="utf-8") as handle:
                    cache = json.load(handle)
            except (OSError, ValueError):
                cache = {}
        key = "%s:%s:%s" % (hashlib.sha1(data).hexdigest(), kind, client.model)

        if key in cache:
            answer = cache[key]
            stats["ai_cached"] += 1
        elif stopped:
            continue
        else:
            context = "\n".join(sections.get(section_of[index], [])).strip()[:_CONTEXT_LIMIT]
            prompt = _PROMPTS[kind]
            if context:
                prompt += "\n\n程式已抽出的內容：\n" + context
            try:
                answer = client.ask(prompt, data, mime)
                failures = 0
                stats["ai_calls"] += 1
            except VisionError as error:
                failures += 1
                warnings.append("看圖 API 呼叫失敗（%s）：%s" % (link, error))
                if failures >= _MAX_FAILURES:
                    stopped = True
                    warnings.append("連續失敗 %d 次，其餘圖片不再呼叫 API" % failures)
                continue
            if not answer:
                continue
            cache[key] = answer
            with open(cache_path, "w", encoding="utf-8") as handle:
                json.dump(cache, handle, ensure_ascii=False, indent=1)

        mark = MARK_TRANSCRIBE if kind == "transcribe" else MARK_DESCRIBE
        out.append("")
        out.append(_quote(mark, answer, inline=kind != "transcribe"))
    return "\n".join(out), stats
