# personal-tools

> 个人系统的"工具与肌肉" — MCP servers / 脚本 / 自动化 plist。
> **数据**在 `obsidian-wiki` 仓 (private, 主用户独享); **secrets** 在 `~/.config/personal/secrets/`，永不入 git。
> 设计依据: `obsidian-wiki/_system/SYSTEM-DESIGN.md` §13–§16 (该文件不公开)。

---

## TL;DR — 这仓是什么 / 不是什么 / 是给谁的

| 维度 | 说明 |
|---|---|
| **是什么** | 一个 macOS / zsh 用户的私人 AI-knowledge-system 配套工具仓: MCP servers + bash 维护脚本 + launchd 模板 |
| **不是什么** | 不是通用脚手架 / 不是给陌生人开箱即用的 / 不放任何 secret 或 token / 不放业务数据 |
| **是给谁的** | 主人自己 (主用户 walker-qiang); 仓本身 public 是为了便于代码 review / 未来局部开源 (纯工具代码, 无敏感数据)。第三方可参考思路, 但**直接 clone 跑大概率不工作** (见下) |
| **路径假设** | 硬编码 `~/obsidian-wiki` / `~/.codex/` / `~/.local/share/personal/`。换路径需要改源 |
| **依赖** | macOS (launchd 是 macOS 独有); zsh; git; brew + uv (装 wiki-search) |

---

## 目录

| 目录 | 内容 | 状态 |
|---|---|---|
| `mcp-servers/wiki-search/` | Python MCP server, 把 obsidian-wiki 暴露给 Codex 做全文检索 (SQLite FTS5) | ✅ P1-15 已上线 (v0.1) |
| `scripts/` | 维护脚本 (`sync-skills-to-codex.sh`, `check-agents-sync.sh`, `check-draft-ownership.sh`, `start-personal-stack.sh`, `weekly-digest.py`) | ✅ 全可跑 |
| `launchd/` | macOS launchd `*.plist` 与 install/uninstall 脚本 | ✅ 骨架在; 当前默认无 job |
| `mcp-servers/llm-gateway/` | (规划) 出口拦截, 按数据分级决定模型可不可以收到 | ⏸ P1-17 挂起 |
| `context-middleware/` | (规划) 输入侧上下文路由 | ⏸ P1-20 挂起 |
| `weixin-clip/` | Chrome MV3 扩展: 微信文章页 **右键** 剪藏到 Obsidian 指定目录 (File System Access, **无**本地 HTTP 服务) | ✅ MVP 已可自测 (`extension/`, 当前 `v0.4.1`) |

---

## 仓库内 vs 仓库外

| 资产 | 住哪 | 为什么不在 personal-tools |
|---|---|---|
| obsidian-wiki 的 git hooks (pre-commit / pre-push) | `obsidian-wiki/_system/git-hooks/` | hook 必须随仓库走 |
| MCP server 实现 | 本仓库 `mcp-servers/` | 工具实现可被多仓库复用 |
| Skills 内容 (SKILL.md) | `obsidian-wiki/skills/` | 知识资产, 不是工具 |
| Skills 同步到 Codex 的脚本 | 本仓库 `scripts/sync-skills-to-codex.sh` | 工具 |
| secrets / `*.env` | `~/.config/personal/secrets/` (不入任何 git) | 契约 11 |
| 业务数据 / wiki 文档 / 决策草稿 | `obsidian-wiki/` | 知识 vs 工具分离 |

---

## 怎么试 (主人本机或好奇的第三方)

> 第三方注意: 这些脚本会假定 `~/obsidian-wiki` 存在。第三方 clone 时建议先 fork [obsidian-wiki](https://github.com/walker-qiang/obsidian-wiki) 一起拉, 或自己改源里的路径。

```bash
git clone git@github.com:walker-qiang/personal-tools.git ~/personal-tools
cd ~/personal-tools

# 看看维护脚本能跑 (前提: ~/obsidian-wiki 存在)
./scripts/check-agents-sync.sh
./scripts/check-draft-ownership.sh

# 装 wiki-search MCP server (前提: brew install uv)
cd mcp-servers/wiki-search
uv sync
WIKI_ROOT=$HOME/obsidian-wiki uv run wiki-search-index   # 应输出 indexed 91 docs
WIKI_ROOT=$HOME/obsidian-wiki uv run wiki-search-server  # stdio MCP, Ctrl-C 退出
```

要把 wiki-search 接入 Codex, 见 `mcp-servers/wiki-search/README.md` 与 `obsidian-wiki/_system/BOOTSTRAP.md` §4.2。

### 一键起 personal-finance + personal-agent + personal-web

前提: 三个仓已在默认路径 `~/personal-finance` `~/personal-agent` `~/personal-web`, 且各自做过首次 `make migrate` / `uv sync` / `npm install` (见 `obsidian-wiki/_system/guides/personal-stack-usage.md`)。

```bash
chmod +x ~/personal-tools/scripts/start-personal-stack.sh   # 仅首次
~/personal-tools/scripts/start-personal-stack.sh start    # 或: status | stop | restart | logs
```

### 试用 weixin-clip Chrome 扩展

```text
Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序
选择 ~/personal-tools/weixin-clip/extension/
```

然后在扩展 **选项页** 里先绑定保存目录, 再到 `https://mp.weixin.qq.com/s/...` 文章页空白处右键 **「剪藏到 Obsidian」**。详细说明见 `weixin-clip/README.md`。

---

## 当前状态

| 类别 | 项 | 状态 |
|---|---|---|
| P0 骨架 | 目录 + `.gitignore` (secrets / db / pyc / .venv) | ✅ |
| P0 接入 Codex | `scripts/sync-skills-to-codex.sh` | ✅ |
| P0 一致性校验 | `scripts/check-agents-sync.sh` (最小版) → P1-18 完整版 | ✅ |
| P1-15 | `mcp-servers/wiki-search` (3 工具 / 91 docs / FTS5) | ✅ |
| P1-18 | `check-agents-sync.sh` 完整版 (15 契约 + 9 standards 校验) | ✅ |
| —— 自测后补 —— | `scripts/check-draft-ownership.sh` (软警告模式) | ✅ |
| —— 周记辅助 —— | `scripts/weekly-digest.py` (汇总最近一周 wiki + tools 事实变动, 输出 markdown/json) | ✅ |
| v0.4.1 | `weixin-clip` Chrome 扩展 (右键剪藏微信文章, 目录授权, Markdown + 图片落盘) | ✅ |
| P1-13 | monthly-backup tarball + launchd | ⏸ 挂起 (用户判断当前 GitHub origin + iCloud 已够用) |
| P1-17 | `mcp-servers/llm-gateway` | ⏸ 挂起 (无外部模型出口需求) |
| P1-20 | `context-middleware/` | ⏸ 挂起 (反流场景未到痛点) |

---

## 维护原则 (给未来的我)

1. **不放 secret**: `.gitignore` 已兜底 `*.env / secrets/ / *.pem / *.db / state/`; 提交前过 `git status` 看一眼
2. **不依赖业务仓**: 任何脚本路径假设要写在 README 里, 不要静默 hardcode
3. **可跑性 > 可读性**: 脚本失败要给出明确退出码 + 修复提示
4. **改一处改两处**: pre-commit/pre-push 的黑名单要和这里的脚本同步 (见 `obsidian-wiki/_system/security/SECURITY.md`)

---

## 远端

- origin: https://github.com/walker-qiang/personal-tools
- 配套数据仓: https://github.com/walker-qiang/obsidian-wiki
