#!/usr/bin/env python3
"""Build the checked-in bilingual catalog from pinned, attributed source snapshots.

Python standard library only. Sources (65.9 MB + 6.6 MB) are cached outside the
repository by default; media is never downloaded. Rebuild with:
  python3 scripts/build_vocab.py --download
or provide --english /path/ecdict.csv --japanese /path/notes.csv.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
import unicodedata
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ZH = re.compile(r"[\u3400-\u9fff]")
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
HTML = re.compile(r"</?[A-Za-z][^>]*>")
ENGLISH_TAGS = ("cet4", "cet6", "ielts", "toefl", "gre")
SNAPSHOTS = {
    "ecdict": {
        "repository": "https://github.com/skywind3000/ECDICT",
        "revision": "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b",
        "path": "ecdict.csv",
        "licensePath": "LICENSE",
        "licenseFile": "ECDICT-MIT.txt",
        "expectedSha256": "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf",
    },
    "eggrolls-jlpt": {
        "repository": "https://github.com/5mdld/anki-jlpt-decks",
        "revision": "853798a4dec3630cad1984aa1c7edab31b09d109",
        "path": "deck-source/notes.csv",
        "licensePath": "LICENSE",
        "licenseFile": "JLPT-CC-BY-NC-4.0.txt",
        "expectedSha256": "30e9350c92c7bdeaf0f4c0317c9a0f659eb32e606a69870176deff159559eb1a",
    },
}
SOURCES = [
    {
        "id": "ecdict",
        "name": "ECDICT · skywind3000 与贡献者",
        "url": SNAPSHOTS["ecdict"]["repository"],
        "license": "MIT",
        "licenseUrl": "/licenses/ECDICT-MIT.txt",
        "note": "依据 ECDICT 考试标签及 BNC/COCA 词频整理；仅保留有中文释义的词条，合并重复词形、清理格式并重新分阶。考试词表存在交叉，等级标签不是官方考试大纲。",
    },
    {
        "id": "eggrolls-jlpt",
        "name": "egg rolls · JLPT N1–N5 一万词 v3.5",
        "url": SNAPSHOTS["eggrolls-jlpt"]["repository"],
        "license": "CC BY-NC 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans",
        "note": "原作者 egg rolls；仅限非商业使用。此版提取简体中文释义与第一条例句，移除 HTML 和音频、合并同形同音词并重新分阶。JLPT 分类是作者整理，非官方词汇大纲。许可原文见 /licenses/JLPT-CC-BY-NC-4.0.txt。",
    },
]


class TextExtractor(HTMLParser):
    """Remove presentation markup without accidentally retaining script contents."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "rt", "rp"):
            self.hidden += 1
        elif tag in ("br", "div", "p", "li") and not self.hidden:
            self.parts.append("; ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "rt", "rp"):
            self.hidden = max(0, self.hidden - 1)
        elif tag in ("div", "p", "li") and not self.hidden:
            self.parts.append("; ")

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)


def clean(value):
    value = html.unescape(value or "").replace("\\r\\n", "; ").replace("\\n", "; ").replace("\\r", "; ")
    if HTML.search(value):
        parser = TextExtractor()
        parser.feed(value)
        value = "".join(parser.parts)
    value = re.sub(r"\[sound:[^\]]*\]", "", value)
    value = CONTROL.sub(" ", value)
    # A few legacy dictionary medical glosses contain unmapped private-use
    # glyphs. Omit those malformed subdefinitions, preserving the usable gloss.
    value = ";".join(part for part in value.split(";") if not any(unicodedata.category(char) == "Co" for char in part))
    value = "".join(char for char in value if unicodedata.category(char) != "Cf")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"(?:;\s*){2,}", "; ", value)
    return unicodedata.normalize("NFC", value.strip(" ;"))


def stable_id(language, spelling, reading=""):
    # English pronunciation differences share progress; Japanese homophones do not.
    key = unicodedata.normalize("NFKC", spelling).casefold()
    if language == "ja":
        key += "\0" + unicodedata.normalize("NFKC", reading)
    return language + "-" + hashlib.sha256(key.encode()).hexdigest()[:16]


def source_url(source, file_key="path"):
    spec = SNAPSHOTS[source]
    repo = spec["repository"].removeprefix("https://github.com/")
    return f"https://raw.githubusercontent.com/{repo}/{spec['revision']}/{spec[file_key]}"


def rank(row):
    ranks = [int(row[key]) for key in ("bnc", "frq") if row[key].isdigit() and int(row[key]) > 0]
    return min(ranks, default=10**9)


def merge_word(existing, word):
    if word["meaning"] != existing["meaning"] and word["meaning"] not in existing["meaning"].split(" / "):
        existing["meaning"] += " / " + word["meaning"]
    existing["tags"] = sorted(set(existing["tags"] + word["tags"]))
    if not existing["reading"] and word["reading"]:
        existing["reading"] = word["reading"]
    if not existing.get("example") and word.get("example"):
        existing["example"] = word["example"]
        existing["exampleMeaning"] = word["exampleMeaning"]


def build_english(path):
    records = {}
    source_rows = 0
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            source_rows += 1
            spelling = clean(row["word"])
            meaning = clean(row["translation"])
            tags = sorted(set(row["tag"].split()))
            if not ZH.search(meaning) or not re.fullmatch(r"[A-Za-z]+(?:[-' ][A-Za-z]+)*", spelling):
                continue
            # Exclude capitalized proper names from the common-language foundation.
            core_candidate = (spelling.islower() or spelling == "I") and bool(re.fullmatch(r"[a-z]+|I", spelling))
            core_candidate &= not bool(re.search(r"人名|姓氏|男子名|女子名|男名|女名|地名", meaning))
            if not (core_candidate and rank(row) < 10000) and not set(tags).intersection(ENGLISH_TAGS):
                continue
            word_id = stable_id("en", spelling)
            word = {
                "id": word_id, "language": "en", "word": spelling,
                "reading": clean(row["phonetic"]), "meaning": meaning,
                "tags": tags, "source": "ecdict",
            }
            if word_id in records:
                merge_word(records[word_id]["word"], word)
                records[word_id]["rank"] = min(records[word_id]["rank"], rank(row))
                records[word_id]["core"] |= core_candidate
                if core_candidate:
                    records[word_id]["word"]["word"] = spelling
            else:
                records[word_id] = {"word": word, "rank": rank(row), "core": core_candidate}
    ordered = sorted(records.values(), key=lambda entry: (entry["rank"], entry["word"]["word"].casefold(), entry["word"]["id"]))
    groups = {"en-core": [x["word"]["id"] for x in ordered if x["core"]][:1000]}
    for tag in ENGLISH_TAGS:
        groups[f"en-{tag}"] = [x["word"]["id"] for x in ordered if tag in x["word"]["tags"]]
    used = set(word_id for ids in groups.values() for word_id in ids)
    words = [record["word"] for word_id, record in records.items() if word_id in used]
    return words, groups, {"sourceRows": source_rows, "retainedUniqueWords": len(words)}


def build_japanese(path):
    records = {}
    groups = {f"ja-n{level}": {} for level in (5, 4, 3, 2, 1)}
    source_rows = 0
    skipped = 0
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = csv.reader((line for line in stream if not line.startswith("#")), delimiter="\t")
        for row in rows:
            source_rows += 1
            if len(row) != 39:
                raise ValueError(f"JLPT source schema changed at row {source_rows}: expected 39 columns")
            level_match = re.search(r"N([1-5])", row[1])
            spelling, reading, meaning = map(clean, (row[3], row[6], row[7]))
            if not (level_match and spelling and reading and ZH.search(meaning)):
                skipped += 1
                continue
            level = level_match.group(1)
            word_id = stable_id("ja", spelling, reading)
            tags = [f"N{level}"]
            if clean(row[5]):
                tags.append(clean(row[5]))
            frequency = re.search(r"[高中低]频", row[1])
            if frequency:
                tags.append(frequency.group())
            word = {
                "id": word_id, "language": "ja", "word": spelling,
                "reading": reading, "meaning": meaning,
                "tags": sorted(set(tags)), "source": "eggrolls-jlpt",
            }
            example, example_meaning = clean(row[12]), clean(row[14])
            if example and example_meaning:
                word.update(example=example, exampleMeaning=example_meaning)
            if word_id in records:
                merge_word(records[word_id], word)
            else:
                records[word_id] = word
            position = float(row[35]) if row[35] else float("inf")
            group = groups[f"ja-n{level}"]
            group[word_id] = min(position, group.get(word_id, float("inf")))
    groups = {key: sorted(ids, key=lambda word_id: (ids[word_id], records[word_id]["word"], word_id)) for key, ids in groups.items()}
    return list(records.values()), groups, {
        "sourceRows": source_rows, "retainedUniqueWords": len(records),
        "mergedDuplicateRows": source_rows - skipped - len(records), "skippedRows": skipped,
    }


def courses_and_stages(groups):
    english_names = {"core": "日常英语 · 核心 1000", "cet4": "大学英语四级", "cet6": "大学英语六级", "ielts": "IELTS 雅思", "toefl": "TOEFL 托福", "gre": "GRE 进阶"}
    japanese_names = {5: "N5 · 日语入门", 4: "N4 · 基础表达", 3: "N3 · 日常交流", 2: "N2 · 进阶应用", 1: "N1 · 高阶精通"}
    courses, stages = [], []
    core_end = None
    japanese_previous = None
    for course_id, word_ids in groups.items():
        language, label = course_id.split("-")
        title = english_names[label] if language == "en" else japanese_names[int(label[1])]
        if language == "en":
            description = "按 BNC/COCA 词频排序的常用基础词汇，适合从零开始。" if label == "core" else "完成核心英语后解锁，依据 ECDICT 考试标签整理，按词频循序学习。"
            source = "ecdict"
            previous = None if label == "core" else core_end
        else:
            description = "从 N5 到 N1 逐级解锁，沿用原词库的难度与词频顺序，附中文释义和例句。"
            source = "eggrolls-jlpt"
            previous = japanese_previous
        courses.append({"id": course_id, "title": title, "language": language, "description": description, "sourceUrl": SNAPSHOTS[source]["repository"]})
        for offset in range(0, len(word_ids), 100):
            index = offset // 100 + 1
            stage_id = f"{course_id}-{index:03d}"
            stages.append({
                "id": stage_id, "courseId": course_id, "language": language,
                "title": f"第 {index} 阶段", "index": index,
                "prerequisiteId": previous, "wordIds": word_ids[offset:offset + 100],
            })
            previous = stage_id
        if course_id == "en-core":
            core_end = previous
        if language == "ja":
            japanese_previous = previous
    return courses, stages


def validate(catalog):
    words = {word["id"]: word for word in catalog["words"]}
    stages = {stage["id"]: stage for stage in catalog["stages"]}
    sources = {source["id"] for source in catalog["sources"]}
    assert len(words) == len(catalog["words"]), "Duplicate word ids"
    assert len(stages) == len(catalog["stages"]), "Duplicate stage ids"
    for word in words.values():
        assert word["word"] and ZH.search(word["meaning"]), word
        assert word["source"] in sources
        assert word["id"] == stable_id(word["language"], word["word"], word["reading"])
        for key in ("word", "reading", "meaning", "example", "exampleMeaning"):
            assert not CONTROL.search(word.get(key, "")), (word["id"], key)
            assert not HTML.search(word.get(key, "")), (word["id"], key)
    for stage in stages.values():
        assert 1 <= len(stage["wordIds"]) <= 100
        assert len(set(stage["wordIds"])) == len(stage["wordIds"])
        assert all(word_id in words and words[word_id]["language"] == stage["language"] for word_id in stage["wordIds"])
        visited = {stage["id"]}
        previous = stage["prerequisiteId"]
        while previous:
            assert previous in stages and previous not in visited
            visited.add(previous)
            previous = stages[previous]["prerequisiteId"]
    assert sum(stage["prerequisiteId"] is None for stage in stages.values()) == 2


def write_json(path, content, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, ensure_ascii=False, indent=None if compact else 2, separators=(",", ":") if compact else None) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--english", type=Path)
    parser.add_argument("--japanese", type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "wordsteps-vocab-sources")
    parser.add_argument("--snapshot-date", default=dt.datetime.now(dt.timezone.utc).date().isoformat())
    args = parser.parse_args()
    files = {"ecdict": args.english or args.cache / "ecdict.csv", "eggrolls-jlpt": args.japanese or args.cache / "notes.csv"}
    for source, path in files.items():
        if not path.exists():
            if not args.download:
                parser.error(f"Missing {path}; provide source files or use --download")
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(source_url(source), timeout=120) as response:
                path.write_bytes(response.read())
        if digest(path) != SNAPSHOTS[source]["expectedSha256"]:
            raise ValueError(f"Source checksum mismatch for {path}; expected the pinned {source} snapshot")
        license_path = ROOT / "public" / "licenses" / SNAPSHOTS[source]["licenseFile"]
        if not license_path.exists():
            if not args.download:
                parser.error(f"Missing source license {license_path}")
            license_path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(source_url(source, "licensePath"), timeout=120) as response:
                license_path.write_bytes(response.read())
    en_words, en_groups, en_meta = build_english(files["ecdict"])
    ja_words, ja_groups, ja_meta = build_japanese(files["eggrolls-jlpt"])
    groups = dict(en_groups, **ja_groups)
    courses, stages = courses_and_stages(groups)
    catalog = {"courses": courses, "stages": stages, "words": sorted(en_words + ja_words, key=lambda word: word["id"]), "sources": SOURCES}
    validate(catalog)
    catalog_path = ROOT / "data" / "catalog.json"
    write_json(catalog_path, catalog, compact=True)
    stats = {
        "schemaVersion": 1, "uniqueWords": len(catalog["words"]),
        "englishUniqueWords": len(en_words), "japaneseUniqueWords": len(ja_words),
        "courses": len(courses), "stages": len(stages),
        "wordPlacements": sum(len(stage["wordIds"]) for stage in stages),
        "wordsWithExamples": sum(bool(word.get("example")) for word in catalog["words"]),
        "catalogBytes": catalog_path.stat().st_size, "catalogSha256": digest(catalog_path),
        "byCourse": [{"id": course["id"], "title": course["title"], "words": len(groups[course["id"]]), "stages": sum(stage["courseId"] == course["id"] for stage in stages)} for course in courses],
        "sourceProcessing": {"ecdict": en_meta, "eggrolls-jlpt": ja_meta},
        "countingNote": "Unique words are deduplicated globally by English spelling or Japanese spelling + reading; course counts overlap and should not be summed as unique vocabulary.",
    }
    write_json(ROOT / "data" / "stats.json", stats)
    provenance = {
        "schemaVersion": 1, "snapshotDate": args.snapshot_date,
        "buildScript": "scripts/build_vocab.py", "stageSize": 100,
        "normalization": "NFKC/casefold stable identity, NFC display text, plain text HTML removal, Chinese gloss requirement; unsupported private-use glyph subdefinitions omitted; first paired Japanese example retained; no media copied.",
        "englishOrder": "Ascending minimum positive BNC/COCA rank, then normalized spelling, then stable ID. Core: first 1000 lowercase alphabetic common words (plus I), excluding explicit proper-name glosses.",
        "japaneseOrder": "Original notes.csv column 36 rank, then spelling, then stable ID; preserve N5 → N1 labels. Deduplicate matching spelling and reading and combine meanings.",
        "sources": [{"id": source, **SNAPSHOTS[source], "downloadUrl": source_url(source), "sha256": digest(path), "bytes": path.stat().st_size, "licenseSha256": digest(ROOT / "public" / "licenses" / SNAPSHOTS[source]["licenseFile"])} for source, path in files.items()],
    }
    write_json(ROOT / "data" / "provenance.json", provenance)
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
