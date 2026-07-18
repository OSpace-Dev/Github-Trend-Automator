const elements = {
  connectionBadge: document.getElementById("connectionBadge"),
  phaseValue: document.getElementById("phaseValue"),
  trendDateValue: document.getElementById("trendDateValue"),
  itemCountValue: document.getElementById("itemCountValue"),
  readmeCountValue: document.getElementById("readmeCountValue"),
  statusMessage: document.getElementById("statusMessage"),
  errorMessage: document.getElementById("errorMessage"),
  nextRunValue: document.getElementById("nextRunValue"),
  completedAtValue: document.getElementById("completedAtValue"),
  resultsList: document.getElementById("resultsList"),
  emptyResults: document.getElementById("emptyResults"),
  serverOriginInput: document.getElementById("serverOriginInput"),
  extensionTokenInput: document.getElementById("extensionTokenInput"),
  collectButton: document.getElementById("collectButton"),
  refreshButton: document.getElementById("refreshButton"),
  saveButton: document.getElementById("saveButton")
};

const PHASE_LABELS = {
  idle: "等待中",
  opening: "打开页面",
  collecting: "解析榜单",
  enriching: "读取 README",
  completed: "已完成",
  failed: "失败"
};

elements.collectButton.addEventListener("click", async () => {
  elements.collectButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GITHUB_TRENDING_MANUAL_COLLECT" });
    if (!response?.ok) {
      throw new Error(response?.error || "manual_collection_failed");
    }
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    elements.collectButton.disabled = false;
  }
});

elements.refreshButton.addEventListener("click", refresh);

elements.saveButton.addEventListener("click", async () => {
  elements.saveButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GITHUB_TRENDING_SAVE_CONFIG",
      config: {
        serverOrigin: elements.serverOriginInput.value,
        extensionToken: elements.extensionTokenInput.value
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "save_failed");
    }
    await refresh();
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    elements.saveButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.collectorState || changes.bridgeConfig)) {
    refresh().catch(() => {});
  }
});

refresh().catch((error) => showError(error.message || String(error)));

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GITHUB_TRENDING_GET_STATE" });
  if (!response?.ok) {
    throw new Error(response?.error || "state_unavailable");
  }
  render(response.state, response.config);
}

function render(state, config) {
  elements.connectionBadge.textContent = state.connected ? "已连接" : "离线";
  elements.connectionBadge.dataset.status = state.connected ? "online" : "offline";
  elements.phaseValue.textContent = PHASE_LABELS[state.phase] || state.phase || "-";
  elements.trendDateValue.textContent = state.trendDate || "-";
  elements.itemCountValue.textContent = String(state.itemCount || 0);
  elements.readmeCountValue.textContent = String(state.readmeCount || 0);
  elements.statusMessage.textContent = state.message || "-";
  elements.nextRunValue.textContent = formatDateTime(state.nextRunAt);
  elements.completedAtValue.textContent = formatDateTime(state.lastCompletedAt);
  elements.collectButton.disabled = !state.connected || ["opening", "collecting", "enriching"].includes(state.phase);
  elements.serverOriginInput.value = config.serverOrigin || "";
  elements.extensionTokenInput.value = config.extensionToken || "";
  if (state.error) {
    showError(state.error);
  } else {
    elements.errorMessage.hidden = true;
  }
  renderResults(state.lastItems || []);
}

function renderResults(items) {
  elements.resultsList.replaceChildren();
  elements.emptyResults.hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement("li");
    row.className = "result-item";

    const rank = document.createElement("span");
    rank.className = "result-rank";
    rank.textContent = `#${item.rank}`;

    const link = document.createElement("a");
    link.className = "result-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.fullName;

    const meta = document.createElement("span");
    meta.className = `result-meta ${item.readmeError ? "readme-missing" : "readme-ok"}`;
    meta.textContent = item.readmeError ? "README 缺失" : `+${formatCount(item.starsToday)}`;

    row.append(rank, link, meta);
    elements.resultsList.append(row);
  }
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "-";
}
