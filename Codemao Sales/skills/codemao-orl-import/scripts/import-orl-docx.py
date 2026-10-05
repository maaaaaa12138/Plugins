#!/usr/bin/env python3
"""Inspect and normalize a DOCX for the Codemao objection response library."""

import argparse
import json
import os
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from lxml import etree


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
HEADING = re.compile(r"(?:heading|标题)\s*([1-6])", re.IGNORECASE)
READER = Path(__file__).resolve().parents[2] / "codemao-script-card" / "scripts" / "read-docx-card.py"


def paragraphs(body):
    for child in body:
        if child.tag == W + "p":
            yield child
        elif child.tag == W + "tbl":
            for cell in child.iter(W + "tc"):
                yield from cell.iter(W + "p")
        elif child.tag != W + "sectPr":
            yield from child.iter(W + "p")


def document_parts(archive):
    document = etree.fromstring(archive.read("word/document.xml"))
    body = document.find(W + "body")
    if body is None:
        raise ValueError("DOCX 没有正文")
    return document, list(paragraphs(body))


def paragraph_text(paragraph):
    return "".join(node.text or "" for node in paragraph.iter(W + "t")).strip()


def style_id(paragraph):
    style = paragraph.find(f"{W}pPr/{W}pStyle")
    return style.get(W + "val", "") if style is not None else ""


def inspect(source, show_all, offset, limit):
    with zipfile.ZipFile(source) as archive:
        _, items = document_parts(archive)
    found = []
    for index, paragraph in enumerate(items):
        value = paragraph_text(paragraph)
        if not value:
            continue
        style = style_id(paragraph)
        bold = any(node.get(W + "val", "1") not in ("0", "false")
                   for node in paragraph.iter(W + "b"))
        if show_all or HEADING.search(style) or style.isdigit() or bold or len(value) <= 60:
            found.append({"paragraph": index, "text": value[:240], "style": style, "bold": bold})
    print(json.dumps({"source": str(source.resolve()), "paragraph_count": len(items),
                      "candidate_count": len(found), "offset": offset,
                      "has_more": offset + limit < len(found),
                      "paragraphs": found[offset:offset + limit]}, ensure_ascii=False, indent=2))


def validate_plan(plan, items):
    objections = plan.get("objections")
    if not isinstance(objections, list) or not objections:
        raise ValueError("计划必须包含非空 objections 列表")
    used = set()
    positions = []
    titles = set()
    for objection in objections:
        index = objection.get("paragraph")
        title = objection.get("title")
        if not isinstance(index, int) or not 0 <= index < len(items):
            raise ValueError(f"异议段落编号无效：{index}")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("每个异议都需要明确标题")
        normalized = title.strip().lstrip("⭐").strip()
        if normalized in titles:
            raise ValueError(f"异议标题重复：{title}")
        titles.add(normalized)
        if index in used:
            raise ValueError(f"段落编号重复：{index}")
        used.add(index)
        positions.append(index)
        sets = objection.get("sets", [])
        if not isinstance(sets, list) or any(not isinstance(value, int) for value in sets):
            raise ValueError(f"套数段落编号无效：{title}")
        if sets != sorted(set(sets)) or any(value <= index or value >= len(items) for value in sets):
            raise ValueError(f"套数段落必须按顺序位于异议之后：{title}")
        for value in sets:
            if value in used:
                raise ValueError(f"段落编号重复：{value}")
            used.add(value)
    if positions != sorted(positions):
        raise ValueError("异议必须按原文顺序排列")
    for current, following in zip(objections, objections[1:]):
        if any(index >= following["paragraph"] for index in current.get("sets", [])):
            raise ValueError(f"套数越过了下一个异议：{current['title']}")
    return objections


def set_style(paragraph, name, outline_level):
    properties = paragraph.find(W + "pPr")
    if properties is None:
        properties = etree.Element(W + "pPr")
        paragraph.insert(0, properties)
    style = properties.find(W + "pStyle")
    if style is None:
        style = etree.Element(W + "pStyle")
        properties.insert(0, style)
    style.set(W + "val", name)
    outline = properties.find(W + "outlineLvl")
    if outline is None:
        outline = etree.SubElement(properties, W + "outlineLvl")
    outline.set(W + "val", str(outline_level))


def insert_heading(before, title, style, level):
    paragraph = etree.Element(W + "p")
    set_style(paragraph, style, level)
    run = etree.SubElement(paragraph, W + "r")
    etree.SubElement(run, W + "t").text = title
    before.addprevious(paragraph)


def ensure_styles(styles):
    existing = {node.get(W + "styleId") for node in styles.findall(W + "style")}
    for number in (2, 3):
        style_id_value = f"Heading{number}"
        if style_id_value in existing:
            continue
        style = etree.SubElement(styles, W + "style")
        style.set(W + "type", "paragraph")
        style.set(W + "styleId", style_id_value)
        etree.SubElement(style, W + "name").set(W + "val", f"heading {number}")
        etree.SubElement(style, W + "basedOn").set(W + "val", "Normal")
        etree.SubElement(style, W + "qFormat")
        properties = etree.SubElement(style, W + "pPr")
        etree.SubElement(properties, W + "outlineLvl").set(W + "val", str(number - 1))
        etree.SubElement(etree.SubElement(style, W + "rPr"), W + "b")


def normalize(source, output, plan):
    with zipfile.ZipFile(source) as original:
        document, items = document_parts(original)
        objections = validate_plan(plan, items)
        if "word/styles.xml" not in original.namelist():
            raise ValueError("DOCX 缺少 Word 样式文件，无法可靠生成可编辑的标题")
        styles = etree.fromstring(original.read("word/styles.xml"))
        ensure_styles(styles)
        for paragraph in items:
            if HEADING.search(style_id(paragraph)) or style_id(paragraph).isdigit():
                properties = paragraph.find(W + "pPr")
                properties.remove(properties.find(W + "pStyle"))
                outline = properties.find(W + "outlineLvl")
                if outline is not None:
                    properties.remove(outline)
        labels = "一二三四五六七八九十"
        for objection in objections:
            paragraph = items[objection["paragraph"]]
            title = objection["title"].strip()
            if paragraph_text(paragraph).lstrip("⭐").strip() == title.lstrip("⭐").strip():
                set_style(paragraph, "Heading2", 1)
            else:
                insert_heading(paragraph, title, "Heading2", 1)
            for number, index in enumerate(objection.get("sets", []), start=1):
                paragraph = items[index]
                label = f"第{labels[number - 1] if number <= 10 else number}套"
                if re.fullmatch(r"(?:第[一二三四五六七八九十\d]+套|方案[一二三四五六七八九十\d]+)[:：]?",
                                paragraph_text(paragraph)):
                    set_style(paragraph, "Heading3", 2)
                else:
                    insert_heading(paragraph, label, "Heading3", 2)
        replacement = {
            "word/document.xml": etree.tostring(document, encoding="UTF-8", xml_declaration=True),
            "word/styles.xml": etree.tostring(styles, encoding="UTF-8", xml_declaration=True),
        }
        with zipfile.ZipFile(output, "w") as result:
            for info in original.infolist():
                if info.filename in replacement:
                    result.writestr(info, replacement[info.filename])
                else:
                    with original.open(info) as reader, result.open(info, "w") as writer:
                        shutil.copyfileobj(reader, writer, length=1024 * 1024)
    return objections


def verify(output, objections):
    reader = runpy.run_path(str(READER))
    with zipfile.ZipFile(output) as archive:
        records = reader["read_document"](archive)
        available = reader["headings"](records)
        for objection in objections:
            title = objection["title"].strip()
            matching = reader["matching_headings"](title, available)
            if len(matching) != 1:
                raise ValueError(f"导入后无法唯一识别异议：{title}")
            for number in range(1, max(1, len(objection.get("sets", []))) + 1):
                _, content = reader["selected_set"](records, matching[0][1], number)
                if not content:
                    raise ValueError(f"导入后该套没有可出卡内容：{title} 第{number}套")


def plugin_source(explicit):
    if explicit:
        root = Path(explicit).expanduser().resolve()
    else:
        command = subprocess.run(["codex", "plugin", "list", "--json"], capture_output=True,
                                 text=True, encoding="utf-8", check=True)
        plugins = json.loads(command.stdout)["installed"]
        matches = [entry for entry in plugins
                   if entry.get("pluginId") == "codemao-sales@codemao-sales-github"]
        if len(matches) != 1:
            raise ValueError("找不到唯一的 Codemao Sales 本机插件原件；请提供 --plugin-root")
        root = Path(matches[0]["source"]["path"]).resolve()
    if not (root / "plugin.json").is_file() or not (root / "skills" / "codemao-script-card").is_dir():
        raise ValueError(f"不是 Codemao Sales 插件原件目录：{root}")
    if ".codex" in root.parts and "cache" in root.parts:
        raise ValueError("不能写入插件缓存，请指定插件原件目录")
    return root


def commit(output, root, labels):
    library = root / "Objection Response Library"
    library.mkdir(exist_ok=True)
    backup_root = root.parent / f"{root.name} ORL Originals"
    existing = sorted(path for path in library.iterdir()
                      if path.is_file() and path.suffix.lower() == ".docx"
                      and not path.name.startswith("~$"))
    backup = None
    moved = []
    try:
        if existing:
            backup = backup_root / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            backup.mkdir(parents=True)
            for path in existing:
                target = backup / path.name
                shutil.move(str(path), str(target))
                moved.append((target, path))
        target = library / output.name
        os.replace(output, target)
    except OSError:
        for saved, former in reversed(moved):
            shutil.move(str(saved), str(former))
        raise
    print(json.dumps({"document": str(target), "backup": str(backup) if backup else None,
                      "headings": labels,
                      "refresh": "codex plugin add codemao-sales@codemao-sales-github"},
                     ensure_ascii=False, indent=2))


def install(source, plan, root):
    with tempfile.TemporaryDirectory(prefix="orl-import-", dir=root) as workspace:
        stem = source.stem if source.stem.endswith("-ORL") else f"{source.stem}-ORL"
        output = Path(workspace) / f"{stem}.docx"
        objections = normalize(source, output, plan)
        verify(output, objections)
        commit(output, root, [item["title"] for item in objections])


def adopt(source, root):
    reader = runpy.run_path(str(READER))
    with zipfile.ZipFile(source) as archive:
        labels = reader["headings"](reader["read_document"](archive))
    if not labels:
        raise ValueError("原件没有可识别标题，请先检查并整理异议边界")
    with tempfile.TemporaryDirectory(prefix="orl-adopt-", dir=root) as workspace:
        output = Path(workspace) / source.name
        shutil.copy2(source, output)
        commit(output, root, labels)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "apply", "adopt"))
    parser.add_argument("source", type=Path)
    parser.add_argument("--plan", type=Path, help="JSON: objections [{paragraph, title, sets: [paragraph]}]")
    parser.add_argument("--plugin-root", type=Path)
    parser.add_argument("--all", action="store_true", help="inspect 时列出全部正文段落")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=250)
    args = parser.parse_args()
    try:
        source = args.source.expanduser().resolve()
        if not source.is_file() or source.suffix.lower() != ".docx":
            raise ValueError(f"找不到 DOCX 原件：{source}")
        if args.action == "inspect":
            inspect(source, args.all, args.offset, args.limit)
        elif args.action == "adopt":
            adopt(source, plugin_source(args.plugin_root))
        else:
            if args.plan is None:
                raise ValueError("apply 需要 --plan")
            plan = json.loads(args.plan.read_text(encoding="utf-8"))
            install(source, plan, plugin_source(args.plugin_root))
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
