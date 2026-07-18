const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../support/api/github-trending/server");

test("stores a completed daily Trending snapshot", async () => {
  const databasePath = path.join(os.tmpdir(), `github-trending-server-${Date.now()}.sqlite`);
  const scheduler = {
    async start() {},
    stop() {},
    getState() {
      return { hour: 9, timeZone: "Asia/Shanghai", nextRunAt: "2026-07-19T01:00:00.000Z" };
    }
  };
  const app = createApp({
    host: "127.0.0.1",
    port: 0,
    databasePath,
    scheduler,
    apiToken: "api-test-token",
    extensionToken: "extension-test-token"
  });
  const address = await app.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const eventPromise = readSseEvent(
      `${baseUrl}/extension/events?token=extension-test-token`,
      "collect_trending"
    );
    const createResponse = await fetch(`${baseUrl}/extension/jobs`, {
      method: "POST",
      headers: extensionHeaders(),
      body: "{}"
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    const jobId = created.job.jobId;
    const collectEvent = await eventPromise;
    assert.equal(collectEvent.data.jobId, jobId);
    assert.equal(collectEvent.data.url, "https://github.com/trending?since=daily");

    const statusResponse = await fetch(`${baseUrl}/extension/jobs/${jobId}/status`, {
      method: "POST",
      headers: extensionHeaders(),
      body: JSON.stringify({ status: "collecting" })
    });
    assert.equal(statusResponse.status, 200);

    const resultResponse = await fetch(`${baseUrl}/extension/jobs/${jobId}/result`, {
      method: "POST",
      headers: extensionHeaders(),
      body: JSON.stringify({
        status: "completed",
        items: [
          {
            rank: 1,
            owner: "openai",
            repository: "codex",
            url: "https://github.com/openai/codex",
            description: "Coding agent",
            language: "Rust",
            totalStars: 50000,
            totalForks: 5000,
            starsToday: 1200,
            readmeContent: "# Codex",
            readmeUrl: "https://github.com/openai/codex#readme"
          }
        ]
      })
    });
    assert.equal(resultResponse.status, 200);

    const snapshotsResponse = await fetch(`${baseUrl}/api/github-trending/snapshots`, {
      headers: { Authorization: "Bearer api-test-token" }
    });
    assert.equal(snapshotsResponse.status, 200);
    const snapshots = await snapshotsResponse.json();
    assert.equal(snapshots.items.length, 1);
    assert.equal(snapshots.items[0].fullName, "openai/codex");
    assert.equal(snapshots.items[0].readmeContent, "# Codex");

    const jobResponse = await fetch(`${baseUrl}/api/github-trending/jobs/${jobId}`, {
      headers: { Authorization: "Bearer api-test-token" }
    });
    const completedJob = await jobResponse.json();
    assert.equal(completedJob.job.status, "completed");
    assert.equal(completedJob.job.itemCount, 1);
    await collectEvent.reader.cancel();
  } finally {
    await app.close();
    removeDatabase(databasePath);
  }
});

function extensionHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer extension-test-token"
  };
}

async function readSseEvent(url, expectedEvent) {
  const response = await fetch(url, { headers: { Accept: "text/event-stream" } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error(`SSE ended before ${expectedEvent}`);
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (eventLine?.slice(7) === expectedEvent && dataLine) {
        return { reader, data: JSON.parse(dataLine.slice(6)) };
      }
    }
  }
}

function removeDatabase(databasePath) {
  for (const candidate of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    fs.rmSync(candidate, { force: true });
  }
}
