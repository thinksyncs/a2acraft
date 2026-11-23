"""Build the bilingual gameplay film page from the repository's release media."""
import argparse
import re
import shutil
from html import escape
from pathlib import Path
from string import Template


SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
REPO = "https://github.com/thinksyncs/a2acraft"
COPY = {
    "ja": {
        "title": "ゲームプレイ映像",
        "summary": "村を歩き、仲間の依頼を引き受け、王城で報告を聞く。A2ACraftの世界を45秒で紹介します。",
        "language": "日本語", "navigation": "ナビゲーション", "video_label": "A2ACraft 紹介動画（日本語、45秒）",
        "language_choice": "表示言語",
        "download": "動画を保存（MP4）", "captions": "字幕を保存（VTT）", "try_mac": "Mac版を試す",
        "guide": REPO + "/blob/main/README.ja.md#macで試す",
    },
    "en": {
        "title": "Gameplay film",
        "summary": "Walk through the village, take on a quest and hear the party reports at the castle in this 45-second tour of A2ACraft.",
        "language": "English", "navigation": "Navigation", "video_label": "A2ACraft gameplay film in English, 45 seconds",
        "language_choice": "Display language",
        "download": "Download film (MP4)", "captions": "Download captions (VTT)", "try_mac": "Try it on Mac",
        "guide": REPO + "/blob/main/README.md#try-a2acraft-on-mac",
    },
}


def build(output):
    media = output / "media"
    media.mkdir(parents=True, exist_ok=True)
    template = Template((SITE / "film.html").read_text(encoding="utf-8"))
    shutil.copyfile(SITE / "film.css", output / "film.css")
    shutil.copyfile(ROOT / "assets/mac/A2ACraft.iconset/icon_128x128.png", media / "icon.png")
    for lang, strings in COPY.items():
        page = output if lang == "ja" else output / lang
        page.mkdir(exist_ok=True)
        html = template.substitute(lang=lang, prefix="./" if lang == "ja" else "../",
                                   en_current=' aria-current="page"' if lang == "en" else "",
                                   ja_current=' aria-current="page"' if lang == "ja" else "",
                                   **{key: escape(value) for key, value in strings.items()})
        (page / "index.html").write_text(html, encoding="utf-8")
        for name in (f"a2acraft-{lang}-45s.mp4", f"poster-{lang}.jpg"):
            shutil.copyfile(ROOT / "media" / name, media / name)
        srt = (ROOT / "subtitles" / f"{lang}.srt").read_text(encoding="utf-8-sig")
        timings = r"^(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})$"
        vtt, cues = re.subn(timings, r"\1.\2 --> \3.\4", srt, flags=re.MULTILINE)
        if not cues or vtt.count("-->") != cues:
            raise ValueError(f"Invalid caption timings in {lang}.srt")
        (media / f"{lang}.vtt").write_text("WEBVTT\n\n" + vtt, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)
