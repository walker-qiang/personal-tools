"""Build a SQLite FTS5 full-text index of obsidian-wiki/wiki/ pages.

Strategy:
- Full rebuild on every invocation (wiki is small, sub-second to index <1000 pages).
- Schema is single FTS5 virtual table with embedded content (no external table /
  triggers — simpler, no incremental complexity for v0).
- Frontmatter extracted via PyYAML; body kept as full markdown for FTS to chew.

CLI:
    wiki-search-index           # full rebuild
    wiki-search-index --info    # print db location, doc count, build time
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import yaml

from .config import DB_PATH, WIKI_ROOT, wiki_dir

# Scope decision for v0:
#   ✓ wiki/        — synthesized knowledge (primary)
#   ✓ AGENTS.md    — constitution
#   ✓ _system/     — standards, design, changelog (high-value reference)
#   ✓ skills/      — SKILL.md + references (capability discovery)
#   ✓ _draft/      — your own drafts (you want to find them)
#   ✓ tools/       — MCP / tool catalog entries (契约 10)
#   ✗ raw/         — bulky, low signal-to-noise; raw is source material
#   ✗ _system/scripts/ — code, not knowledge
#   ✗ .obsidian/ .git/ etc — tool internals
SCOPE_INCLUDE = ("wiki", "_system", "skills", "_draft", "tools")
SCOPE_INCLUDE_FILES = ("AGENTS.md",)
SCOPE_EXCLUDE_PATH_FRAGMENTS = ("/scripts/", "/.git/", "/.obsidian/", "/node_modules/")

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)
H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)

SCHEMA = """
DROP TABLE IF EXISTS documents_fts;
CREATE VIRTUAL TABLE documents_fts USING fts5(
    path UNINDEXED,
    title,
    body,
    tags,
    type UNINDEXED,
    updated UNINDEXED,
    tokenize='unicode61 remove_diacritics 0'
);

CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def _list_to_str(x) -> str:
    if x is None:
        return ""
    if isinstance(x, list):
        return " ".join(str(i) for i in x)
    return str(x)


def parse_doc(path: Path, root: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print(f"WARN cannot read {path}: {e}", file=sys.stderr)
        return None

    fm: dict = {}
    body = text
    m = FRONTMATTER_RE.match(text)
    if m:
        try:
            fm = yaml.safe_load(m.group(1)) or {}
            if not isinstance(fm, dict):
                fm = {}
        except yaml.YAMLError as e:
            print(f"WARN yaml parse fail {path}: {e}", file=sys.stderr)
            fm = {}
        body = text[m.end():]

    h1 = H1_RE.search(body)
    title = h1.group(1).strip() if h1 else path.stem

    return {
        "path": str(path.relative_to(root)),
        "title": title,
        "body": body,
        "type": str(fm.get("type", "")),
        "tags": _list_to_str(fm.get("tags")),
        "updated": str(fm.get("updated", "")),
    }


def iter_scope(root: Path):
    """Yield md files in scope, deterministic order."""
    seen: set[Path] = set()
    for sub in SCOPE_INCLUDE:
        d = root / sub
        if not d.is_dir():
            continue
        for md in sorted(d.rglob("*.md")):
            if any(frag in str(md) for frag in SCOPE_EXCLUDE_PATH_FRAGMENTS):
                continue
            if md in seen:
                continue
            seen.add(md)
            yield md
    for fname in SCOPE_INCLUDE_FILES:
        f = root / fname
        if f.is_file() and f not in seen:
            seen.add(f)
            yield f


def build_index(db: sqlite3.Connection, root: Path) -> tuple[int, int]:
    db.executescript(SCHEMA)
    indexed = 0
    skipped = 0
    rows = []
    for md in iter_scope(root):
        d = parse_doc(md, root)
        if d is None:
            skipped += 1
            continue
        rows.append((d["path"], d["title"], d["body"], d["tags"], d["type"], d["updated"]))
        indexed += 1

    db.executemany(
        "INSERT INTO documents_fts(path, title, body, tags, type, updated) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )

    now = datetime.now().isoformat(timespec="seconds")
    for k, v in [
        ("built_at", now),
        ("wiki_root", str(WIKI_ROOT)),
        ("doc_count", str(indexed)),
        ("schema_version", "1"),
    ]:
        db.execute(
            "INSERT INTO index_meta(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (k, v),
        )
    db.commit()
    return indexed, skipped


def show_info(db: sqlite3.Connection) -> None:
    print(f"db_path: {DB_PATH}")
    rows = db.execute("SELECT key, value FROM index_meta ORDER BY key").fetchall()
    for k, v in rows:
        print(f"  {k}: {v}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Index obsidian-wiki/wiki/ for FTS5 search.")
    parser.add_argument("--info", action="store_true", help="print db location + meta, do not rebuild")
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    try:
        if args.info:
            show_info(db)
            return 0

        if not WIKI_ROOT.is_dir():
            print(f"ERROR WIKI_ROOT not found: {WIKI_ROOT}", file=sys.stderr)
            return 2

        indexed, skipped = build_index(db, WIKI_ROOT)
        print(f"indexed {indexed} docs from {WIKI_ROOT} -> {DB_PATH}")
        print(f"  scope: {', '.join(SCOPE_INCLUDE)} + {', '.join(SCOPE_INCLUDE_FILES)}")
        if skipped:
            print(f"skipped {skipped}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
