(function initializeContentScript() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "GITHUB_TRENDING_COLLECT") {
      return false;
    }
    (async () => {
      try {
        await waitForTrendingRows();
        const items = globalThis.GithubTrendingParser.parseTrendingDocument(document);
        sendResponse({ ok: true, items, pageUrl: location.href });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  });

  chrome.runtime.sendMessage({
    type: "GITHUB_TRENDING_CONTENT_READY",
    pageUrl: location.href
  }).catch(() => {});

  async function waitForTrendingRows() {
    const timeoutAt = Date.now() + 15000;
    while (Date.now() < timeoutAt) {
      if (document.querySelector("article.Box-row")) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("trending_rows_not_found");
  }
})();
