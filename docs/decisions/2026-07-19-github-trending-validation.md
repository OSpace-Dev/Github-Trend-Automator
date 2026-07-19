# GitHub Trending 节流与管理页验证记录

## 问题现象

管理需求同时涉及 README 请求频率、每日调度、SQLite 设置持久化和浏览器管理页面；单独验证某一层无法证明完整链路可用。

## 根因判断

原有调度器只支持整点小时，扩展 README 请求也没有任务级间隔参数。管理页面若直接依赖环境变量，还会在服务重启后覆盖用户已经保存的策略。

## 关键证据

- `DailyScheduler` 现在用 `HH:mm` 计算固定 `Asia/Shanghai` 的下一次执行时间，并支持 `reschedule()`。
- SSE `collect_trending` 事件包含 `readmeDelayMinMs` 和 `readmeDelayMaxMs`。
- 扩展 offscreen 文档按项目串行请求 README，在相邻请求间使用随机等待。
- SQLite `settings` 表保存调度和节流设置；接口测试覆盖更新、统计、CORS、鉴权和非法输入。
- `npm test` 通过 7 个测试，`npm run check`、`npm run admin:typecheck` 和 `npm run admin:build` 均通过。

## 修复动作

1. 将调度配置统一为 `HH:mm`，更新后取消旧计时器并立即重排。
2. 将 README 间隔作为任务负载下发，扩展端串行执行并报告进度。
3. 增加设置、统计和摘要快照 API，并用 CORS 白名单限制本地管理页来源。
4. 增加 Vue 3 管理页面，提供统计、手动任务、调度节流设置、任务表和日期快照表。
5. 将英文和简体中文 README 同步到新的启动、配置和 API 说明。

## 后续排查方法

1. 先检查 `GET /health` 的 `schedule`、`settings` 和 `extensionClients`。
2. 再检查管理页 API 请求是否带有 API Bearer Token，来源是否在 `GITHUB_TRENDING_ADMIN_ORIGINS`。
3. 观察 `collect_trending` SSE 数据中的两个毫秒间隔，并查看扩展侧 README progress 日志。
4. 使用 `npm test`、`npm run check`、`npm run admin:typecheck` 和 `npm run admin:build` 做回归验证。
