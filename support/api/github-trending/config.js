const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  repoRoot,
  host: process.env.GITHUB_TRENDING_HOST || "127.0.0.1",
  port: readNumber("GITHUB_TRENDING_PORT", 8011),
  apiToken: process.env.GITHUB_TRENDING_API_TOKEN || "dev-github-trending-api-token",
  extensionToken: process.env.GITHUB_TRENDING_EXTENSION_TOKEN || "dev-github-trending-extension-token",
  databasePath: process.env.GITHUB_TRENDING_DB_PATH
    || path.join(repoRoot, "tmp", "github-trending.sqlite"),
  scheduleHour: readNumber("GITHUB_TRENDING_SCHEDULE_HOUR", 9),
  scheduleTimeZone: "Asia/Shanghai",
  maxRequestBytes: readNumber("GITHUB_TRENDING_MAX_REQUEST_BYTES", 20 * 1024 * 1024)
};
