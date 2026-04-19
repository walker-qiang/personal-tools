"""MCP stdio server exposing search_wiki + get_wiki_page over obsidian-wiki/.

Tools:
  - search_wiki(query, top_k=5)  → snippet results from FTS5
  - get_wiki_page(path)           → full markdown of one indexed doc
  - wiki_index_status()           → diagnostic: db location, doc count, build time

Auto-builds the FTS5 index on first start if it doesn't exist.
"""
from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .config import DB_PATH, WIKI_ROOT
from .index import build_index

# Stderr logging so it shows up in Codex's MCP server log.
logging.basicConfig(
    level=logging.INFO,
    format="[wiki-search] %(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger(__name__)

mcp = FastMCP("wiki-search")


def _ensure_db() -> sqlite3.Connection:
    """Open db, build index if missing."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    fresh = not DB_PATH.exists()
    db = sqlite3.connect(DB_PATH)
    if fresh:
        log.info("no index found, building from %s", WIKI_ROOT)
        if not WIKI_ROOT.is_dir():
            log.error("WIKI_ROOT not found: %s", WIKI_ROOT)
            return db
        n, skipped = build_index(db, WIKI_ROOT)
        log.info("built index: %d docs, %d skipped", n, skipped)
    return db


_db: sqlite3.Connection | None = None


def _db_conn() -> sqlite3.Connection:
    global _db
    if _db is None:
        _db = _ensure_db()
    return _db


def _sanitize_query(q: str) -> str:
    """FTS5 query strings need basic care to avoid syntax errors.

    Strategy: if the user's query already has FTS5 operators (AND/OR/NOT/", *, :),
    pass through. Otherwise wrap each space-separated token so any unrecognized
    punctuation becomes literal.
    """
    q = q.strip()
    if not q:
        return q
    has_operators = any(op in q for op in (' AND ', ' OR ', ' NOT ', '"', '*', ':', '('))
    if has_operators:
        return q
    tokens = [t for t in q.split() if t]
    if not tokens:
        return q
    safe = []
    for t in tokens:
        if any(c in t for c in '"*:()'):
            safe.append(t)
        else:
            safe.append(f'"{t}"')
    return " ".join(safe)


@mcp.tool()
def search_wiki(query: str, top_k: int = 5) -> dict:
    """Full-text search across obsidian-wiki/ knowledge.

    Searches: wiki/, _system/, skills/, _draft/, AGENTS.md.
    Does NOT search: raw/ (source material), code, generated artefacts.

    Query syntax (SQLite FTS5):
      - Simple words: "Hermes ingest"  → all words must match (AND by default)
      - Phrases: "\"Skill 闭环\""        → exact phrase
      - Boolean: "agent OR skill"      → either
      - Prefix:  "ingest*"              → words starting with ingest
      - NOT:     "agent NOT obsolete"

    Args:
        query: FTS5 query string. Plain text auto-wrapped in phrases per token.
        top_k: Max results to return (1-20, default 5).

    Returns:
        dict with:
          - results: list of {path, title, snippet, type, updated, score}
          - query_used: actual FTS5 query after sanitization
          - total_indexed: how many docs are indexed in total
    """
    if top_k < 1:
        top_k = 1
    elif top_k > 20:
        top_k = 20

    db = _db_conn()
    fts_q = _sanitize_query(query)

    if not fts_q:
        return {"results": [], "query_used": "", "total_indexed": 0, "error": "empty query"}

    try:
        rows = db.execute(
            """
            SELECT path, title, type, updated,
                   snippet(documents_fts, 2, '<<', '>>', '…', 16) AS snip,
                   rank
            FROM documents_fts
            WHERE documents_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_q, top_k),
        ).fetchall()
    except sqlite3.OperationalError as e:
        return {"results": [], "query_used": fts_q, "error": f"FTS5 syntax: {e}"}

    total = db.execute("SELECT value FROM index_meta WHERE key='doc_count'").fetchone()
    total_n = int(total[0]) if total else 0

    return {
        "query_used": fts_q,
        "total_indexed": total_n,
        "results": [
            {
                "path": path,
                "title": title,
                "type": typ or "(no type)",
                "updated": updated or "",
                "snippet": snip,
                "score": round(rank, 2),
            }
            for path, title, typ, updated, snip, rank in rows
        ],
    }


@mcp.tool()
def get_wiki_page(path: str) -> dict:
    """Read the full markdown content of one wiki page.

    Use this after `search_wiki` finds a relevant page and you need the full text.

    Args:
        path: Path relative to WIKI_ROOT (e.g. 'wiki/concepts/Agent记忆系统.md'),
              as returned by search_wiki.

    Returns:
        dict with: path, content, exists, size_chars
    """
    if not path or path.startswith("/") or ".." in path:
        return {"path": path, "exists": False, "error": "invalid path"}
    full = (WIKI_ROOT / path).resolve()
    try:
        full.relative_to(WIKI_ROOT.resolve())
    except ValueError:
        return {"path": path, "exists": False, "error": "path escapes WIKI_ROOT"}
    if not full.is_file():
        return {"path": path, "exists": False, "error": "file not found"}
    try:
        content = full.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return {"path": path, "exists": True, "error": f"read failed: {e}"}
    return {
        "path": path,
        "exists": True,
        "size_chars": len(content),
        "content": content,
    }


@mcp.tool()
def wiki_index_status() -> dict:
    """Diagnostic: where the index lives, when it was built, how many docs."""
    db = _db_conn()
    rows = db.execute("SELECT key, value FROM index_meta ORDER BY key").fetchall()
    meta = {k: v for k, v in rows}
    meta["db_path"] = str(DB_PATH)
    meta["wiki_root_env"] = str(WIKI_ROOT)
    return meta


def main() -> int:
    log.info("starting wiki-search MCP server (WIKI_ROOT=%s)", WIKI_ROOT)
    mcp.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
