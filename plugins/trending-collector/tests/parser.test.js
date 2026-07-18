const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../trending-parser");

test("parses a GitHub Trending article", () => {
  const article = createArticle({
    href: "/openai/codex",
    description: "Coding agent",
    language: "TypeScript",
    stars: "12,345",
    forks: "1.2k",
    today: "456 stars today"
  });
  const document = {
    querySelectorAll(selector) {
      return selector === "article.Box-row" ? [article] : [];
    }
  };

  const items = parser.parseTrendingDocument(document);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    rank: 1,
    owner: "openai",
    repository: "codex",
    fullName: "openai/codex",
    description: "Coding agent",
    url: "https://github.com/openai/codex",
    language: "TypeScript",
    totalStars: 12345,
    totalForks: 1200,
    starsToday: 456
  });
});

test("parses abbreviated counters and rejects invalid repository links", () => {
  assert.equal(parser.parseCount("2.5m stars"), 2500000);
  assert.equal(parser.parseCount("no stars"), null);
  const invalid = createArticle({ href: "/settings/profile" });
  invalid.querySelector("h2 a[href]").getAttribute = () => "/too/many/parts";
  assert.equal(parser.parseArticle(invalid, 1), null);
});

function createArticle(values) {
  const elements = {
    repository: element("", { href: values.href }),
    description: element(values.description),
    language: element(values.language),
    stars: element(values.stars),
    forks: element(values.forks),
    today: element(values.today)
  };
  return {
    querySelector(selector) {
      if (selector === "h2 a[href]") return elements.repository;
      if (selector === "p.col-9, p.my-1, p") return elements.description;
      if (selector === '[itemprop="programmingLanguage"]') return elements.language;
      if (selector.includes("stargazers")) return elements.stars;
      if (selector.includes("forks") || selector.includes("network/members")) return elements.forks;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "span" ? [elements.today] : [];
    }
  };
}

function element(textContent = "", attributes = {}) {
  return {
    textContent,
    href: attributes.href,
    getAttribute(name) {
      return attributes[name] || null;
    }
  };
}
