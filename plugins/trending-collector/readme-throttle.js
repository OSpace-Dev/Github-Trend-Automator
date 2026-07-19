(function exposeThrottle(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GithubReadmeThrottle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createThrottle() {
  const DEFAULT_MIN_MS = 2000;
  const DEFAULT_MAX_MS = 5000;
  const MAX_DELAY_MS = 60000;

  function normalizeDelayRange(minValue, maxValue) {
    const minMs = normalizeDelay(minValue, DEFAULT_MIN_MS);
    const maxMs = normalizeDelay(maxValue, DEFAULT_MAX_MS);
    return {
      minMs,
      maxMs: Math.max(minMs, maxMs)
    };
  }

  function chooseDelayMs(range, random = Math.random) {
    const span = range.maxMs - range.minMs;
    return range.minMs + Math.floor(Math.min(0.999999, Math.max(0, random())) * (span + 1));
  }

  function normalizeDelay(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(0, Math.min(MAX_DELAY_MS, Math.round(number)))
      : fallback;
  }

  return { chooseDelayMs, normalizeDelayRange };
});
