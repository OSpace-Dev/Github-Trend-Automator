const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TrendingStore } = require("../support/api/github-trending/store");

test("persists settings and reports snapshot/job statistics", () => {
  const databasePath = path.join(os.tmpdir(), `github-trending-store-${Date.now()}.sqlite`);
  const store = new TrendingStore(databasePath, {
    scheduleTime: "08:20",
    readmeDelayMinMs: 1000,
    readmeDelayMaxMs: 3000
  });
  try {
    assert.deepEqual(store.getSettings(), {
      scheduleTime: "08:20",
      readmeDelayMinMs: 1000,
      readmeDelayMaxMs: 3000
    });
    store.updateSettings({ scheduleTime: "10:40", readmeDelayMinMs: 2000, readmeDelayMaxMs: 5000 });
    assert.equal(store.getSettings().scheduleTime, "10:40");
    const job = store.createJob({ trendDate: "2026-07-19", triggerType: "manual" });
    store.completeJob(job.jobId, [{
      rank: 1,
      owner: "openai",
      repository: "codex",
      fullName: "openai/codex",
      url: "https://github.com/openai/codex",
      description: null,
      language: "Rust",
      totalStars: 1,
      totalForks: 2,
      starsToday: 3,
      readmeContent: "# Codex",
      readmeUrl: null,
      readmeError: null
    }], "2026-07-19T01:00:00.000Z");
    assert.deepEqual(store.getStats("2026-07-19"), {
      totalSnapshots: 1,
      uniqueRepositories: 1,
      trendDays: 1,
      todaySnapshots: 1,
      totalJobs: 1,
      failedJobs: 0,
      latestTrendDate: "2026-07-19"
    });
    assert.equal(store.listSnapshots({ trendDate: "2026-07-19", includeReadme: false })[0].hasReadme, 1);
    assert.equal(store.getSnapshot("2026-07-19", "openai/codex").readmeContent, "# Codex");
    assert.equal(store.getSnapshot("2026-07-19", "missing/repository"), null);
  } finally {
    store.close();
    for (const candidate of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      fs.rmSync(candidate, { force: true });
    }
  }
});
