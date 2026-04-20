#!/usr/bin/env bash
# check-draft-ownership: 校验 obsidian-wiki/_draft/ 下每个 .md 的 writer 字段
# 与 _system/standards/agents-policy.md §2.1 的白名单一致。
#
# 行为:
#   - 扫 _draft/<bucket>/**/*.md, 抽 frontmatter 'writer:' 字段
#   - 不在白名单 / 字段缺失 → warn (软警告; 不阻塞 commit/push)
#   - 退出码: 0 = 全 OK, 0 = 仅 warn, 1 = 用法错, 2 = wiki root 找不到
#
# 用法:
#   check-draft-ownership.sh                # 默认 ~/obsidian-wiki
#   WIKI_ROOT=/path/to/wiki check-draft-ownership.sh
#
# 依据: _system/standards/agents-policy.md §2.1 + AGENTS.md 契约 4

set -euo pipefail

WIKI_ROOT="${WIKI_ROOT:-$HOME/obsidian-wiki}"

if [[ ! -f "$WIKI_ROOT/AGENTS.md" || ! -d "$WIKI_ROOT/_draft" ]]; then
  echo "✗ wiki root 无效 (找不到 AGENTS.md 或 _draft/): $WIKI_ROOT" >&2
  echo "  设 WIKI_ROOT=<path> 重试" >&2
  exit 2
fi

# 白名单 (与 agents-policy.md §2.1 钉死, 改一处改两处)
# format: bucket-glob<TAB>allowed-writer
declare -a OWNERSHIP=(
  "_draft/journal/weekly/|weekly-reflection"
  "_draft/journal/monthly/|monthly-reflection"
  "_draft/journal/yearly/|yearly-reflection"
  "_draft/decisions/|decision-record"
  "_draft/reviews/|"          # 人触发, writer 字段可为 codex / 任何 reviewer 名
  "_draft/reports/finance/|finance-publish"
  "_draft/archive/|"          # archive: writer 沿用原文件
)

cd "$WIKI_ROOT"

ok=0; warn=0; missing_writer=0; wrong_writer=0; unknown_path=0
warn_lines=()

while IFS= read -r -d '' f; do
  rel="${f#./}"
  # 顶层 _draft/<doc>.md 是说明文档不是草稿, 跳过
  depth=$(awk -F/ '{print NF-1}' <<< "$rel")
  if (( depth == 1 )); then
    continue
  fi
  # frontmatter writer 抽取 (前 30 行内)
  writer=$(awk '/^---$/{c++; next} c==1 && /^writer:/ {sub(/^writer:[[:space:]]*/,""); gsub(/["\x27]/,""); print; exit}' "$f")

  # 找 bucket
  matched_bucket=""; allowed=""
  for entry in "${OWNERSHIP[@]}"; do
    bucket="${entry%%|*}"
    allow="${entry##*|}"
    if [[ "$rel" == "$bucket"* ]]; then
      matched_bucket="$bucket"; allowed="$allow"; break
    fi
  done

  if [[ -z "$matched_bucket" ]]; then
    warn_lines+=("? $rel  (未在 ownership 表中, 检查 agents-policy.md §2.1)")
    unknown_path=$((unknown_path+1)); warn=$((warn+1))
    continue
  fi

  if [[ -z "$writer" ]]; then
    warn_lines+=("✗ $rel  (frontmatter 缺 writer:, 期望 '$allowed')")
    missing_writer=$((missing_writer+1)); warn=$((warn+1))
    continue
  fi

  # bucket 允许任意 writer (空白名单) → 直接通过
  if [[ -z "$allowed" ]]; then
    ok=$((ok+1))
    continue
  fi

  if [[ "$writer" != "$allowed" ]]; then
    warn_lines+=("✗ $rel  (writer='$writer', 期望 '$allowed')")
    wrong_writer=$((wrong_writer+1)); warn=$((warn+1))
    continue
  fi

  ok=$((ok+1))
done < <(find _draft -type f -name "*.md" -print0 2>/dev/null)

total=$((ok + warn))
echo "check-draft-ownership"
echo "  wiki:    $WIKI_ROOT"
echo "  扫描:    $total 文件 (.md)"
echo "  ✓ OK:    $ok"
echo "  ⚠ warn:  $warn  (缺writer=$missing_writer, 错writer=$wrong_writer, 未知路径=$unknown_path)"

if (( warn > 0 )); then
  echo ""
  echo "── 详情 ──"
  printf "  %s\n" "${warn_lines[@]}"
  echo ""
  echo "依据: _system/standards/agents-policy.md §2.1"
fi

exit 0
