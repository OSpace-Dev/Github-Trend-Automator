# GitHub Trend Automator

[English](README.md) | [简体中文](README.zh-CN.md)

GitHub Trend Automator 通过 Manifest V3 浏览器插件采集 GitHub 每日 Trending，使用公开 README 接口补充仓库信息，并将每日结果保存为 SQLite 快照。本地 Node.js 服务负责调度、通过 SSE 下发任务，并提供一个紧凑的 Vue 管理页面。

## 项目组成

```text
plugins/trending-collector/                 Manifest V3 插件与侧边栏
support/api/github-trending/                Node.js API、调度器、SSE 桥接与 SQLite 存储
support/admin/github-trending-admin/        Vue 3 管理页面
tests/                                       Node.js 回归测试
```

## 环境要求

- Node.js 22 或更高版本（使用 `node:sqlite`）
- Chrome 或 Edge 116 或更高版本
- 可以访问 `github.com` 和 `api.github.com`

采集器使用 GitHub 公开页面和公开 README 接口，不保存 GitHub 密码、Cookie、Personal Access Token 或 SSH 私钥。

## 启动项目

以下命令使用 Windows PowerShell，并统一在仓库根目录执行，即包含 `package.json`、`plugins/` 和 `support/` 的 `github-trend-automator` 目录。

### 1. 终端运行后端服务

执行目录：仓库根目录。

```powershell
npm start
```

服务启动后监听 `http://127.0.0.1:8011`。该终端需要保持运行。

### 2. 调试后端服务

执行目录：仓库根目录。该命令启用 Node Inspector，调试端口为 `127.0.0.1:9229`。

```powershell
npm run start:debug
```

可以使用 Chrome DevTools 或 VS Code 的 Node.js 调试器附加到 `9229` 端口。

### 3. 安装管理页依赖

首次运行或 `package-lock.json` 变化后执行。执行目录：仓库根目录。

```powershell
npm --prefix support/admin/github-trending-admin install
```

### 4. 开发模式运行管理页

另开一个 PowerShell 终端。执行目录：仓库根目录。

```powershell
npm run admin:dev
```

打开 `http://127.0.0.1:5174`。Vite 会监听源码变化并自动刷新页面。

### 5. 构建与预览管理页

执行目录：仓库根目录。

```powershell
npm run admin:build
npm run admin:preview
```

生产构建输出到 `support/admin/github-trending-admin/dist/`，预览地址为 `http://127.0.0.1:4174`。

### 6. 加载浏览器插件

1. 保持后端服务运行。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`。
3. 开启开发者模式并选择“加载已解压的扩展程序”。
4. 选择仓库根目录下的 `plugins/trending-collector/` 目录。

管理页面只会在浏览器 `localStorage` 中保存本地 API 地址和 API Token；默认值是开发占位符。

## 采集与调度

README 请求采用串行执行。每次请求之间会在可配置的最小值和最大值之间随机等待，默认间隔为 2–5 秒，避免单个任务短时间内产生请求突发。单个 README 获取失败会记录在对应仓库上，不会丢弃 Trending 快照。

每日调度时间使用固定 `Asia/Shanghai` 时区的 `HH:mm` 格式，默认 `09:00`。管理页面可以修改调度时间和 README 间隔，保存后会立即重新计算下一次执行时间。

## API

所有 `/api/` 接口都需要 `Authorization: Bearer <GITHUB_TRENDING_API_TOKEN>`。

| 方法 | 接口 | 作用 |
| --- | --- | --- |
| `GET` | `/health` | 服务、插件、队列、调度和设置状态 |
| `GET` | `/api/github-trending/stats` | 管理首页统计数据 |
| `GET` | `/api/github-trending/settings` | 当前设置和下一次执行时间 |
| `PUT` | `/api/github-trending/settings` | 更新 `scheduleTime`、`readmeDelayMinSeconds`、`readmeDelayMaxSeconds` |
| `POST` | `/api/github-trending/jobs` | 创建手动采集任务 |
| `GET` | `/api/github-trending/jobs` | 查询最近任务 |
| `GET` | `/api/github-trending/snapshots?date=YYYY-MM-DD` | 查询每日快照（`includeReadme=0` 返回摘要） |
| `GET` | `/api/github-trending/snapshots/{date}/{owner}/{repository}` | 查询单个仓库的完整快照和 README 原文 |

## 配置项

| 环境变量 | 作用 | 默认值 |
| --- | --- | --- |
| `GITHUB_TRENDING_HOST` | 服务监听地址 | `127.0.0.1` |
| `GITHUB_TRENDING_PORT` | 服务监听端口 | `8011` |
| `GITHUB_TRENDING_API_TOKEN` | 管理 API Token | 开发占位符 |
| `GITHUB_TRENDING_EXTENSION_TOKEN` | 插件桥接 Token | 开发占位符 |
| `GITHUB_TRENDING_DB_PATH` | SQLite 数据库路径 | `tmp/github-trending.sqlite` |
| `GITHUB_TRENDING_SCHEDULE_TIME` | 每日 `HH:mm` 调度时间 | `09:00` |
| `GITHUB_TRENDING_README_DELAY_MIN_MS` | 初始最小间隔 | `2000` |
| `GITHUB_TRENDING_README_DELAY_MAX_MS` | 初始最大间隔 | `5000` |
| `GITHUB_TRENDING_ADMIN_ORIGINS` | 允许的本地管理页面来源 | `127.0.0.1:5174,localhost:5174` |

环境变量只用于初始化新数据库。管理页面保存的设置会在后续重启时继续生效。

## 开发检查

```powershell
npm test
npm run check
npm run admin:typecheck
npm run admin:build
```

GitHub 未认证 API 按 IP 限制请求频率。默认的串行策略和随机间隔可以降低突发请求，但反复手动执行仍可能触发限流；此类错误会按仓库保存。

请确保采集和后续数据处理符合 GitHub 服务条款及适用的数据使用要求。
