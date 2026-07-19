const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readScheduleTime() {
  const explicit = process.env.GITHUB_TRENDING_SCHEDULE_TIME;
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(explicit || "")) {
    return explicit;
  }
  const legacyHour = readNumber("GITHUB_TRENDING_SCHEDULE_HOUR", 9);
  const hour = Math.max(0, Math.min(23, Math.trunc(legacyHour)));
  return `${String(hour).padStart(2, "0")}:00`;
}

module.exports = {
  repoRoot,
  host: process.env.GITHUB_TRENDING_HOST || "127.0.0.1",
  port: readNumber("GITHUB_TRENDING_PORT", 8011),
  apiToken: process.env.GITHUB_TRENDING_API_TOKEN || "dev-github-trending-api-token",
  extensionToken: process.env.GITHUB_TRENDING_EXTENSION_TOKEN || "dev-github-trending-extension-token",
  databasePath: process.env.GITHUB_TRENDING_DB_PATH
    || path.join(repoRoot, "tmp", "github-trending.sqlite"),
  defaultScheduleTime: readScheduleTime(),
  defaultReadmeDelayMinMs: readNumber("GITHUB_TRENDING_README_DELAY_MIN_MS", 2000),
  defaultReadmeDelayMaxMs: readNumber("GITHUB_TRENDING_README_DELAY_MAX_MS", 5000),
  scheduleTimeZone: "Asia/Shanghai",
  adminOrigins: (process.env.GITHUB_TRENDING_ADMIN_ORIGINS
    || "http://127.0.0.1:5174,http://localhost:5174")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  maxRequestBytes: readNumber("GITHUB_TRENDING_MAX_REQUEST_BYTES", 20 * 1024 * 1024)
};
