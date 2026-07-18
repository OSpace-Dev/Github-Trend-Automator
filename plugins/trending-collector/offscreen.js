const bridgeState = {
  config: null,
  eventSource: null,
  reconnectTimer: null,
  heartbeatTimer: null,
  clientId: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }
  if (message.type === "GITHUB_TRENDING_OFFSCREEN_CONNECT") {
    (async () => {
      bridgeState.config = message.config;
      await connectBridge();
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "GITHUB_TRENDING_ENRICH_READMES") {
    (async () => {
      try {
        const items = await enrichReadmes(message.items || []);
        sendResponse({ ok: true, items });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  return false;
});

chrome.runtime.sendMessage({ type: "GITHUB_TRENDING_OFFSCREEN_READY" }).catch(() => {});

async function connectBridge() {
  closeConnection();
  if (!bridgeState.config?.serverOrigin || !bridgeState.config?.extensionToken) {
    throw new Error("bridge_config_missing");
  }
  const eventsUrl = new URL("/extension/events", bridgeState.config.serverOrigin);
  eventsUrl.searchParams.set("token", bridgeState.config.extensionToken);
  const source = new EventSource(eventsUrl);
  bridgeState.eventSource = source;

  source.addEventListener("bridge_ready", (event) => {
    const payload = parseEvent(event);
    bridgeState.clientId = payload.clientId || null;
    startHeartbeat();
    chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_BRIDGE_STATE",
      connected: true,
      clientId: bridgeState.clientId,
      schedule: payload.schedule || null
    }).catch(() => {});
  });

  source.addEventListener("collect_trending", (event) => {
    chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_COLLECT_JOB",
      job: parseEvent(event)
    }).catch(() => {});
  });

  source.onerror = () => {
    chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_BRIDGE_STATE",
      connected: false,
      error: "bridge_disconnected"
    }).catch(() => {});
    scheduleReconnect();
  };
}

function parseEvent(event) {
  try {
    return JSON.parse(event.data || "{}");
  } catch {
    return {};
  }
}

function closeConnection() {
  if (bridgeState.eventSource) {
    bridgeState.eventSource.close();
    bridgeState.eventSource = null;
  }
  if (bridgeState.reconnectTimer) {
    clearTimeout(bridgeState.reconnectTimer);
    bridgeState.reconnectTimer = null;
  }
  if (bridgeState.heartbeatTimer) {
    clearInterval(bridgeState.heartbeatTimer);
    bridgeState.heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  if (bridgeState.reconnectTimer) {
    return;
  }
  bridgeState.reconnectTimer = setTimeout(() => {
    bridgeState.reconnectTimer = null;
    connectBridge().catch(() => scheduleReconnect());
  }, 5000);
}

function startHeartbeat() {
  if (bridgeState.heartbeatTimer) {
    clearInterval(bridgeState.heartbeatTimer);
  }
  bridgeState.heartbeatTimer = setInterval(async () => {
    if (!bridgeState.clientId || !bridgeState.config) {
      return;
    }
    try {
      await fetch(new URL("/extension/heartbeat", bridgeState.config.serverOrigin), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bridgeState.config.extensionToken}`
        },
        body: JSON.stringify({ clientId: bridgeState.clientId })
      });
    } catch {
      scheduleReconnect();
    }
  }, 20000);
}

async function enrichReadmes(items) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await enrichReadme(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

async function enrichReadme(item) {
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.repository)}/readme`;
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) {
      throw new Error(`readme_http_${response.status}`);
    }
    const content = (await response.text()).slice(0, 2 * 1024 * 1024);
    return {
      ...item,
      readmeContent: content,
      readmeUrl: `${item.url}#readme`,
      readmeError: null
    };
  } catch (error) {
    return {
      ...item,
      readmeContent: null,
      readmeUrl: `${item.url}#readme`,
      readmeError: error.message || String(error)
    };
  }
}
