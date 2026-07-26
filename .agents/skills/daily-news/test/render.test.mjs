import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDER = path.join(HERE, "../scripts/render_summary.mjs");

/** Two sites, one of them not in the original hardcoded trio. */
const SUMMARY = {
  schemaVersion: 1,
  date: "2026-07-26",
  dateYmd: "20260726",
  generatedAt: "2026-07-26T00:00:00Z",
  sites: [
    { id: "v2ex", label: "V2EX", badge: { dark: { bg: "#111", fg: "#eee" }, light: { bg: "#eee", fg: "#111" } } },
    { id: "hackernews", label: "Hacker News", badge: { dark: { bg: "#222", fg: "#f60" } } },
  ],
  sourceNote: "note",
  directionCards: [],
  globalNotes: [],
  items: [
    {
      id: "v2ex-1",
      source: "v2ex",
      title: "V2EX item",
      blurb: "b1",
      direction: "dev",
      directionName: "开发与自建",
      links: [{ label: "主帖", url: "https://www.v2ex.com/t/1" }],
      coverage: "posts=3，scraped 3/3 · complete",
      analysis: ["a1"],
      validity: "v",
      conclusion: "c",
    },
    {
      id: "hackernews-2",
      source: "hackernews",
      title: "HN item",
      blurb: "b2",
      direction: "dev",
      directionName: "开发与自建",
      links: [{ label: "主帖", url: "https://news.ycombinator.com/item?id=2" }],
      coverage: "posts=5，scraped 5/5 · complete",
      analysis: ["a2"],
      validity: "v",
      conclusion: "c",
    },
  ],
  crossLinks: [],
  risks: [],
};

function render(summary) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-news-render-"));
  const inPath = path.join(dir, "summary.json");
  const outPath = path.join(dir, "summary.html");
  fs.writeFileSync(inPath, JSON.stringify(summary));
  execFileSync(process.execPath, ["--no-warnings", RENDER, "--in", inPath, "--out", outPath]);
  return fs.readFileSync(outPath, "utf8");
}

test("render is driven by summary.sites, not a hardcoded site list", () => {
  const html = render(SUMMARY);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), "template still has unreplaced placeholders");

  // A site the skill never shipped with must still get a label and a badge.
  assert.match(html, /data-source="hackernews"/);
  assert.match(html, /Hacker News/);
  assert.match(html, /\.rec-source\[data-source="hackernews"\] \{ background: #222; color: #f60; \}/);

  // Titles list every site in the summary.
  assert.match(html, /<title>V2EX \+ Hacker News 每日调研/);
  assert.match(html, /<h1>V2EX \+ Hacker News 每日调研/);

  // Light-mode rules only appear for sites that declared them.
  assert.match(html, /prefers-color-scheme: light[\s\S]*data-source="v2ex"/);
});

test("unknown sources render without a badge instead of crashing", () => {
  const html = render({
    ...SUMMARY,
    items: [{ ...SUMMARY.items[0], id: "ghost-9", source: "ghost" }],
  });
  assert.ok(!html.includes('data-source="ghost"'), "unregistered source must not get a badge");
  assert.match(html, /ghost-9/, "the item itself should still render");
});
