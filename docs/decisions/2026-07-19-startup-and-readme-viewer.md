# 启动说明与 README 站内查看决策

## 背景

现有 README 使用“在本目录执行”的表述，不能让首次使用者快速判断后端、管理页开发和生产预览分别应在哪个目录运行。管理页快照列表也只显示 README 获取状态，无法直接查看数据库中已经保存的 README 内容。

## 启动说明

中英文 README 必须分别说明以下场景，并在每组命令前标注执行目录：

1. 后端服务普通运行：仓库根目录执行 `npm start`。
2. 后端服务调试：仓库根目录执行 `npm run start:debug`，使用 Node Inspector 端口 `9229`。
3. 管理页开发：先在管理页目录安装依赖，再回到仓库根目录执行 `npm run admin:dev`。
4. 管理页生产构建：仓库根目录执行 `npm run admin:build`。
5. 管理页生产预览：仓库根目录执行 `npm run admin:preview`。

仓库根目录定义为包含根 `package.json`、`plugins/` 和 `support/` 的 `github-trend-automator` 目录。

## README 查看交互

1. 快照列表继续使用不含 README 原文的摘要接口，避免一次返回多份大文本。
2. 每一行提供“查看 README”操作，不再以仓库链接作为主要查看动作。
3. 点击后通过详情 API 按需读取单个仓库的完整快照。
4. README 在管理页右侧抽屉中渲染；加载、无内容和获取失败都有明确状态。
5. Markdown 属于外部数据，必须经过 HTML 净化后才能在页面中渲染。

## API 契约

新增接口：

```text
GET /api/github-trending/snapshots/{trendDate}/{owner}/{repository}
```

- 继续使用 API Bearer Token。
- `trendDate` 必须为 `YYYY-MM-DD`。
- 返回完整快照，包含 `readmeContent`、`readmeUrl` 和 `readmeError`。
- 对应快照不存在时返回 `404 snapshot_not_found`。

## 验证结果

- `npm test`：7 个测试全部通过，详情接口覆盖成功读取和不存在两种路径。
- `npm run check`：后端与插件 JavaScript 语法检查通过。
- `npm run admin:typecheck`：Vue TypeScript 检查通过。
- `npm run admin:build`：生产构建通过。
- 依赖审计未发现漏洞，敏感信息扫描未发现真实 Token、密码或私钥。
