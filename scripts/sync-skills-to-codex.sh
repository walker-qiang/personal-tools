#!/usr/bin/env bash
# sync-skills-to-codex.sh
#
# 把 ~/obsidian-wiki/skills/<name>/ 软链到 ~/.codex/skills/wiki-<name>/
# (前缀 wiki- 是为了防止与 Codex 自带 skill 撞名)
#
# 幂等: 已存在的链接会先清理再重建; 已存在的真目录(非软链)会跳过并告警
# 输出: 列出 added / kept / removed / skipped, 让人一眼看清状态
#
# 触发场景: 在 ~/obsidian-wiki/skills/ 加/改/删 skill 后跑一次
# 安装后 Codex 会自动看到 wiki-<name> 形式的 skill
#
# 设计依据: SYSTEM-DESIGN.md §3.3 P0 step 6 方案 B (Codex 0.121 无 skill_paths config)

set -euo pipefail

SRC="${SKILLS_SRC:-$HOME/obsidian-wiki/skills}"
DST="${SKILLS_DST:-$HOME/.codex/skills}"
PREFIX="${SKILL_PREFIX:-wiki-}"

# ─── 前置检查 ─────────────────────────────────────────────────
if [[ ! -d "$SRC" ]]; then
  echo "✗ 源目录不存在: $SRC" >&2
  echo "  在 obsidian-wiki/ 下: mkdir -p skills" >&2
  exit 1
fi
mkdir -p "$DST"

added=()
kept=()
removed=()
skipped=()

# ─── 1. 同步源 → 目标 ─────────────────────────────────────────
for src_dir in "$SRC"/*/; do
  [[ -d "$src_dir" ]] || continue
  name=$(basename "$src_dir")
  target_name="${PREFIX}${name}"
  link_path="$DST/$target_name"

  if [[ -L "$link_path" ]]; then
    # 已是软链, 检查指向是否对
    current=$(readlink "$link_path")
    expected="${src_dir%/}"
    if [[ "$current" == "$expected" ]]; then
      kept+=("$target_name")
      continue
    else
      rm "$link_path"
      ln -s "$expected" "$link_path"
      added+=("$target_name (relinked)")
    fi
  elif [[ -e "$link_path" ]]; then
    skipped+=("$target_name (已存在且不是软链, 不动)")
    continue
  else
    ln -s "${src_dir%/}" "$link_path"
    added+=("$target_name")
  fi
done

# ─── 2. 清理悬挂软链(源已删除的) ──────────────────────────────
shopt -s nullglob
for link in "$DST"/${PREFIX}*; do
  [[ -L "$link" ]] || continue
  target=$(readlink "$link")
  if [[ ! -d "$target" ]]; then
    rm "$link"
    removed+=("$(basename "$link") (source 已不存在)")
  fi
done
shopt -u nullglob

# ─── 3. 输出报告 ──────────────────────────────────────────────
echo "sync-skills-to-codex 完成"
echo "  src: $SRC"
echo "  dst: $DST"
echo "  prefix: $PREFIX"
echo
printf "  added (%d):\n" "${#added[@]}";   printf "    + %s\n" "${added[@]:-(none)}"
printf "  kept  (%d):\n" "${#kept[@]}";    printf "    = %s\n" "${kept[@]:-(none)}"
printf "  removed (%d):\n" "${#removed[@]}"; printf "    - %s\n" "${removed[@]:-(none)}"
printf "  skipped (%d, 需手动处理):\n" "${#skipped[@]}"; printf "    ! %s\n" "${skipped[@]:-(none)}"

if (( ${#skipped[@]} > 0 )); then
  exit 2
fi
