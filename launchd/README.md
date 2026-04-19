# launchd

> macOS launchd jobs for personal automation. Each `*.plist` here is installed into `~/Library/LaunchAgents/` by `install-launchd.sh`.

---

## 当前状态 (2026-04-19)

**没有已激活的 job**。

`personal.weekly-reflection.plist` 已于 2026-04-19 删除。原计划周日 21:00 自动建本周复盘草稿, 但实战发现:

- 用户的瓶颈不是"忘了写", 是"从空白草稿启动"
- launchd 跑出来一个空草稿, 仍然得用户主动去填 → 启动门槛没降
- 不如让 `weekly-reflection` skill 在用户对话里**被动触发**: 听到"复盘 / 这周下来 / 上周怎么样"等信号时主动问"要不要起草稿"

详细决策见 `obsidian-wiki/_system/CHANGELOG.md` 2026-04-19 "P1 主动层收敛" 段。

---

## 命名约定 (保留, 给未来 job 用)

- Label MUST start with `personal.` or `personal-tools.` (`install-launchd.sh` 会拒装其他前缀, 防止误装系统 / 第三方 plist)
- 文件名 = `<Label>.plist`
- 一个 plist = 一个 job (不要塞多任务, 不利于排查)

---

## 用法

```bash
cd ~/personal-tools/launchd

./install-launchd.sh

./install-launchd.sh install <name-without-.plist>

./install-launchd.sh uninstall <name-without-.plist>

./install-launchd.sh status

launchctl start <Label>
```

---

## 日志

所有 plist 的 STDOUT / STDERR 应写到 `~/Library/Logs/personal-tools/<job-name>.{out,err}.log`:

```bash
tail -f ~/Library/Logs/personal-tools/<job-name>.out.log
tail -f ~/Library/Logs/personal-tools/<job-name>.err.log
```

约定:
- 脚本"成功 + 啥也没改" 也要至少打一行 stderr (说明跑过), 不然日志看起来像没执行
- 失败必须打到 stderr; launchd 不会自动告警, 重要 job 应配兜底人工触发或 skill 自检

---

## 设计取舍 (写给未来加 job 的自己)

### 什么时候用 launchd, 什么时候用 skill 被动触发?

| 场景 | 用谁 |
|---|---|
| 任务**与用户在不在场无关** (备份 / 索引重建 / 文件同步 / 拉取定时数据) | launchd |
| 任务的输出**只有人能消化** (复盘 / 决策记录 / 灵感整理) | skill 被动触发 (在对话里识别信号) |
| 任务**必须按时跑否则失效** (税务提醒 / 续费检查 / 监控) | launchd + 通知 |
| 任务**跑了人也未必看** (周日自动建空白复盘) | 别建, 改成被动 |

历史教训 (2026-04-19): 把"周日 21:00 建复盘草稿"做成 launchd 是错配 — 输出只有人能消化, 但 trigger 时人不一定在 → 草稿白生成。

### 为什么是 LaunchAgent (per-user) 而不是 LaunchDaemon (system)?

- 个人 automation 不需要 root, 也只在用户登录后才有意义
- LaunchAgent 在用户登录会话里跑, ssh / vscode / cursor 进程都看得见环境变量
- LaunchDaemon 适合"开机就启动, 不依赖登录" 的服务 (如本地 mysql)

### 为什么是复制不是软链?

- 软链: 改源 plist 后, **下次 launchctl load** 才生效, 当前已 load 的实例还跑旧逻辑
- 复制: 安装时刻的快照, 行为可预测; 改源 → 重装 → 新行为, 流程清晰

### `RunAtLoad: false` 的默认值

- 大多数定时任务安装时不应该立刻跑 (装的当下不是该跑的时机)
- 想立刻测一次 → `launchctl start <Label>` 显式触发

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
