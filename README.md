# GitHub Trend Automator

English | [简体中文](README.zh-CN.md)

GitHub Trend Automator collects the public GitHub Daily Trending list through a Chrome/Edge extension and stores one SQLite snapshot per day. The local Node.js service creates the daily job at 09:00 Asia/Shanghai, dispatches it to the connected extension over SSE, and persists the returned repository metadata and README source.

## Components

```text
.
├─ plugins/
│  └─ trending-collector/       # Manifest V3 extension and side panel
├─ support/
│  └─ api/
│     └─ github-trending/       # Scheduler, HTTP API, SSE bridge, SQLite store
└─ tests/                       # Scheduler and API integration tests
```

## Collected Data

Each daily snapshot includes:

- Trending rank and date
- Repository owner, name, description, and URL
- Primary language
- Total stars and forks
- Stars gained today
- README source and README fetch status
- Collection timestamp and job ID

Snapshots use `trend date + repository` as their unique key. Re-running a job on the same day updates that day's snapshot instead of creating a duplicate.

## Requirements

- Node.js 22 or later with `node:sqlite`
- Chrome or Edge 116 or later
- Network access to `github.com` and `api.github.com`

The Trending page and README endpoint are public. No GitHub password, cookie, Personal Access Token, or SSH private key is stored by this project.

## Quick Start

### 1. Start the Local Service

```powershell
npm start
```

The default service URL is `http://127.0.0.1:8011`. On startup after 09:00 Asia/Shanghai, the service creates today's missing scheduled job as a catch-up task.

### 2. Load the Extension

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose `plugins/trending-collector/`.
5. Click the extension icon to open the side panel.

The extension connects to the local service automatically. Use **Collect Daily Trending Now** in the side panel for a manual run.

## Configuration

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `GITHUB_TRENDING_HOST` | Service listening address | `127.0.0.1` |
| `GITHUB_TRENDING_PORT` | Service listening port | `8011` |
| `GITHUB_TRENDING_API_TOKEN` | Query API token | Development placeholder |
| `GITHUB_TRENDING_EXTENSION_TOKEN` | Extension bridge token | Development placeholder |
| `GITHUB_TRENDING_DB_PATH` | SQLite database path | `tmp/github-trending.sqlite` |
| `GITHUB_TRENDING_SCHEDULE_HOUR` | Daily hour in Asia/Shanghai | `9` |
| `GITHUB_TRENDING_LOG_LEVEL` | Log level | `info` |

The built-in tokens are for local development only. Replace both tokens before listening beyond localhost, and update the extension connection settings to match.

## API

All `/api/` endpoints require:

```text
Authorization: Bearer <GITHUB_TRENDING_API_TOKEN>
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service, extension, queue, and schedule state |
| `POST` | `/api/github-trending/jobs` | Queue a manual collection job |
| `GET` | `/api/github-trending/jobs` | List recent jobs |
| `GET` | `/api/github-trending/jobs/{jobId}` | Read one job |
| `GET` | `/api/github-trending/snapshots?date=YYYY-MM-DD` | Read a daily snapshot |

## Development

```powershell
npm test
npm run check
```

The public GitHub API allows 60 unauthenticated requests per hour per IP. A normal Daily Trending page contains fewer repositories than this limit, but repeated manual runs may cause README requests to return rate-limit errors. Those errors are stored per repository and do not prevent the Trending snapshot from being saved.

## Usage Notes

- The collector reads the public `https://github.com/trending` page with `since=daily`.
- The extension opens a managed background tab for each job and closes it when collection finishes.
- Users are responsible for ensuring that collection and downstream processing comply with GitHub's Terms of Service and applicable data-use requirements.
