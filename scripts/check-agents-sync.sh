#!/usr/bin/env bash
# check-agents-sync.sh (P1-18 完整版, 2026-04-19)
#
# 校验 obsidian-wiki/AGENTS.md 与 _system/ 下规范文件的同步状态。
#
# 检查项 (按契约 14):
#   A. AGENTS.md 引用的 _system/{standards,security,recovery,automations}/*.md 都存在
#   B. 契约 1-15 都在 AGENTS.md 里有 "### 契约 N:" 定义 (硬失败)
#   C. 契约 10-15 在至少一个 standards/security 文件里被引用 (软警告)
#      (契约 1-9 是宪法本身, 在 AGENTS.md 内闭环, 不强求 standards 正文)
#   D. orphan: 文件存在但 AGENTS.md 没引用 (软警告)
#
# 退出码:
#   0 = 全部 OK (可能有 warning, 但无阻塞问题)
#   1 = 用法错误 / AGENTS.md 不存在
#   2 = MISSING file (AGENTS.md 引用了不存在的 standards 文件)
#   3 = MISSING contract (AGENTS.md 缺某条契约定义)
#
# 设计依据:
#   - obsidian-wiki/AGENTS.md §五 (15 条契约) + §九 (standards 索引)
#   - obsidian-wiki/_system/SYSTEM-DESIGN.md §20 P1 step 18
#   - 契约 14 紧急规则: 紧急手改 standards 而未及时同步 AGENTS.md, 24h 内补回

set -euo pipefail

WIKI="${WIKI_ROOT:-$HOME/obsidian-wiki}"
AGENTS="$WIKI/AGENTS.md"

# ─── 颜色 (可选, 不在 TTY 时关掉) ────────────────────
if [[ -t 1 ]]; then
    RED=$'\033[0;31m'
    YELLOW=$'\033[0;33m'
    GREEN=$'\033[0;32m'
    BOLD=$'\033[1m'
    NC=$'\033[0m'
else
    RED=""; YELLOW=""; GREEN=""; BOLD=""; NC=""
fi

err()   { echo "${RED}✗ $*${NC}" >&2; }
warn()  { echo "${YELLOW}⚠️  $*${NC}"; }
ok()    { echo "${GREEN}✓ $*${NC}"; }
head1() { echo "${BOLD}── $* ──${NC}"; }

# ─── 入口校验 ────────────────────────────────────────
if [[ ! -f "$AGENTS" ]]; then
    err "$AGENTS 不存在"
    echo "  Hint: export WIKI_ROOT=/path/to/obsidian-wiki" >&2
    exit 1
fi

echo "${BOLD}check-agents-sync (P1-18 完整版)${NC}"
echo "  wiki:     $WIKI"
echo "  AGENTS:   $AGENTS"
echo

# ─── A. Standards 文件引用一致性 ─────────────────────
head1 "A. Standards 文件引用一致性"

referenced=$(grep -oE '_system/(standards|security|recovery|automations)/[A-Za-z0-9_./-]+\.md' "$AGENTS" 2>/dev/null | sort -u || true)
existing=$(cd "$WIKI" && find _system/standards _system/security _system/recovery _system/automations -type f -name '*.md' 2>/dev/null | sort -u || true)

ref_count=$(echo "$referenced" | grep -c . || echo 0)
exi_count=$(echo "$existing"   | grep -c . || echo 0)
echo "  引用 ($ref_count) / 存在 ($exi_count)"

missing_files=$(comm -23 <(echo "$referenced") <(echo "$existing") || true)
orphan_files=$(comm -13  <(echo "$referenced") <(echo "$existing") || true)

if [[ -n "$missing_files" ]]; then
    err "MISSING (AGENTS.md 引用了, 但文件不存在):"
    echo "$missing_files" | sed 's/^/    ! /' >&2
fi

if [[ -n "$orphan_files" ]]; then
    warn "ORPHAN (文件存在, AGENTS.md §九 索引表未列入):"
    echo "$orphan_files" | sed 's/^/    ? /'
fi

if [[ -z "$missing_files" && -z "$orphan_files" ]]; then
    ok "全部 standards 文件 ↔ AGENTS.md 引用一致"
fi
echo

# ─── B. 契约 1-15 定义齐全 ───────────────────────────
head1 "B. 契约 1-15 在 AGENTS.md 内定义齐全"

defined_in_agents=()
missing_definitions=()
for n in $(seq 1 15); do
    if grep -qE "^###[[:space:]]+契约[[:space:]]*${n}[:：]" "$AGENTS"; then
        defined_in_agents+=("$n")
    else
        missing_definitions+=("$n")
    fi
done

echo "  AGENTS.md 已定义: ${#defined_in_agents[@]}/15"
if [[ ${#missing_definitions[@]} -gt 0 ]]; then
    err "MISSING DEFINITION (AGENTS.md 里没找到 '### 契约 N:'):"
    printf "    ! 契约 %s\n" "${missing_definitions[@]}" >&2
else
    ok "15 条契约定义齐全"
fi
echo

# ─── C. 契约 10-15 在 standards/security 中至少被引用一次 ──
head1 "C. 契约 10-15 在 standards/security 文件中被引用 (软警告)"

referenced_in_standards=()
not_referenced_in_standards=()
for n in $(seq 10 15); do
    # 匹配 "契约 N" 后面跟非数字字符 (避免 1 误匹配 10/11/12/...)
    if grep -rqE "契约[[:space:]]*${n}([^0-9]|$)" "$WIKI/_system/standards" "$WIKI/_system/security" 2>/dev/null; then
        referenced_in_standards+=("$n")
    else
        not_referenced_in_standards+=("$n")
    fi
done

echo "  standards/security 中可定位: ${#referenced_in_standards[@]}/6 (契约 10-15)"
if [[ ${#not_referenced_in_standards[@]} -gt 0 ]]; then
    warn "下列契约在 _system/{standards,security}/*.md 里没有显式 '契约 N' 引用:"
    for n in "${not_referenced_in_standards[@]}"; do
        case "$n" in
            10) reason="(可接受: SKILL.md 标准本身分散在各 skill 目录, 无单一 standards 文件)" ;;
            13) reason="(建议补: publish-workflow.md 应显式写 '契约 13')" ;;
            14) reason="(可接受: 契约 14 = 本脚本本身, 闭环在 AGENTS.md)" ;;
            *)  reason="(请补: 该契约应在某 standards/security 文件正文中显式编号)" ;;
        esac
        echo "    ? 契约 $n  $reason"
    done
fi
if [[ ${#not_referenced_in_standards[@]} -eq 0 ]]; then
    ok "契约 10-15 全部在 standards/security 中可定位"
fi
echo

# ─── 总结 + 退出码 ───────────────────────────────────
head1 "总结"
fail_files=0
fail_contracts=0
[[ -n "$missing_files" ]] && fail_files=1
[[ ${#missing_definitions[@]} -gt 0 ]] && fail_contracts=1

if [[ $fail_files -eq 1 ]]; then
    err "FAIL: AGENTS.md 引用了不存在的 standards 文件 (修后再跑)"
    exit 2
fi
if [[ $fail_contracts -eq 1 ]]; then
    err "FAIL: AGENTS.md 缺契约定义 (修后再跑)"
    exit 3
fi

if [[ -n "$orphan_files" ]] || [[ ${#not_referenced_in_standards[@]} -gt 0 ]]; then
    ok "无阻塞问题, 但有 warning 待审 (见上)"
else
    ok "全部同步, 无 warning"
fi
exit 0
