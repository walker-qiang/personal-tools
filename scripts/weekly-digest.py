#!/usr/bin/env python3
"""weekly-digest: 把过去 N 天 obsidian-wiki + personal-tools 的事实变动摘成
markdown, 喂给 weekly-reflection skill 当 key_facts 输入素材。

设计原则:
- **只列事实**: 文件名 + 类别 + 简短 metadata; 不做 AI 总结, 不读内容做语义摘要。
- **轻量 + 可重跑**: 纯 git/fs 调用, 无外部依赖 (only stdlib).
- **跨两仓**: obsidian-wiki (主数据) + personal-tools (工具变化).
- **Drafter 边界**: 输出 stdout, 不写任何文件。把"是否 inline 进 draft"的决定留给
  weekly-reflection skill / 人。

CLI:
    weekly-digest.py                       # 默认 ISO 当周 (周一 00:00 → 周日 23:59)
    weekly-digest.py --week 2026-W17       # 指定 ISO 周
    weekly-digest.py --since-days 7        # 滑动窗口 (从 today - N 天)
    weekly-digest.py --format json         # 给 skill 解析用 (默认 markdown)

环境变量:
    WIKI_ROOT       默认 ~/obsidian-wiki
    TOOLS_ROOT      默认 ~/personal-tools

退出码:
    0 OK / 1 用法错 / 2 仓库找不到
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_WIKI_ROOT = Path(os.environ.get("WIKI_ROOT", os.path.expanduser("~/obsidian-wiki")))
DEFAULT_TOOLS_ROOT = Path(os.environ.get("TOOLS_ROOT", os.path.expanduser("~/personal-tools")))


# ─── ISO 周计算 ─────────────────────────────────────────────────────

def parse_iso_week(s: str) -> tuple[datetime, datetime]:
    """'2026-W17' → (周一 00:00, 周日 23:59:59) 的 datetime tuple."""
    if "-W" not in s:
        raise ValueError(f"--week must look like 'YYYY-WNN', got {s!r}")
    year_s, week_s = s.split("-W", 1)
    year, week = int(year_s), int(week_s)
    if not 1 <= week <= 53:
        raise ValueError(f"week number out of range: {week}")
    monday = datetime.fromisocalendar(year, week, 1)
    sunday_end = monday + timedelta(days=7) - timedelta(seconds=1)
    return monday, sunday_end


def current_iso_week_range() -> tuple[datetime, datetime]:
    today = datetime.now()
    iso = today.isocalendar()
    return parse_iso_week(f"{iso.year}-W{iso.week:02d}")


def since_days_range(n: int) -> tuple[datetime, datetime]:
    end = datetime.now()
    start = end - timedelta(days=n)
    return start, end


# ─── git 调用 ────────────────────────────────────────────────────────

def git(repo: Path, *args: str) -> str:
    """跑 git, 返回 stdout (失败返回空字符串, 不抛, 让上层降级处理).

    强制 core.quotePath=false: 否则中文/空格路径会被 git 转义成 \\xxx 八进制,
    导致后面 classify_wiki_file 把 'raw/articles/<中文>.md' 错分到 'other'。
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "-c", "core.quotePath=false", *args],
            check=True, capture_output=True, text=True,
        )
        return out.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def repo_changed_files(repo: Path, since: datetime, until: datetime) -> dict:
    """按状态分组的文件变动. 用 git log --name-status."""
    if not (repo / ".git").exists():
        return {"_unavailable": True, "_reason": f"{repo} 不是 git 仓"}
    since_s = since.strftime("%Y-%m-%d %H:%M:%S")
    until_s = until.strftime("%Y-%m-%d %H:%M:%S")
    raw = git(
        repo,
        "log", f"--since={since_s}", f"--until={until_s}",
        "--name-status", "--pretty=format:__COMMIT__%h__%s",
        "--no-merges",
    )
    if not raw.strip():
        return {"added": [], "modified": [], "deleted": [], "commit_count": 0, "commits": []}

    added, modified, deleted = [], [], []
    commits = []
    cur_commit = None
    for line in raw.splitlines():
        if line.startswith("__COMMIT__"):
            parts = line[len("__COMMIT__"):].split("__", 1)
            if len(parts) == 2:
                cur_commit = {"hash": parts[0], "subject": parts[1]}
                commits.append(cur_commit)
            continue
        if not line.strip():
            continue
        # name-status: <STATUS>\t<file>  或  R<score>\t<old>\t<new>
        parts = line.split("\t")
        status = parts[0]
        if status.startswith("R") and len(parts) >= 3:
            modified.append(parts[2])  # rename → 算修改
        elif status == "A" and len(parts) >= 2:
            added.append(parts[1])
        elif status == "M" and len(parts) >= 2:
            modified.append(parts[1])
        elif status == "D" and len(parts) >= 2:
            deleted.append(parts[1])
    return {
        "added": sorted(set(added)),
        "modified": sorted(set(modified)),
        "deleted": sorted(set(deleted)),
        "commit_count": len(commits),
        "commits": commits,
    }


# ─── 业务分类 ────────────────────────────────────────────────────────

def classify_wiki_file(path: str) -> str:
    """把 wiki 仓里的文件归到一个语义桶."""
    p = path
    if p == "AGENTS.md":
        return "constitution"
    if p.startswith("_system/"):
        return "system"
    if p.startswith("wiki/"):
        return "wiki"
    if p.startswith("skills/"):
        return "skills"
    if p.startswith("tools/"):
        return "tools-catalog"
    if p.startswith("_draft/"):
        return "draft"
    if p.startswith("raw/"):
        return "raw"
    if p.startswith(".obsidian/") or p.startswith(".cursor/") or p.startswith(".superpowers/"):
        return "tooling"
    return "other"


def group_by_class(files: list[str], classifier) -> dict:
    out = defaultdict(list)
    for f in files:
        out[classifier(f)].append(f)
    return dict(out)


def list_inbox_pending(wiki_root: Path) -> list[str]:
    """raw/inbox/ 下当前堆积 (任意 mtime)."""
    d = wiki_root / "raw" / "inbox"
    if not d.is_dir():
        return []
    return sorted(str(p.relative_to(wiki_root)) for p in d.rglob("*") if p.is_file())


def list_drafts_touched(wiki_root: Path, since: datetime) -> list[str]:
    """_draft/ 下 mtime 在 since 之后的文件 (无论是否 commit)."""
    d = wiki_root / "_draft"
    if not d.is_dir():
        return []
    cutoff = since.timestamp()
    out = []
    for p in d.rglob("*.md"):
        try:
            if p.stat().st_mtime >= cutoff:
                out.append(str(p.relative_to(wiki_root)))
        except OSError:
            pass
    return sorted(out)


def list_log_entries_since(wiki_root: Path, since: datetime) -> list[str]:
    """提取 wiki/_log.md 在窗口内的 ## 标题 (该日志按时间倒序写)."""
    log = wiki_root / "wiki" / "_log.md"
    if not log.is_file():
        return []
    cutoff_str = since.strftime("%Y-%m-%d")
    out = []
    for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.startswith("## ["):
            continue
        # 格式: ## [YYYY-MM-DD] <category> | <title>
        try:
            date_part = line[4:14]  # YYYY-MM-DD
            if date_part >= cutoff_str:
                out.append(line[3:].strip())
            else:
                break  # 倒序写, 早于窗口就停
        except Exception:
            continue
    return out


# ─── 渲染 ────────────────────────────────────────────────────────────

def render_markdown(start: datetime, end: datetime, data: dict) -> str:
    lines = []
    lines.append(f"# Weekly digest: {start.date()} → {end.date()}")
    lines.append("")
    lines.append(f"_自动汇总; 不替你思考, 只列事实。生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}。_")
    lines.append("")

    # ── obsidian-wiki ──
    w = data["wiki_repo"]
    lines.append("## obsidian-wiki 仓变动")
    if w.get("_unavailable"):
        lines.append(f"- ⚠️ {w['_reason']}")
    else:
        lines.append(f"- commits: **{w['commit_count']}** 条")
        if w["commits"]:
            for c in w["commits"][:10]:
                lines.append(f"  - `{c['hash']}` {c['subject']}")
            if len(w["commits"]) > 10:
                lines.append(f"  - … 还有 {len(w['commits']) - 10} 条")
        for label, key in [("新建", "added"), ("修改", "modified"), ("删除", "deleted")]:
            files = w.get(key, [])
            if not files:
                continue
            lines.append(f"- {label}: **{len(files)}** 文件")
            grouped = group_by_class(files, classify_wiki_file)
            for cat in ["wiki", "skills", "tools-catalog", "system", "constitution", "draft", "raw", "tooling", "other"]:
                if cat in grouped:
                    lines.append(f"  - **{cat}** ({len(grouped[cat])}): " + ", ".join(f"`{f}`" for f in grouped[cat][:5]) + (f" … +{len(grouped[cat]) - 5}" if len(grouped[cat]) > 5 else ""))
    lines.append("")

    # ── personal-tools ──
    t = data["tools_repo"]
    lines.append("## personal-tools 仓变动")
    if t.get("_unavailable"):
        lines.append(f"- ⚠️ {t['_reason']}")
    else:
        lines.append(f"- commits: **{t['commit_count']}** 条")
        for c in t["commits"][:5]:
            lines.append(f"  - `{c['hash']}` {c['subject']}")
        for label, key in [("新建", "added"), ("修改", "modified"), ("删除", "deleted")]:
            files = t.get(key, [])
            if files:
                lines.append(f"- {label}: " + ", ".join(f"`{f}`" for f in files[:8]) + (f" … +{len(files) - 8}" if len(files) > 8 else ""))
    lines.append("")

    # ── _log.md entries ──
    log_entries = data.get("log_entries", [])
    lines.append(f"## wiki/_log.md 本周新条目 ({len(log_entries)})")
    if log_entries:
        for e in log_entries[:15]:
            lines.append(f"- {e}")
        if len(log_entries) > 15:
            lines.append(f"- … 还有 {len(log_entries) - 15} 条")
    else:
        lines.append("- (无)")
    lines.append("")

    # ── drafts ──
    drafts = data.get("drafts_touched", [])
    lines.append(f"## _draft/ 本周动过的草稿 ({len(drafts)})")
    if drafts:
        for d in drafts:
            lines.append(f"- `{d}`")
    else:
        lines.append("- (无)")
    lines.append("")

    # ── inbox 堆积 ──
    inbox = data.get("inbox_pending", [])
    lines.append(f"## raw/inbox/ 当前堆积 ({len(inbox)})")
    if inbox:
        for f in inbox[:10]:
            lines.append(f"- `{f}`")
        if len(inbox) > 10:
            lines.append(f"- … 还有 {len(inbox) - 10} 个待消化")
        lines.append("")
        lines.append("> 提示: inbox 越长 = 信息债越大, 考虑用 `wiki-ingest-raw-to-wiki` 清几条")
    else:
        lines.append("- (清空 ✓)")
    lines.append("")

    return "\n".join(lines)


# ─── 主流程 ─────────────────────────────────────────────────────────

def collect(wiki_root: Path, tools_root: Path, start: datetime, end: datetime) -> dict:
    return {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "wiki_repo": repo_changed_files(wiki_root, start, end),
        "tools_repo": repo_changed_files(tools_root, start, end),
        "log_entries": list_log_entries_since(wiki_root, start),
        "drafts_touched": list_drafts_touched(wiki_root, start),
        "inbox_pending": list_inbox_pending(wiki_root),
    }


def main() -> int:
    p = argparse.ArgumentParser(
        prog="weekly-digest",
        description="把过去一周 obsidian-wiki + personal-tools 的事实变动摘成 markdown",
    )
    grp = p.add_mutually_exclusive_group()
    grp.add_argument("--week", help="ISO week 'YYYY-WNN' (e.g. 2026-W17)")
    grp.add_argument("--since-days", type=int, help="滑动窗口: 从 today - N 天")
    p.add_argument("--format", choices=["markdown", "json"], default="markdown")
    p.add_argument("--wiki-root", type=Path, default=DEFAULT_WIKI_ROOT)
    p.add_argument("--tools-root", type=Path, default=DEFAULT_TOOLS_ROOT)
    args = p.parse_args()

    try:
        if args.week:
            start, end = parse_iso_week(args.week)
        elif args.since_days is not None:
            if args.since_days <= 0:
                raise ValueError("--since-days 必须 > 0")
            start, end = since_days_range(args.since_days)
        else:
            start, end = current_iso_week_range()
    except ValueError as e:
        print(f"[weekly-digest] {e}", file=sys.stderr)
        return 1

    if not args.wiki_root.is_dir():
        print(f"[weekly-digest] wiki root 不存在: {args.wiki_root}", file=sys.stderr)
        return 2

    data = collect(args.wiki_root, args.tools_root, start, end)

    if args.format == "json":
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(start, end, data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
