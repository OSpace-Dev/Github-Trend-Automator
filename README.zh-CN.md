# GitHub Trend Automator

[English](README.md) | 简体中文

GitHub Trend Automator 通过 Chrome/Edge 扩展采集 GitHub Daily Trending 公共榜单，并按天保存 SQLite 快照。本地 Node.js 服务在北京时间每天 09:00 创建任务，通过 SSE 分发给已连接的扩展，再持久化扩展回传的仓库字段和 README 原文。

## 组成部分

```text
.
├─ plugins/
│  └─ trending-collector/       # Manifest V3 扩展与 side panel
├─ support/
│  └─ api/
│     └─ github-trending/       # 调度、HTTP API、SSE 桥接和 SQLite 存储
└─ tests/                       # 调度与 API 集成测试
```

## 采集内容

每个每日快照包含：

- Trending 排名与榜单日期
- 仓库所有者、名称、描述和 URL
- 主要编程语言
- 总 stars 与总 forks
- 今日新增 stars
- README 原文与 README 获取状态
- 采集时间和任务 ID

快照以“榜单日期 + 仓库”为唯一键。同一天重复执行任务会更新当天快照，不会产生重复记录。

## 环境要求

- Node.js 22 或更高版本，并支持 `node:sqlite`
- Chrome 或 Edge 116 或更高版本
- 能够访问 `github.com` 和 `api.github.com`

Trending 页面和 README 接口均为公开内容。本项目不保存 GitHub 密码、Cookie、Personal Access Token 或 SSH 私钥。

## 快速开始

### 1. 启动本地服务

```powershell
npm start
```

默认服务地址为 `http://127.0.0.1:8011`。如果服务在北京时间 09:00 后首次启动，会自动补建当天尚未创建的定时任务。

### 2. 加载扩展

1. 打开 `chrome://extensions/` 或 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `plugins/trending-collector/`。
5. 点击扩展图标打开 side panel。

扩展会自动连接本地服务，也可以在 side panel 中点击“立即抓取 Daily Trending”执行手动补抓。

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `GITHUB_TRENDING_HOST` | 服务监听地址 | `127.0.0.1` |
| `GITHUB_TRENDING_PORT` | 服务监听端口 | `8011` |
| `GITHUB_TRENDING_API_TOKEN` | 查询 API 令牌 | 开发占位值 |
| `GITHUB_TRENDING_EXTENSION_TOKEN` | 扩展桥接令牌 | 开发占位值 |
| `GITHUB_TRENDING_DB_PATH` | SQLite 数据库路径 | `tmp/github-trending.sqlite` |
| `GITHUB_TRENDING_SCHEDULE_HOUR` | Asia/Shanghai 每日执行小时 | `9` |
| `GITHUB_TRENDING_LOG_LEVEL` | 日志级别 | `info` |

内置令牌只用于本机开发。对 localhost 以外地址开放服务前必须替换两个令牌，并同步修改扩展中的连接设置。

## API

所有 `/api/` 接口都要求：

```text
Authorization: Bearer <GITHUB_TRENDING_API_TOKEN>
```

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 查询服务、扩展、队列与调度状态 |
| `POST` | `/api/github-trending/jobs` | 创建手动采集任务 |
| `GET` | `/api/github-trending/jobs` | 查询最近任务 |
| `GET` | `/api/github-trending/jobs/{jobId}` | 查询单个任务 |
| `GET` | `/api/github-trending/snapshots?date=YYYY-MM-DD` | 查询每日快照 |

## 开发验证

```powershell
npm test
npm run check
```

GitHub 公共 API 对每个 IP 的未认证请求限制为每小时 60 次。正常 Daily Trending 榜单项目数低于该限制，但短时间反复手动执行可能导致 README 请求触发限流。限流错误会按仓库保存，不会阻止 Trending 榜单快照入库。

## 使用说明

- 采集器读取公共 `https://github.com/trending` 页面，并固定使用 `since=daily`。
- 扩展会为每个任务打开受管理的后台标签页，采集结束后自动关闭。
- 使用者应自行确认采集及后续处理符合 GitHub 服务条款和适用的数据使用要求。
