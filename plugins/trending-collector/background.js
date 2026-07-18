const DEFAULT_BRIDGE_CONFIG = {
  serverOrigin: "http://127.0.0.1:8011",
  extensionToken: "dev-github-trending-extension-token"
};

const DEFAULT_COLLECTOR_STATE = {
  connected: false,
  clientId: null,
  phase: "idle",
  message: "Waiting for the local service",
  activeJobId: null,
  trendDate: null,
  itemCount: 0,
  readmeCount: 0,
  nextRunAt: null,
  lastCompletedAt: null,
  lastItems: [],
  error: null
};

const CONFIG_KEY = "bridgeConfig";
const STATE_KEY = "collectorState";
const ACTIVE_JOB_KEY = "activeJob";

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => updateCollectorState({ error: error.message }));
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch((error) => updateCollectorState({ error: error.message }));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !isHandledMessage(message.type)) {
    return false;
  }
  (async () => {
    try {
      let response;
      switch (message.type) {
        case "GITHUB_TRENDING_OFFSCREEN_READY":
          await connectOffscreen();
          response = { ok: true };
          break;
        case "GITHUB_TRENDING_BRIDGE_STATE":
          await handleBridgeState(message);
          response = { ok: true };
          break;
        case "GITHUB_TRENDING_COLLECT_JOB":
          await startCollectionJob(message.job);
          response = { ok: true };
          break;
        case "GITHUB_TRENDING_CONTENT_READY":
          await handleTrendingTabReady(sender.tab?.id);
          response = { ok: true };
          break;
        case "GITHUB_TRENDING_GET_STATE":
          response = await getPublicState();
          break;
        case "GITHUB_TRENDING_SAVE_CONFIG":
          response = await saveBridgeConfig(message.config);
          break;
        case "GITHUB_TRENDING_MANUAL_COLLECT":
          response = await createManualJob();
          break;
        default:
          response = { ok: false, error: "unsupported_message" };
      }
      sendResponse(response);
    } catch (error) {
      await updateCollectorState({ error: error.message || String(error) }).catch(() => {});
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }
  handleTrendingTabReady(tabId).catch((error) => {
    updateCollectorState({ error: error.message || String(error) }).catch(() => {});
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const { activeJob } = await chrome.storage.local.get(ACTIVE_JOB_KEY);
    if (activeJob?.tabId === tabId && !["completed", "failed"].includes(activeJob.phase)) {
      await failJob(activeJob, "managed_tab_closed");
    }
  })().catch(() => {});
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error("[github-trending] side panel setup failed", error);
});

initializeExtension().catch((error) => {
  updateCollectorState({ error: error.message || String(error) }).catch(() => {});
});

function isHandledMessage(type) {
  return new Set([
    "GITHUB_TRENDING_OFFSCREEN_READY",
    "GITHUB_TRENDING_BRIDGE_STATE",
    "GITHUB_TRENDING_COLLECT_JOB",
    "GITHUB_TRENDING_CONTENT_READY",
    "GITHUB_TRENDING_GET_STATE",
    "GITHUB_TRENDING_SAVE_CONFIG",
    "GITHUB_TRENDING_MANUAL_COLLECT"
  ]).has(type);
}

async function initializeExtension() {
  const stored = await chrome.storage.local.get([CONFIG_KEY, STATE_KEY]);
  const writes = {};
  if (!stored[CONFIG_KEY]) {
    writes[CONFIG_KEY] = DEFAULT_BRIDGE_CONFIG;
  }
  if (!stored[STATE_KEY]) {
    writes[STATE_KEY] = DEFAULT_COLLECTOR_STATE;
  }
  if (Object.keys(writes).length > 0) {
    await chrome.storage.local.set(writes);
  }
  await ensureOffscreenDocument();
  await connectOffscreen();
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    })
    : [];
  if (contexts.length > 0) {
    return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Maintain the local SSE bridge and fetch public repository README files."
    });
  } catch (error) {
    if (!String(error.message || error).includes("Only a single offscreen document")) {
      throw error;
    }
  }
}

async function connectOffscreen() {
  const { bridgeConfig = DEFAULT_BRIDGE_CONFIG } = await chrome.storage.local.get(CONFIG_KEY);
  try {
    return await chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_OFFSCREEN_CONNECT",
      config: bridgeConfig
    });
  } catch (error) {
    if (!String(error.message || error).includes("Receiving end does not exist")) {
      throw error;
    }
    return { ok: false, error: "offscreen_not_ready" };
  }
}

async function handleBridgeState(message) {
  await updateCollectorState({
    connected: Boolean(message.connected),
    clientId: message.clientId || null,
    nextRunAt: message.schedule?.nextRunAt || null,
    message: message.connected ? "Connected to local service" : "Local service disconnected",
    error: message.connected ? null : message.error || "bridge_disconnected"
  });
}

async function startCollectionJob(job) {
  if (!job?.jobId || !job?.trendDate) {
    throw new Error("invalid_job");
  }
  const { activeJob } = await chrome.storage.local.get(ACTIVE_JOB_KEY);
  if (activeJob?.jobId && activeJob.jobId !== job.jobId) {
    await postResult(job.jobId, { status: "failed", error: "extension_busy" });
    return;
  }
  if (activeJob?.jobId === job.jobId) {
    if (activeJob.tabId) {
      await handleTrendingTabReady(activeJob.tabId);
    }
    return;
  }

  const nextActiveJob = {
    jobId: job.jobId,
    trendDate: job.trendDate,
    url: job.url || "https://github.com/trending?since=daily",
    tabId: null,
    phase: "opening",
    startedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: nextActiveJob });
  await updateCollectorState({
    phase: "opening",
    message: "Opening GitHub Trending",
    activeJobId: job.jobId,
    trendDate: job.trendDate,
    itemCount: 0,
    readmeCount: 0,
    error: null
  });

  try {
    const tab = await chrome.tabs.create({ url: nextActiveJob.url, active: false });
    nextActiveJob.tabId = tab.id;
    await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: nextActiveJob });
  } catch (error) {
    await failJob(nextActiveJob, error.message || "tab_create_failed");
  }
}

async function handleTrendingTabReady(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  const { activeJob } = await chrome.storage.local.get(ACTIVE_JOB_KEY);
  if (!activeJob || activeJob.tabId !== tabId || activeJob.phase !== "opening") {
    return;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !tab.url.startsWith("https://github.com/trending")) {
    return;
  }

  activeJob.phase = "collecting";
  await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: activeJob });
  await updateCollectorState({ phase: "collecting", message: "Reading the daily Trending list" });
  await postStatus(activeJob.jobId, "collecting");

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GITHUB_TRENDING_COLLECT" });
    if (!response?.ok || !Array.isArray(response.items) || response.items.length === 0) {
      throw new Error(response?.error || "empty_trending_result");
    }
    activeJob.phase = "enriching";
    await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: activeJob });
    await updateCollectorState({
      phase: "enriching",
      message: "Fetching repository README files",
      itemCount: response.items.length
    });
    const enrichedResponse = await chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_ENRICH_READMES",
      items: response.items
    });
    if (!enrichedResponse?.ok || !Array.isArray(enrichedResponse.items)) {
      throw new Error(enrichedResponse?.error || "readme_enrichment_failed");
    }
    await completeJob(activeJob, enrichedResponse.items);
  } catch (error) {
    await failJob(activeJob, error.message || String(error));
  }
}

async function completeJob(activeJob, items) {
  await postResult(activeJob.jobId, { status: "completed", items });
  const completedAt = new Date().toISOString();
  const readmeCount = items.filter((item) => item.readmeContent).length;
  await updateCollectorState({
    phase: "completed",
    message: `Saved ${items.length} repositories`,
    activeJobId: null,
    itemCount: items.length,
    readmeCount,
    lastCompletedAt: completedAt,
    lastItems: items.slice(0, 30).map(stripReadmeContent),
    error: null
  });
  await chrome.storage.local.remove(ACTIVE_JOB_KEY);
  await safeCloseTab(activeJob.tabId);
}

async function failJob(activeJob, error) {
  if (activeJob?.jobId) {
    await postResult(activeJob.jobId, { status: "failed", error }).catch(() => {});
  }
  await updateCollectorState({
    phase: "failed",
    message: "Collection failed",
    activeJobId: null,
    error
  });
  await chrome.storage.local.remove(ACTIVE_JOB_KEY);
  await safeCloseTab(activeJob?.tabId);
}

async function safeCloseTab(tabId) {
  if (Number.isInteger(tabId)) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function postStatus(jobId, status) {
  const config = await getBridgeConfig();
  return fetchJson(new URL(`/extension/jobs/${encodeURIComponent(jobId)}/status`, config.serverOrigin), {
    method: "POST",
    headers: bridgeHeaders(config),
    body: JSON.stringify({ status })
  });
}

async function postResult(jobId, result) {
  const config = await getBridgeConfig();
  return fetchJson(new URL(`/extension/jobs/${encodeURIComponent(jobId)}/result`, config.serverOrigin), {
    method: "POST",
    headers: bridgeHeaders(config),
    body: JSON.stringify(result)
  });
}

async function createManualJob() {
  const config = await getBridgeConfig();
  const response = await fetchJson(new URL("/extension/jobs", config.serverOrigin), {
    method: "POST",
    headers: bridgeHeaders(config),
    body: "{}"
  });
  await updateCollectorState({ message: "Manual collection queued", error: null });
  return response;
}

async function saveBridgeConfig(value) {
  const serverOrigin = String(value?.serverOrigin || "").trim().replace(/\/$/, "");
  const extensionToken = String(value?.extensionToken || "").trim();
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(serverOrigin)) {
    throw new Error("invalid_local_server_origin");
  }
  if (!extensionToken) {
    throw new Error("extension_token_required");
  }
  const config = { serverOrigin, extensionToken };
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  await updateCollectorState({ connected: false, message: "Reconnecting", error: null });
  await ensureOffscreenDocument();
  await connectOffscreen();
  return { ok: true, config };
}

async function getPublicState() {
  const stored = await chrome.storage.local.get([CONFIG_KEY, STATE_KEY]);
  return {
    ok: true,
    config: stored[CONFIG_KEY] || DEFAULT_BRIDGE_CONFIG,
    state: stored[STATE_KEY] || DEFAULT_COLLECTOR_STATE
  };
}

async function getBridgeConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return stored[CONFIG_KEY] || DEFAULT_BRIDGE_CONFIG;
}

async function updateCollectorState(patch) {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = { ...DEFAULT_COLLECTOR_STATE, ...(stored[STATE_KEY] || {}), ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

function bridgeHeaders(config) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.extensionToken}`
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `http_${response.status}`);
  }
  return payload;
}

function stripReadmeContent(item) {
  const { readmeContent, ...summary } = item;
  return summary;
}
