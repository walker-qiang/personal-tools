# launchd

> macOS launchd jobs for personal automation. Each `*.plist` here is installed into `~/Library/LaunchAgents/` by `install-launchd.sh`.

---

## 命名约定

- Label MUST start with `personal.` or `personal-tools.` (`install-launchd.sh` 会拒装其他前缀, 防止误装系统 / 第三方 plist)
- 文件名 = `<Label>.plist`
- 一个 plist = 一个 job (不要塞多任务, 不利于排查)

---

## 当前 jobs

| Label | 触发 | 调用 | 说明 |
|---|---|---|---|
| `personal.weekly-reflection` | 每周日 21:00 | `python3 obsidian-wiki/skills/weekly-reflection/scripts/draft.py` | 自动建本周空白复盘草稿 (P1-12) |

未来 (P1-13/14):
- `personal.monthly-backup` — 每月 1 号异地 tarball 备份
- `personal.daily-capture` — 每天 23:55 把 inbox 内的草稿摘要进 daily journal

---

## 用法

```bash
cd ~/personal-tools/launchd

# 装当前目录所有 personal.* plist
./install-launchd.sh

# 装单个 (不带 .plist 后缀)
./install-launchd.sh install personal.weekly-reflection

# 卸载单个
./install-launchd.sh uninstall personal.weekly-reflection

# 查状态 + 最近一次输出
./install-launchd.sh status

# 立刻触发一次 (不等周日, 用来烟雾测试)
launchctl start personal.weekly-reflection
```

---

## 日志

所有 plist 的 STDOUT / STDERR 都写到 `~/Library/Logs/personal-tools/<job-name>.{out,err}.log`:

```bash
tail -f ~/Library/Logs/personal-tools/weekly-reflection.out.log
tail -f ~/Library/Logs/personal-tools/weekly-reflection.err.log
```

约定:
- 脚本"成功 + 啥也没改" 也要至少打一行 stderr (说明跑过), 不然日志看起来像没执行
- 失败必须打到 stderr; launchd 不会自动告警, 兜底是 `check-reflection-status` skill (周一打开 Codex 时自检)

---

## 设计取舍

### 为什么是 LaunchAgent (per-user) 而不是 LaunchDaemon (system)?

- 这些任务**不需要 root**, 也只在用户登录后才有意义 (要写到 `~/obsidian-wiki/_draft/`)
- LaunchAgent 在用户登录会话里跑, ssh / vscode / cursor 进程都看得见环境变量
- LaunchDaemon 适合"开机就启动, 不依赖登录" 的服务 (如本地 mysql), 这里不需要

### 为什么是复制不是软链?

- 软链: 改源 plist 后, **下次 launchctl load** 才生效, 但当前已 load 的实例还跑旧逻辑
- 复制: 安装时刻的快照, 行为可预测; 改源 → 重装 → 新行为, 流程清晰

### 为什么 `RunAtLoad: false`?

- 这是周复盘 job, 安装时不应该立刻跑 (那不是周日)
- 想立刻测一次 → `launchctl start personal.weekly-reflection` 显式触发

### 周日 laptop 关机怎么办?

launchd `StartCalendarInterval` **不保证补跑**。兜底:
1. `obsidian-wiki/skills/check-reflection-status/` skill — 周一你打开 Codex 时, AI 检查上周草稿是否存在, 不存在就提示并问是否补跑
2. 手动: `launchctl start personal.weekly-reflection`

---

## Uninstall (整个 personal-tools launchd 子系统全卸)

```bash
for f in ~/Library/LaunchAgents/personal.*.plist ~/Library/LaunchAgents/personal-tools.*.plist; do
    [ -f "$f" ] || continue
    name=$(basename "$f" .plist)
    ~/personal-tools/launchd/install-launchd.sh uninstall "$name"
done
```

Logs 在 `~/Library/Logs/personal-tools/` — 是否清掉自己拍。
