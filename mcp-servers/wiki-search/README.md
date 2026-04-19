# wiki-search

MCP stdio server + SQLite FTS5 indexer for `~/obsidian-wiki/`.

Catalog entry (contract 10): [`obsidian-wiki/tools/wiki-search.md`](../../../obsidian-wiki/tools/wiki-search.md).

---

## Quick start

```bash
# install (uv-managed venv)
cd ~/personal-tools/mcp-servers/wiki-search
uv sync

# build the index (once, then re-run after wiki edits)
WIKI_ROOT=~/obsidian-wiki uv run wiki-search-index

# inspect index status
WIKI_ROOT=~/obsidian-wiki uv run wiki-search-index --info
```

The index lives at `~/.local/share/personal/wiki-search/index.db` (override via `WIKI_SEARCH_DB`).

## stdio MCP smoke test

```python
import json, subprocess
proc = subprocess.Popen(
    ["uv", "run", "wiki-search-server"],
    cwd="/Users/qiang.lilq/personal-tools/mcp-servers/wiki-search",
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=0,
    env={"WIKI_ROOT": "/Users/qiang.lilq/obsidian-wiki",
         "PATH": "/opt/homebrew/bin:/usr/bin:/bin"},
)
def send(m): proc.stdin.write(json.dumps(m)+"\n"); proc.stdin.flush()
def recv(): return json.loads(proc.stdout.readline())

send({"jsonrpc":"2.0","id":1,"method":"initialize",
      "params":{"protocolVersion":"2024-11-05","capabilities":{},
                "clientInfo":{"name":"test","version":"0"}}})
print(recv())
send({"jsonrpc":"2.0","method":"notifications/initialized","params":{}})
send({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
print(recv())
send({"jsonrpc":"2.0","id":3,"method":"tools/call",
      "params":{"name":"search_wiki","arguments":{"query":"Hermes","top_k":2}}})
print(recv())
proc.terminate()
```

## Codex registration

Already added to `~/.codex/config.toml`:

```toml
[mcp_servers.wiki-search]
command = "/opt/homebrew/bin/uv"
args = [
  "--directory", "/Users/qiang.lilq/personal-tools/mcp-servers/wiki-search",
  "run", "wiki-search-server",
]
env = { WIKI_ROOT = "/Users/qiang.lilq/obsidian-wiki", PATH = "/opt/homebrew/bin:/usr/bin:/bin" }
```

Verify discovery:

```bash
codex mcp list           # should show wiki-search enabled
codex mcp get wiki-search
```

## Tools exposed

| Tool                  | Args                                | Returns                                                        |
| --------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `search_wiki`         | `query: str, top_k: int = 5 (1-20)` | `{results, query_used, total_indexed}` with FTS5 snippet hits  |
| `get_wiki_page`       | `path: str` (relative to WIKI_ROOT) | `{path, exists, size_chars, content}` — full markdown          |
| `wiki_index_status`   | (none)                              | `{db_path, wiki_root, doc_count, built_at, schema_version}`    |

## Limits (v0.1)

- CJK tokenization is per-character (unicode61); short Chinese terms work but ranking is weak. v0.2 plans `jieba`.
- Full rebuild only; wiki is small enough this is sub-second.
- No file watcher; ingest skill triggers rebuild explicitly.
- Does NOT index `raw/`; raw is source material, use ripgrep.
- `get_wiki_page` rejects `..` and absolute paths to prevent escape.

## Code

```
src/wiki_search/
├── __init__.py
├── config.py    # WIKI_ROOT / DB_PATH from env
├── index.py     # full FTS5 rebuild, scope = wiki + _system + skills + _draft + AGENTS.md
└── server.py    # FastMCP stdio server, 3 tools
```
