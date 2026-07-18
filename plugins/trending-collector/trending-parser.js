(function exposeParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GithubTrendingParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createParser() {
  function parseTrendingDocument(document) {
    const articles = Array.from(document.querySelectorAll("article.Box-row"));
    return articles.map((article, index) => parseArticle(article, index + 1)).filter(Boolean);
  }

  function parseArticle(article, rank) {
    const repositoryLink = article.querySelector("h2 a[href]");
    if (!repositoryLink) {
      return null;
    }
    const repositoryPath = toRepositoryPath(repositoryLink.getAttribute("href") || repositoryLink.href);
    const parts = repositoryPath.split("/").filter(Boolean);
    if (parts.length !== 2) {
      return null;
    }
    const [owner, repository] = parts;
    const descriptionElement = article.querySelector("p.col-9, p.my-1, p");
    const languageElement = article.querySelector('[itemprop="programmingLanguage"]');
    const starsElement = article.querySelector(`a[href="/${owner}/${repository}/stargazers"]`)
      || article.querySelector('a[href$="/stargazers"]');
    const forksElement = article.querySelector(`a[href="/${owner}/${repository}/forks"]`)
      || article.querySelector('a[href$="/forks"], a[href$="/network/members"]');
    const todayElement = Array.from(article.querySelectorAll("span"))
      .find((element) => /stars?\s+today/i.test(normalizeText(element.textContent)));

    return {
      rank,
      owner,
      repository,
      fullName: `${owner}/${repository}`,
      description: normalizeText(descriptionElement?.textContent) || null,
      url: `https://github.com/${owner}/${repository}`,
      language: normalizeText(languageElement?.textContent) || null,
      totalStars: parseCount(starsElement?.textContent),
      totalForks: parseCount(forksElement?.textContent),
      starsToday: parseCount(todayElement?.textContent)
    };
  }

  function toRepositoryPath(value) {
    try {
      return new URL(value, "https://github.com").pathname.replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  function parseCount(value) {
    const normalized = normalizeText(value).replace(/,/g, "").toLowerCase();
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*([km])?/);
    if (!match) {
      return null;
    }
    const multiplier = match[2] === "k" ? 1000 : match[2] === "m" ? 1000000 : 1;
    return Math.round(Number(match[1]) * multiplier);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return { parseArticle, parseCount, parseTrendingDocument };
});
