"""Shared configuration: WIKI_ROOT and index DB location.

Both honour env vars so 3 Codex forms (CLI / App / GoLand plugin) share state
regardless of cwd.
"""
from __future__ import annotations

import os
from pathlib import Path


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser() if raw else default


WIKI_ROOT: Path = _env_path("WIKI_ROOT", Path.home() / "obsidian-wiki")

DB_PATH: Path = _env_path(
    "WIKI_SEARCH_DB",
    Path.home() / ".local/share/personal/wiki-search/index.db",
)


def wiki_dir() -> Path:
    return WIKI_ROOT / "wiki"
