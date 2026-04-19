# personal-tools

> 个人系统的"工具与肌肉" — MCP servers / 脚本 / 自动化 plist / Context Middleware。
> **不放数据**(数据在 `obsidian-wiki/`), **不放 secrets**(`~/.config/personal/secrets/`)。
> 设计依据: `obsidian-wiki/_system/SYSTEM-DESIGN.md` §13-§16

## 目录

| 目录 | 内容 | 启动 |
|---|---|---|
| `mcp-servers/` | Python MCP servers (`wiki-search`, `llm-gateway` …) | P1 step 15 起 |
| `scripts/` | 可独立跑的 bash / python 脚本 (`sync-skills-to-codex.sh`, `check-agents-sync.sh` …) | 即起 |
| `launchd/` | macOS launchd `*.plist` 与 `install-launchd.sh` | P1 step 12 |
| `context-middleware/` | 统一上下文路由模块(契约 9 实现件) | P1 step 20 |
| `git-hooks-shared/` | 跨仓库共用 hook 模板(若需要) | 按需 |

## 仓库内 vs 仓库外

| 资产 | 在哪 | 为什么 |
|---|---|---|
| obsidian-wiki 自己的 git hooks | `obsidian-wiki/_system/git-hooks/` | hook 必须随仓库走, 不能放 personal-tools |
| MCP server 实现 | 本仓库 `mcp-servers/` | 跨仓库共用, 需独立版本 |
| Skills 内容(SKILL.md) | `obsidian-wiki/skills/` | 数据/流程视为知识资产 |
| Skills 同步脚本 | 本仓库 `scripts/sync-skills-to-codex.sh` | 工具不是知识 |
| secrets / *.env | `~/.config/personal/secrets/` (不入任何 git) | 契约 11 |

## 当前状态(P0)

- [x] 骨架目录建好
- [x] `.gitignore` (兜底 secrets / db / pyc)
- [x] `scripts/sync-skills-to-codex.sh` (P0 step 6 走方案 B)
- [x] `scripts/check-agents-sync.sh` (最小版, 只校验文件存在)
- [ ] 接 git remote (用户自己决定 GitHub / Gitee, 暂不远端化)
- [ ] 第一个 MCP server `wiki-search` (P1 step 15)

## 怎么跑

```bash
# 第一次: 仅本地 init, 没有 remote
cd ~/personal-tools

# 同步 obsidian-wiki/skills 到 Codex
./scripts/sync-skills-to-codex.sh

# 校验 obsidian-wiki/AGENTS.md 与 standards 同步
./scripts/check-agents-sync.sh
```

## 远端化时(P1 起视情况)

```bash
# 选 GitHub:
gh repo create personal-tools --private --source=. --remote=origin --push

# 选 Gitee / 自建:
git remote add origin <url>
git push -u origin main
```

> 推之前确认 `.gitignore` 兜住 secrets。本仓库本身不该有任何 `.env` 文件。
