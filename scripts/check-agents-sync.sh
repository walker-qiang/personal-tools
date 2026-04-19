#!/usr/bin/env bash
# check-agents-sync.sh (P0 最小版)
#
# 校验 obsidian-wiki/AGENTS.md 引用的 _system/standards/ 与 _system/security/ 文件都存在。
# P1 完整版会再加: 15 条契约编号在 AGENTS.md 与 standards 里都能定位到。
#
# 退出码:
#   0 = 全部 OK
#   1 = 有 missing (AGENTS.md 引用了但文件不存在)
#   2 = 有 orphan (standards 文件存在但 AGENTS.md 没引用 — 仅 warn, 不 fail)
#
# 设计依据: SYSTEM-DESIGN.md §6 契约 14 + §20 P1 step 18

set -euo pipefail

WIKI="${WIKI_ROOT:-$HOME/obsidian-wiki}"
AGENTS="$WIKI/AGENTS.md"

if [[ ! -f "$AGENTS" ]]; then
  echo "✗ $AGENTS 不存在" >&2
  exit 1
fi

# ─── 1. 抓出 AGENTS.md 里所有 _system/{standards,security,recovery,automations}/ 引用 ─
referenced=$(grep -oE '_system/(standards|security|recovery|automations)/[A-Za-z0-9_./-]+\.md' "$AGENTS" | sort -u || true)

# ─── 2. 实际文件清单 ─────────────────────────────────────────
existing=$(cd "$WIKI" && find _system/standards _system/security _system/recovery _system/automations -type f -name '*.md' 2>/dev/null | sort -u || true)

# ─── 3. 比对 ─────────────────────────────────────────────────
missing=$(comm -23 <(echo "$referenced") <(echo "$existing") || true)
orphan=$(comm -13  <(echo "$referenced") <(echo "$existing") || true)

echo "check-agents-sync (P0 最小版)"
echo "  wiki: $WIKI"
echo "  AGENTS.md: $AGENTS"
echo
echo "  referenced ($(echo "$referenced" | grep -c . || echo 0)):"
echo "$referenced" | sed 's/^/    - /'
echo

if [[ -n "$missing" ]]; then
  echo "  ✗ MISSING (AGENTS.md 引用了, 但文件不存在):" >&2
  echo "$missing" | sed 's/^/    ! /' >&2
fi

if [[ -n "$orphan" ]]; then
  echo "  ⚠️  ORPHAN (文件存在, 但 AGENTS.md 没引用 — warning):"
  echo "$orphan" | sed 's/^/    ? /'
fi

if [[ -n "$missing" ]]; then exit 1; fi
if [[ -n "$orphan"  ]]; then exit 2; fi
echo "  ✓ 全部同步"
exit 0
