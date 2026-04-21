# weixin-clip — 微信公众号文章 → Obsidian（Chrome 扩展 · MVP 规格）

> **状态**: MVP 代码在 `extension/`（Chrome MV3），可「加载已解压的扩展程序」自测。  
> **设计约束**: 只用 **Chrome**; **仅右键菜单** 入口; **不**起本地 HTTP 服务; 落盘到 **本机用户通过 File System Access API 授权的目录**（推荐指向 `obsidian-wiki/raw/general/wechat-clips/` 等）。

---

## 0. 安装与使用（实现版）

1. 打开 Chrome → **扩展程序** → 打开「开发者模式」→ **加载已解压的扩展程序** → 选择本仓库下的 `weixin-clip/extension/` 目录。  
2. 在扩展卡片上打开 **扩展程序选项**（或右键扩展图标 → 选项）→ **选择目录…**，授权保存剪藏的文件夹（例如 `…/obsidian-wiki/raw/general/wechat-clips/`）。句柄写入扩展同源 **IndexedDB**，刷新后不必重选。  
3. 打开任意 `https://mp.weixin.qq.com/s/...` 文章页 → 页面空白处 **右键** → **剪藏到 Obsidian**。  
4. 另有一项 **重新选择保存目录…** 用于更换目标文件夹。  
5. 成功/失败会通过 **系统通知** 提示；部分图片失败时，Markdown frontmatter 中会写入 `failed_assets` 列表，正文仍保留可访问的远程 `img` 地址。

**Manifest 说明**: `host_permissions` 含 `https://*/*`，便于从各 CDN 域名拉取正文图片（自用扩展）；若你介意权限面，可自行收窄并按需补域名。

**最后验证 DOM 选择器**: _待你本地在微信文章页自测后填写日期（`#js_content` / `#activity-name` / `og:title`）。_

---

## 1. 目标

在微信文章页 (`https://mp.weixin.qq.com/s/...`) 用浏览器阅读时, **右键一键** 将正文与图片保存为:

- 一篇 **Markdown** 文件  
- 同篇关联的 **本地图片**（及后续可选扩展: 音频/视频等）

保存位置为用户在扩展中 **一次性授权** 的目录（推荐 `~/obsidian-wiki/raw/general/wechat-clips/` 或自建子目录）, 后续仍按 obsidian-wiki 既有 **raw 分级 + ingest** 流程处理, **不**默认写入 `wiki/`。

---

## 2. 硬性约束（已拍板）

| 项 | 决策 |
|---|---|
| 浏览器 | **仅 Chrome**（Chromium MV3 扩展） |
| 用户入口 | **仅** `chrome.contextMenus` 右键菜单（**不要**工具栏按钮作为 MVP 必选项） |
| 本地服务 | **禁止**依赖常驻或手动的 `http://127.0.0.1` 类服务 |
| 写盘方式 | **File System Access API** — 用户在 **选项页** 选择目录并 **持久化目录句柄**（IndexedDB 存 `FileSystemDirectoryHandle`；`chrome.storage` 仅记展示用 `lastDirName`） |
| 数据与 secret | Cookie / token **不落盘**到 Markdown; 若扩展内需带 `Referer` 拉图, 仅在扩展内存/Service Worker 请求中使用 |

---

## 3. 右键菜单行为

### 3.1 展示条件

- 仅在 **匹配** `https://mp.weixin.qq.com/*` 的页面上下文显示（避免污染全局右键菜单）。

### 3.2 菜单项（MVP）

1. **「剪藏到 Obsidian」** — 已绑定目录则直接剪藏；未绑定时自动打开 **选项页** 并通知先选目录。  
2. **「重新选择保存目录…」** — 打开选项页，可重新 `showDirectoryPicker` 或清除绑定。

### 3.3 执行结果反馈

- 成功: `chrome.notifications`（`iconUrl` 使用包内 `icons/icon48.png`）。  
- 失败: 必须可读错误（网络 / DOM 变更 / 写盘权限丢失等）, 不静默失败。

---

## 4. 页面解析（微信）

- **正文容器**: 以当前微信 Web 版为准, 默认选择器指向 `#js_content` 一带; **实现时**应用「保存的 HTML fixture」做小范围回归, 并在 README 记录「最后验证日期」。  
- **标题**: 优先 `og:title` / `document.title` / `#activity-name` 等, 按优先级降级。  
- **图片**: 遍历正文内 `img`, 读取 `src` / `data-src` / `data-original` 等常见懒加载属性; 去重 URL。  
- **下载图片**: 在 **Service Worker** 内 `fetch(url, { headers: { Referer: 'https://mp.weixin.qq.com/' } })` 获取 blob, 再写入已授权目录下子文件夹。**不**把整页 Cookie 写入 Markdown。

---

## 5. 输出文件约定

### 5.1 命名

- **basename**: `YYYY-MM-DD-<slug>.md`, 其中 `slug` 由标题转 kebab-case ASCII, 冲突时后缀 `-2`、`-3`。  
- **资源目录**: 与 md 同级的 `YYYY-MM-DD-<slug>_assets/`（或同级 `assets/` 子目录, 实现前在代码里二选一并写死, 避免混用）。

### 5.2 Markdown 结构（建议）

```yaml
---
title: "<文章标题>"
source_url: "<当前页 https URL>"
clipped_at: "<ISO8601 本地时间>"
clipper: weixin-clip
---

正文…
```

- 正文: HTML → Markdown（选用成熟库, 如 Turndown 或等价）; 图片为 **相对路径** `YYYY-MM-DD-<slug>_assets/xxx.png`。

### 5.3 失败资源

- 某张图下载失败: 在 frontmatter 或文末增加 `failed_assets: [ { url, reason } ]`, 正文该位置保留原始 URL 或占位说明。

---

## 6. 权限清单（Manifest, 草案）

- `host_permissions`: `https://mp.weixin.qq.com/*`  
- `permissions`: `contextMenus`, `storage`, `notifications`（若用通知）  
- **不**在 MVP 阶段申请 `cookies` 权限, 除非实测无 Cookie 无法拉图再评估。

---

## 7. 非目标（MVP 不做）

- Safari / Firefox  
- 批量爬取整个公众号历史  
- 自动进 `wiki/` 或自动触发 ingest  
- 依赖本地常驻 HTTP 服务或 Native Messaging（本 MVP 明确排除）

---

## 8. 合规与自用边界

- 工具只提供「把当前页可访问内容保存到本机」能力; **转载与版权**由使用者自行判断。  
- 建议在 frontmatter 保留 `source_url` 便于溯源。

---

## 9. 实现后验收清单（自测用）

- [ ] 在任意 `mp.weixin.qq.com/s/...` 文章页右键 → 仅出现本扩展相关项, 其他站点不出现。  
- [ ] 首次在选项页选目录并成功写入; 重启浏览器后 **无需重新选目录** 仍可保存。  
- [ ] 生成 md + `_assets` 内图片可在 Obsidian 中正常打开, 相对路径无误。  
- [ ] 断网 / 单图 403 时有通知提示与 `failed_assets` 记录。  
- [ ] 扩展包内 **无** API key / Cookie 明文落盘。

---

## 10. 与 obsidian-wiki 的衔接

- 默认文档路径建议在 `README` 或扩展 options 中写明示例: `~/obsidian-wiki/raw/general/wechat-clips/`。  
- 与 `AGENTS.md` / `data-classification` 一致: 含个人隐私或高敏内容时, 用户应改选 `raw/sensitive/` 等, 工具不替用户做分级判断。

---

*规格版本: 2026-04-21 · 与用户确认: Chrome only + 右键菜单 only + 无本地服务*
