from __future__ import annotations

import hashlib
import json
import pathlib
import re
import tomllib


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "skills" / "agent-conductor" / "references" / "agent-index.json"
MANIFEST_PATH = ROOT / "assets" / "roles-manifest.json"
AGENTS_DIR = ROOT / "assets" / "agents"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main() -> None:
    index = json.loads(INDEX_PATH.read_text("utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text("utf-8"))
    files = sorted(AGENTS_DIR.glob("*.toml"))
    indexed_agents = index["agents"]
    indexed_slugs = {agent["slug"] for agent in indexed_agents}
    categories = {agent["category"] for agent in indexed_agents}
    manifest_roles = {role["slug"]: role for role in manifest["roles"]}

    assert len(files) == len(indexed_agents) == manifest["roleCount"] == 268
    assert len(categories) == manifest["roleBearingCategoryCount"] == 19
    assert len(indexed_slugs) == 268
    assert {file.stem for file in files} == indexed_slugs
    assert set(manifest_roles) == indexed_slugs

    names: set[str] = set()
    for file in files:
        assert SLUG_RE.fullmatch(file.stem), f"invalid slug: {file.stem}"
        data = tomllib.loads(file.read_text("utf-8"))
        for key in ("name", "description", "developer_instructions"):
            assert isinstance(data.get(key), str) and data[key].strip(), (
                f"{file.name}: missing {key}"
            )
        assert data["name"] == file.stem
        assert data["name"] not in names
        names.add(data["name"])
        expected_hash = manifest_roles[file.stem]["sha256"]
        actual_hash = hashlib.sha256(file.read_bytes()).hexdigest()
        assert actual_hash == expected_hash, f"hash mismatch: {file.name}"
        assert manifest_roles[file.stem]["path"] == f"agents/{file.name}"

    assert manifest["schemaVersion"] == 1
    assert manifest["pluginVersion"] == "1.0.0"
    assert manifest["upstream"]["repository"] == (
        "https://github.com/jnMetaCode/agency-agents-zh"
    )
    assert re.fullmatch(r"[0-9a-f]{40}", manifest["upstream"]["revision"])
    print("VALID ROLE BUNDLE: 268 roles, 19 categories")


if __name__ == "__main__":
    main()
