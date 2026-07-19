# GitHub Trend Automator

[English](README.md) | [简体中文](README.zh-CN.md)

GitHub Trend Automator collects GitHub Daily Trending through a Manifest V3 browser extension, enriches repositories with public README data, and stores daily SQLite snapshots. A local Node.js service schedules jobs, dispatches them over SSE, and provides a compact Vue operations console.

## Components

```text
plugins/trending-collector/                 Manifest V3 extension and side panel
support/api/github-trending/                Node.js API, scheduler, SSE bridge, SQLite store
support/admin/github-trending-admin/        Vue 3 management page
tests/                                       Node.js regression tests
```

## Requirements

- Node.js 22 or later (uses `node:sqlite`)
- Chrome or Edge 116 or later
- Network access to `github.com` and `api.github.com`

The collector uses public GitHub pages and the public README API. It does not store a GitHub password, cookie, Personal Access Token, or SSH private key.

## Running the Project

The commands below use Windows PowerShell and are run from the repository root: the `github-trend-automator` directory containing `package.json`, `plugins/`, and `support/`.

### 1. Run the Backend in a Terminal

Working directory: repository root.

```powershell
npm start
```

The service listens on `http://127.0.0.1:8011`. Keep this terminal running.

### 2. Debug the Backend

Working directory: repository root. This enables Node Inspector at `127.0.0.1:9229`.

```powershell
npm run start:debug
```

Attach Chrome DevTools or the VS Code Node.js debugger to port `9229`.

### 3. Install Management Page Dependencies

Run this after the first checkout or when `package-lock.json` changes. Working directory: repository root.

```powershell
npm --prefix support/admin/github-trending-admin install
```

### 4. Run the Management Page in Development Mode

Open another PowerShell terminal. Working directory: repository root.

```powershell
npm run admin:dev
```

Open `http://127.0.0.1:5174`. Vite reloads the page when source files change.

### 5. Build and Preview the Management Page

Working directory: repository root.

```powershell
npm run admin:build
npm run admin:preview
```

The production build is written to `support/admin/github-trending-admin/dist/`. The preview URL is `http://127.0.0.1:4174`.

### 6. Load the Browser Extension

1. Keep the backend service running.
2. Open `chrome://extensions/` or `edge://extensions/`.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the `plugins/trending-collector/` directory under the repository root.

The management page stores only the local API origin and API token in browser `localStorage`; the default values are development placeholders.

## Collection and Scheduling

README requests run serially. Between requests the extension waits a random delay between the configured minimum and maximum (defaults: 2–5 seconds). This keeps a single job from issuing a burst of requests. A README failure is recorded on that repository and does not discard the Trending snapshot.

The daily schedule uses `HH:mm` in fixed `Asia/Shanghai` time and defaults to `09:00`. The management page can update both the schedule and the README delay range; the next run is recalculated immediately.

## API

All `/api/` endpoints require `Authorization: Bearer <GITHUB_TRENDING_API_TOKEN>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service, extension, queue, schedule, and settings state |
| `GET` | `/api/github-trending/stats` | Dashboard statistics |
| `GET` | `/api/github-trending/settings` | Current settings and next run |
| `PUT` | `/api/github-trending/settings` | Update `scheduleTime`, `readmeDelayMinSeconds`, and `readmeDelayMaxSeconds` |
| `POST` | `/api/github-trending/jobs` | Queue a manual collection job |
| `GET` | `/api/github-trending/jobs` | List recent jobs |
| `GET` | `/api/github-trending/snapshots?date=YYYY-MM-DD` | Read a daily snapshot (`includeReadme=0` returns summaries) |
| `GET` | `/api/github-trending/snapshots/{date}/{owner}/{repository}` | Read one complete snapshot and its README source |

## Configuration

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `GITHUB_TRENDING_HOST` | Service listening address | `127.0.0.1` |
| `GITHUB_TRENDING_PORT` | Service listening port | `8011` |
| `GITHUB_TRENDING_API_TOKEN` | Management API token | Development placeholder |
| `GITHUB_TRENDING_EXTENSION_TOKEN` | Extension bridge token | Development placeholder |
| `GITHUB_TRENDING_DB_PATH` | SQLite database path | `tmp/github-trending.sqlite` |
| `GITHUB_TRENDING_SCHEDULE_TIME` | Daily `HH:mm` schedule | `09:00` |
| `GITHUB_TRENDING_README_DELAY_MIN_MS` | Initial minimum delay | `2000` |
| `GITHUB_TRENDING_README_DELAY_MAX_MS` | Initial maximum delay | `5000` |
| `GITHUB_TRENDING_ADMIN_ORIGINS` | Allowed local admin origins | `127.0.0.1:5174,localhost:5174` |

Environment values initialize a new database only. Settings saved by the management page remain authoritative on later restarts.

## Development Checks

```powershell
npm test
npm run check
npm run admin:typecheck
npm run admin:build
```

The unauthenticated GitHub API has a per-IP rate limit. The default delay and serial README strategy reduce burst traffic, but repeated manual runs can still be rate-limited. Such errors are stored per repository.

Use only in ways that comply with GitHub's Terms of Service and applicable data-use requirements.
