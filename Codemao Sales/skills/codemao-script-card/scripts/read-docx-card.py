#!/usr/bin/env python3
"""Read one objection and its original images directly from a DOCX."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
SKILL_DIR = Path(__file__).resolve().parent.parent
PLUGIN_ROOT = SKILL_DIR.parent.parent
SET_TITLE = re.compile(r"第[一二三四五六七八九十\d]+(?:套|次)|方案[一二三四五六七八九十\d]+|版本\s*\d+|(?:精简|拒绝)?话术\s*[一二三四五六七八九十\d]+|试学\s*\d+|通用版本|Python衔接版本")
MATERIAL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def documents_at(path):
    if path.is_file():
        return [path] if path.suffix.lower() == ".docx" else []
    if path.is_dir():
        return sorted((item for item in path.iterdir()
                       if item.is_file() and item.suffix.lower() == ".docx"
                       and not item.name.startswith("~$")), key=lambda item: item.name.casefold())
    return []


def shortcut_target(path):
    """Resolve a Windows .lnk without requiring an extra Python package."""
    if os.name != "nt":
        return None, "快捷方式只支持 Windows .lnk"
    script = (
        "$shell = New-Object -ComObject WScript.Shell; "
        "$shortcut = $shell.CreateShortcut($env:CODEMAO_SHORTCUT); "
        "[Console]::Out.Write($shortcut.TargetPath)"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5,
            env={**os.environ, "CODEMAO_SHORTCUT": str(path)},
        )
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        return None, f"无法解析快捷方式：{exc}"
    target = result.stdout.strip()
    if result.returncode != 0 or not target:
        detail = result.stderr.strip() or "目标为空"
        return None, f"无法解析快捷方式：{detail}"
    return Path(target), None


def materials_at(root):
    """Find images in ORL and in valid top-level .lnk target folders."""
    if not root or not root.exists() or not root.is_dir():
        return [], []
    materials = []
    warnings = []
    for item in sorted(root.iterdir(), key=lambda value: value.name.casefold()):
        if item.is_file() and item.suffix.lower() == ".lnk":
            target, warning = shortcut_target(item)
            if warning:
                warnings.append({"shortcut": str(item.resolve()), "warning": warning})
                continue
            if not target.exists() or not target.is_dir():
                warnings.append({"shortcut": str(item.resolve()), "target": str(target),
                                 "warning": "快捷方式目标不存在或不是文件夹"})
                continue
            for image in sorted(target.rglob("*"), key=lambda value: str(value).casefold()):
                if image.is_file() and image.suffix.lower() in MATERIAL_SUFFIXES:
                    materials.append({"shortcut": str(item.resolve()), "target": str(target.resolve()),
                                       "filename": image.name, "path": str(image.resolve())})
        elif item.is_file() and item.suffix.lower() in MATERIAL_SUFFIXES:
            materials.append({"shortcut": None, "target": str(root.resolve()),
                               "filename": item.name, "path": str(item.resolve())})
    return materials, warnings


def source_paths(explicit):
    configured = explicit or os.environ.get("CODEMAO_AMMO_DIR")
    if configured:
        path = Path(configured).expanduser()
        sources = documents_at(path)
        if not sources:
            raise FileNotFoundError(f"找不到 DOCX 文档：{path}")
        return sources
    source = PLUGIN_ROOT / "Objection Response Library"
    sources = documents_at(source)
    if sources:
        return sources
    raise FileNotFoundError(f"找不到 DOCX 异议文档；请放入插件的 {source}，或用 CODEMAO_AMMO_DIR / --source 指定")


def material_root(explicit, sources):
    if explicit:
        path = Path(explicit).expanduser()
        return path if path.is_dir() else path.parent
    if sources:
        return sources[0].parent
    return None


def heading_level(paragraph):
    properties = paragraph.find(W + "pPr")
    style = properties.find(W + "pStyle") if properties is not None else None
    value = style.get(W + "val", "") if style is not None else ""
    number = re.search(r"(?:heading|标题)\s*([1-6])", value, re.IGNORECASE)
    if number:
        return int(number.group(1))
    if value.isdigit() and 1 <= int(value) <= 6:
        return int(value)
    return None


def paragraphs(body):
    for child in body:
        if child.tag == W + "p":
            yield child
        elif child.tag == W + "tbl":
            for cell in child.iter(W + "tc"):
                yield from cell.iter(W + "p")
        elif child.tag != W + "sectPr":
            yield from child.iter(W + "p")


def read_document(archive):
    relationships = {}
    rels = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    for rel in rels:
        if rel.get("Id") and rel.get("Target"):
            relationships[rel.get("Id")] = rel.get("Target").replace("\\", "/")
    body = ET.fromstring(archive.read("word/document.xml")).find(W + "body")
    if body is None:
        raise ValueError("DOCX has no document body")

    records = []
    image_number = 0
    for paragraph in paragraphs(body):
        level = heading_level(paragraph)
        parts = []

        def flush():
            value = "".join(parts).strip()
            if value:
                records.append({"kind": "text", "text": value, "level": level})
            parts.clear()

        for node in paragraph.iter():
            if node.tag == W + "t":
                parts.append(node.text or "")
            elif node.tag == W + "tab":
                parts.append("\t")
            elif node.tag == W + "br":
                parts.append("\n")
            elif node.tag == A + "blip" and node.get(R + "embed"):
                flush()
                image_number += 1
                target = relationships.get(node.get(R + "embed"))
                if not target:
                    raise ValueError(f"Missing image relationship {node.get(R + 'embed')}")
                records.append({"kind": "image", "number": image_number, "target": target,
                                "file": f"w{image_number:04d}{Path(target).suffix.lower()}"})
        flush()
    return records


def headings(records):
    return [item["text"] for item in records
            if item["kind"] == "text" and item["level"] is not None
            and not SET_TITLE.search(item["text"])]


def matching_headings(query, available):
    exact = [title for title in available if title.lstrip("⭐").strip() == query.strip()]
    if exact:
        return [(0, title) for title in exact]
    if ("太小" in query or "年龄小" in query or "还小" in query) and "⭐年龄小或以后学" in available:
        return [(1, "⭐年龄小或以后学")]
    if ("爸爸" in query or "老公" in query) and "⭐跟爸爸商量" in available:
        return [(1, "⭐跟爸爸商量")]
    if ("太贵" in query or "费用高" in query) and "⭐太贵了" in available:
        return [(1, "⭐太贵了")]
    if "时间" in query:
        later = "⭐没时间以后再考虑"
        normal = "⭐没有时间【时间图换成自己课线的】"
        choice = later if ("以后" in query or "再考虑" in query) else normal
        if choice in available:
            return [(1, choice)]
    matches = [title for title in available if query in title or query in title.lstrip("⭐")]
    return [(2, title) for title in matches]


def selected_set(records, title, number):
    starts = [i for i, item in enumerate(records)
              if item["kind"] == "text" and item["level"] is not None and item["text"] == title]
    if len(starts) != 1:
        raise ValueError(f"小节标题须唯一，当前找到 {len(starts)} 个：{title}")
    start = starts[0]
    level = records[start]["level"]
    end = next((i for i in range(start + 1, len(records))
                if records[i]["kind"] == "text" and records[i]["level"] is not None
                and records[i]["level"] <= level), len(records))
    section = records[start + 1:end]
    titles = [(i, item["text"]) for i, item in enumerate(section)
              if item["kind"] == "text" and item["level"] is not None and item["level"] > level
              and SET_TITLE.search(item["text"])]
    if titles:
        if number > len(titles):
            raise ValueError(f"该小节只有 {len(titles)} 套")
        offset, label = titles[number - 1]
        set_level = section[offset]["level"]
        stop = next((i for i in range(offset + 1, len(section))
                     if section[i]["kind"] == "text" and section[i]["level"] is not None
                     and section[i]["level"] <= set_level), len(section))
        return label, section[offset + 1:stop]
    if number != 1:
        raise ValueError("该小节没有标注更多套数")
    return "第一套（原件未分套）", section


def image_member(target):
    if not target.startswith("media/") or ".." in Path(target).parts:
        raise ValueError(f"Unsupported image target: {target}")
    return "word/" + target


def materialize_images(archive, items, source, output_root):
    stat = source.stat()
    version = hashlib.sha256(f"{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()[:16]
    directory = output_root / version
    for item in items:
        if item["kind"] != "image":
            continue
        data = archive.read(image_member(item["target"]))
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / item["file"]
        path.write_bytes(data)
        image_path = path.resolve().as_posix()
        item["path"] = str(path.resolve())
        item["markdown"] = f"![原图{item['number']}]({'/' if os.name == 'nt' else ''}{image_path})"
        item["sha256"] = hashlib.sha256(data).hexdigest()
        del item["target"]
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", nargs="?", help="家长异议或原件的异议标题")
    parser.add_argument("--set", type=int, default=1, dest="set_number")
    parser.add_argument("--source", help="DOCX 文件或含多份 DOCX 的文件夹")
    parser.add_argument("--out-dir", type=Path, default=Path.home() / ".codex" / "cache" / "codemao-script-card")
    parser.add_argument("--list", action="store_true", help="列出各文档中的标题")
    parser.add_argument("--materials", action="store_true", help="列出 ORL 中可用的图形化物料")
    args = parser.parse_args()
    try:
        if args.set_number < 1:
            raise ValueError("--set 必须大于 0")
        sources = source_paths(args.source)
        materials, material_warnings = materials_at(material_root(args.source, sources))
        if args.materials:
            print(json.dumps({"materials": materials, "material_warnings": material_warnings},
                             ensure_ascii=False, indent=2))
            return 0
        documents = []
        matches = []
        for source in sources:
            with zipfile.ZipFile(source) as archive:
                records = read_document(archive)
            available = headings(records)
            documents.append({"source": str(source.resolve()), "headings": available})
            if args.query:
                matches.extend((rank, source, title, records)
                               for rank, title in matching_headings(args.query, available))
        if args.list:
            result = {"sources": documents, "materials": materials,
                      "material_warnings": material_warnings}
            if len(documents) == 1:
                result.update(documents[0])
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        if not args.query:
            raise ValueError("提供异议内容，或用 --list 查看各文档标题")
        if not matches:
            raise ValueError("未找到对应异议；先用 --list 查看各文档标题")
        best_rank = min(match[0] for match in matches)
        best = [match for match in matches if match[0] == best_rank]
        if len(best) != 1:
            choices = "、".join(f"{source.name}：{title}" for _, source, title, _ in best)
            raise ValueError(f"异议匹配多个位置，请用 --source 指定 DOCX 或输入完整标题：{choices}")
        _, source, title, records = best[0]
        set_label, items = selected_set(records, title, args.set_number)
        with zipfile.ZipFile(source) as archive:
            items = materialize_images(archive, items, source, args.out_dir)
        print(json.dumps({"source": str(source), "heading": title, "set": set_label,
                          "items": items}, ensure_ascii=False, indent=2))
        return 0
    except (FileNotFoundError, KeyError, ValueError, zipfile.BadZipFile) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
