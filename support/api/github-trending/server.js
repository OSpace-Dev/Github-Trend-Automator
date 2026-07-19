const http = require("node:http");
const { randomUUID } = require("node:crypto");
const config = require("./config");
const logger = require("./logger");
const { DailyScheduler, getShanghaiDateKey } = require("./scheduler");
const { TrendingStore } = require("./store");

function createApp(options = {}) {
  const appConfig = {
    ...config,
    ...options
  };
  const store = options.store || new TrendingStore(appConfig.databasePath, {
    scheduleTime: appConfig.defaultScheduleTime,
    readmeDelayMinMs: appConfig.defaultReadmeDelayMinMs,
    readmeDelayMaxMs: appConfig.defaultReadmeDelayMaxMs
  });
  const initialSettings = store.getSettings();
  const clients = new Map();
  const assignments = new Map();
  let dispatching = false;

  const scheduler = options.scheduler || new DailyScheduler({
    scheduleTime: initialSettings.scheduleTime,
    async onDue(trendDate, source) {
      const job = store.ensureScheduledJob(trendDate);
      logger.info("scheduled_job_ready", { jobId: job.jobId, trendDate, source, status: job.status });
      await dispatchQueuedJobs();
    }
  });

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const corsAllowed = applyCors(request, response, appConfig.adminOrigins);
      if (request.method === "OPTIONS") {
        return corsAllowed
          ? sendEmpty(response, 204)
          : sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
      }
      await route(request, response, requestUrl);
    } catch (error) {
      logger.error("request_failed", { method: request.method, url: request.url, error: error.message });
      if (!response.headersSent) {
        sendJson(response, error.statusCode || 500, {
          ok: false,
          error: error.publicCode || "internal_error"
        });
      } else {
        response.end();
      }
    }
  });

  async function route(request, response, requestUrl) {
    const pathname = requestUrl.pathname;

    if (request.method === "GET" && pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        extensionClients: clients.size,
        queuedJob: store.getNextQueuedJob(),
        schedule: scheduler.getState(),
        settings: store.getSettings()
      });
    }

    if (request.method === "GET" && pathname === "/extension/events") {
      requireExtensionAuth(request, requestUrl, appConfig.extensionToken);
      return connectExtension(request, response);
    }

    if (request.method === "POST" && pathname === "/extension/heartbeat") {
      requireBearer(request, appConfig.extensionToken, "unauthorized_extension");
      const body = await readJson(request, appConfig.maxRequestBytes);
      const client = body.clientId && clients.get(body.clientId);
      if (!client) {
        return sendJson(response, 404, { ok: false, error: "extension_client_not_found" });
      }
      return sendJson(response, 200, { ok: true, schedule: scheduler.getState() });
    }

    if (request.method === "POST" && pathname === "/extension/jobs") {
      requireBearer(request, appConfig.extensionToken, "unauthorized_extension");
      const job = store.createJob({
        trendDate: getShanghaiDateKey(),
        triggerType: "manual"
      });
      await dispatchQueuedJobs();
      return sendJson(response, 201, { ok: true, job });
    }

    const extensionStatusMatch = pathname.match(/^\/extension\/jobs\/([^/]+)\/status$/);
    if (request.method === "POST" && extensionStatusMatch) {
      requireBearer(request, appConfig.extensionToken, "unauthorized_extension");
      const jobId = decodeURIComponent(extensionStatusMatch[1]);
      const body = await readJson(request, appConfig.maxRequestBytes);
      if (body.status !== "collecting") {
        return sendJson(response, 400, { ok: false, error: "invalid_status" });
      }
      const job = store.markCollecting(jobId);
      if (!job) {
        return sendJson(response, 404, { ok: false, error: "job_not_found" });
      }
      return sendJson(response, 200, { ok: true, job });
    }

    const extensionResultMatch = pathname.match(/^\/extension\/jobs\/([^/]+)\/result$/);
    if (request.method === "POST" && extensionResultMatch) {
      requireBearer(request, appConfig.extensionToken, "unauthorized_extension");
      const jobId = decodeURIComponent(extensionResultMatch[1]);
      const existing = store.getJob(jobId);
      if (!existing) {
        return sendJson(response, 404, { ok: false, error: "job_not_found" });
      }
      const body = await readJson(request, appConfig.maxRequestBytes);
      let job;
      if (body.status === "failed") {
        job = store.markFailed(jobId, normalizeString(body.error, 1000) || "collection_failed");
      } else if (body.status === "completed") {
        const items = validateItems(body.items);
        job = store.completeJob(jobId, items, new Date().toISOString());
      } else {
        return sendJson(response, 400, { ok: false, error: "invalid_result_status" });
      }
      releaseAssignment(jobId);
      await dispatchQueuedJobs();
      return sendJson(response, 200, { ok: true, job });
    }

    if (pathname.startsWith("/api/")) {
      requireBearer(request, appConfig.apiToken, "unauthorized_api");
    }

    if (request.method === "GET" && pathname === "/api/github-trending/stats") {
      return sendJson(response, 200, {
        ok: true,
        stats: store.getStats(getShanghaiDateKey()),
        extensionClients: clients.size
      });
    }

    if (request.method === "GET" && pathname === "/api/github-trending/settings") {
      return sendJson(response, 200, {
        ok: true,
        settings: toPublicSettings(store.getSettings()),
        schedule: scheduler.getState()
      });
    }

    if (request.method === "PUT" && pathname === "/api/github-trending/settings") {
      const body = await readJson(request, appConfig.maxRequestBytes);
      const settings = validateSettings(body);
      const updated = store.updateSettings(settings);
      const schedule = typeof scheduler.reschedule === "function"
        ? scheduler.reschedule(updated.scheduleTime)
        : scheduler.getState();
      logger.info("settings_updated", { ...toPublicSettings(updated), nextRunAt: schedule.nextRunAt });
      return sendJson(response, 200, {
        ok: true,
        settings: toPublicSettings(updated),
        schedule
      });
    }

    if (request.method === "POST" && pathname === "/api/github-trending/jobs") {
      const job = store.createJob({
        trendDate: getShanghaiDateKey(),
        triggerType: "manual"
      });
      await dispatchQueuedJobs();
      return sendJson(response, 201, { ok: true, job });
    }

    if (request.method === "GET" && pathname === "/api/github-trending/jobs") {
      const limit = readLimit(requestUrl.searchParams.get("limit"), 50, 200);
      return sendJson(response, 200, { ok: true, jobs: store.listJobs(limit) });
    }

    const apiJobMatch = pathname.match(/^\/api\/github-trending\/jobs\/([^/]+)$/);
    if (request.method === "GET" && apiJobMatch) {
      const job = store.getJob(decodeURIComponent(apiJobMatch[1]));
      return job
        ? sendJson(response, 200, { ok: true, job })
        : sendJson(response, 404, { ok: false, error: "job_not_found" });
    }

    if (request.method === "GET" && pathname === "/api/github-trending/snapshots") {
      const trendDate = normalizeDate(requestUrl.searchParams.get("date"));
      const limit = readLimit(requestUrl.searchParams.get("limit"), 100, 200);
      const offset = readLimit(requestUrl.searchParams.get("offset"), 0, 100000);
      const includeReadme = requestUrl.searchParams.get("includeReadme") !== "0";
      const items = store.listSnapshots({ trendDate, limit, offset, includeReadme });
      return sendJson(response, 200, { ok: true, items });
    }

    const snapshotDetailMatch = pathname.match(/^\/api\/github-trending\/snapshots\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (request.method === "GET" && snapshotDetailMatch) {
      const trendDate = normalizeDate(decodeURIComponent(snapshotDetailMatch[1]));
      const owner = normalizeRequiredString(decodeURIComponent(snapshotDetailMatch[2]), 200, "invalid_owner");
      const repository = normalizeRequiredString(decodeURIComponent(snapshotDetailMatch[3]), 200, "invalid_repository");
      const item = store.getSnapshot(trendDate, `${owner}/${repository}`);
      return item
        ? sendJson(response, 200, { ok: true, item })
        : sendJson(response, 404, { ok: false, error: "snapshot_not_found" });
    }

    return sendJson(response, 404, { ok: false, error: "not_found" });
  }

  function connectExtension(request, response) {
    const clientId = randomUUID();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders?.();
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25000);
    heartbeat.unref?.();
    clients.set(clientId, { clientId, response, heartbeat });
    sendSse(response, "bridge_ready", {
      clientId,
      schedule: scheduler.getState()
    });
    logger.info("extension_connected", { clientId, clients: clients.size });

    request.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(clientId);
      const jobId = assignments.get(clientId);
      assignments.delete(clientId);
      if (jobId) {
        store.requeueJob(jobId, "extension_disconnected");
      }
      logger.warn("extension_disconnected", { clientId, jobId: jobId || null, clients: clients.size });
      dispatchQueuedJobs().catch((error) => logger.error("redispatch_failed", { error: error.message }));
    });
    dispatchQueuedJobs().catch((error) => logger.error("dispatch_failed", { error: error.message }));
  }

  async function dispatchQueuedJobs() {
    if (dispatching) {
      return;
    }
    dispatching = true;
    try {
      while (true) {
        const availableClient = Array.from(clients.values())
          .find((client) => !assignments.has(client.clientId));
        const job = store.getNextQueuedJob();
        if (!availableClient || !job) {
          return;
        }
        store.markDispatched(job.jobId);
        assignments.set(availableClient.clientId, job.jobId);
        const settings = store.getSettings();
        sendSse(availableClient.response, "collect_trending", {
          jobId: job.jobId,
          trendDate: job.trendDate,
          url: "https://github.com/trending?since=daily",
          readmeDelayMinMs: settings.readmeDelayMinMs,
          readmeDelayMaxMs: settings.readmeDelayMaxMs
        });
        logger.info("job_dispatched", {
          jobId: job.jobId,
          clientId: availableClient.clientId,
          trendDate: job.trendDate
        });
      }
    } finally {
      dispatching = false;
    }
  }

  function releaseAssignment(jobId) {
    for (const [clientId, assignedJobId] of assignments.entries()) {
      if (assignedJobId === jobId) {
        assignments.delete(clientId);
        return;
      }
    }
  }

  return {
    config: appConfig,
    server,
    store,
    scheduler,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(appConfig.port, appConfig.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      await scheduler.start();
      const address = server.address();
      logger.info("server_listening", { host: appConfig.host, port: address.port });
      return address;
    },
    async close() {
      scheduler.stop();
      for (const client of clients.values()) {
        clearInterval(client.heartbeat);
        client.response.end();
      }
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
      if (!options.store) {
        store.close();
      }
    }
  };
}

function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("invalid_settings");
  }
  const scheduleTime = String(value.scheduleTime || "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) {
    throw badRequest("invalid_schedule_time");
  }
  const minSeconds = Number(value.readmeDelayMinSeconds);
  const maxSeconds = Number(value.readmeDelayMaxSeconds);
  if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds)
    || minSeconds < 0 || maxSeconds < minSeconds || maxSeconds > 60) {
    throw badRequest("invalid_readme_delay_range");
  }
  return {
    scheduleTime,
    readmeDelayMinMs: Math.round(minSeconds * 1000),
    readmeDelayMaxMs: Math.round(maxSeconds * 1000)
  };
}

function toPublicSettings(settings) {
  return {
    scheduleTime: settings.scheduleTime,
    timeZone: "Asia/Shanghai",
    readmeDelayMinSeconds: settings.readmeDelayMinMs / 1000,
    readmeDelayMaxSeconds: settings.readmeDelayMaxMs / 1000
  };
}

function applyCors(request, response, allowedOrigins = []) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (!allowedOrigins.includes(origin)) {
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function validateItems(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw badRequest("invalid_items");
  }
  const seen = new Set();
  return value.map((item, index) => {
    const owner = normalizeRequiredString(item.owner, 200, "invalid_owner");
    const repository = normalizeRequiredString(item.repository, 200, "invalid_repository");
    const fullName = `${owner}/${repository}`;
    if (seen.has(fullName.toLowerCase())) {
      throw badRequest("duplicate_repository");
    }
    seen.add(fullName.toLowerCase());
    const url = normalizeRequiredString(item.url, 1000, "invalid_url");
    if (url !== `https://github.com/${fullName}`) {
      throw badRequest("invalid_url");
    }
    return {
      rank: normalizeInteger(item.rank, index + 1, 1, 100),
      owner,
      repository,
      fullName,
      description: normalizeString(item.description, 5000),
      url,
      language: normalizeString(item.language, 200),
      totalStars: normalizeNullableInteger(item.totalStars),
      totalForks: normalizeNullableInteger(item.totalForks),
      starsToday: normalizeNullableInteger(item.starsToday),
      readmeContent: normalizeString(item.readmeContent, 2 * 1024 * 1024),
      readmeUrl: normalizeString(item.readmeUrl, 2000),
      readmeError: normalizeString(item.readmeError, 1000)
    };
  });
}

function normalizeString(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeRequiredString(value, maxLength, code) {
  const normalized = normalizeString(value, maxLength);
  if (!normalized) {
    throw badRequest(code);
  }
  return normalized;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest("invalid_date");
  }
  return value;
}

function readLimit(value, fallback, max) {
  if (value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw badRequest("invalid_pagination");
  }
  return Math.min(number, max);
}

async function readJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      error.publicCode = "payload_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("invalid_json");
  }
}

function requireExtensionAuth(request, requestUrl, token) {
  if (requestUrl.searchParams.get("token") === token) {
    return;
  }
  requireBearer(request, token, "unauthorized_extension");
}

function requireBearer(request, token, code) {
  if ((request.headers.authorization || "") !== `Bearer ${token}`) {
    const error = new Error(code);
    error.statusCode = 401;
    error.publicCode = code;
    throw error;
  }
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  error.publicCode = code;
  return error;
}

function sendSse(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendEmpty(response, statusCode) {
  response.writeHead(statusCode, { "Content-Length": "0" });
  response.end();
}

if (require.main === module) {
  const app = createApp();
  app.listen().catch((error) => {
    logger.error("startup_failed", { error: error.message });
    process.exitCode = 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

module.exports = { createApp, validateItems, validateSettings };
