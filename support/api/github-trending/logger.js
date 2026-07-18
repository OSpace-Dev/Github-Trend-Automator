const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = normalizeLevel(process.env.GITHUB_TRENDING_LOG_LEVEL || "info");

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : "info";
}

function write(level, event, details = {}) {
  if (LEVELS[level] < LEVELS[configuredLevel]) {
    return;
  }

  const entry = {
    time: new Date().toISOString(),
    level,
    service: "github-trending-api",
    event,
    ...details
  };
  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

module.exports = {
  debug: (event, details) => write("debug", event, details),
  info: (event, details) => write("info", event, details),
  warn: (event, details) => write("warn", event, details),
  error: (event, details) => write("error", event, details)
};
