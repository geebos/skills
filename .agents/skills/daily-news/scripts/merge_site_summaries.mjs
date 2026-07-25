#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITES = ["linuxdo", "v2ex", "jisilu"];
const COVERAGE_STATUSES = new Set(["complete", "capped", "partial", "unknown"]);

function fail(message) {
  throw new Error(message);
}

function nonEmpty(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${field} must be a non-empty string`);
  }
}

function stringArray(value, field) {
  if (value == null) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${field} must be a string array`);
  }
}

function validateUrl(site, sourceId, rawUrl, field) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${field} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    fail(`${field} must use HTTP(S)`);
  }

  const host = url.hostname.toLowerCase();
  const patterns = {
    linuxdo: {
      hosts: ["linux.do"],
      path: new RegExp(`^/t/(?:topic/)?${sourceId}(?:/|$)`),
    },
    v2ex: {
      hosts: ["v2ex.com", "www.v2ex.com"],
      path: new RegExp(`^/t/${sourceId}(?:/|$)`),
    },
    jisilu: {
      hosts: ["jisilu.cn", "www.jisilu.cn"],
      path: new RegExp(`^/question/${sourceId}(?:/|$)`),
    },
  };
  const rule = patterns[site];
  if (!rule.hosts.includes(host) || !rule.path.test(url.pathname)) {
    fail(`${field} does not match ${site} sourceId ${sourceId}`);
  }
}

function validateCoverage(coverage, field) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    fail(`${field} must be an object`);
  }
  const { declaredPosts, scrapedPosts, status, note = "" } = coverage;
  if (
    declaredPosts !== null &&
    (!Number.isInteger(declaredPosts) || declaredPosts < 0)
  ) {
    fail(`${field}.declaredPosts must be null or a non-negative integer`);
  }
  if (!Number.isInteger(scrapedPosts) || scrapedPosts < 0) {
    fail(`${field}.scrapedPosts must be a non-negative integer`);
  }
  if (!COVERAGE_STATUSES.has(status)) {
    fail(`${field}.status is invalid`);
  }
  if (["partial", "unknown"].includes(status) && !String(note).trim()) {
    fail(`${field}.note is required for ${status}`);
  }
  if (
    declaredPosts !== null &&
    status !== "complete" &&
    status !== "unknown" &&
    scrapedPosts >= declaredPosts
  ) {
    fail(`${field} contradicts ${status}: scrapedPosts must be below declaredPosts`);
  }
}

export function validateSiteSummary(data, expected = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("summary must be an object");
  }
  if (data.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!SITES.includes(data.site)) {
    fail(`site must be one of ${SITES.join(", ")}`);
  }
  if (expected.site && data.site !== expected.site) {
    fail(`expected site ${expected.site}, got ${data.site}`);
  }
  if (!/^\d{8}$/.test(data.dateYmd || "")) {
    fail("dateYmd must be YYYYMMDD");
  }
  if (expected.dateYmd && data.dateYmd !== expected.dateYmd) {
    fail(`expected dateYmd ${expected.dateYmd}, got ${data.dateYmd}`);
  }
  if (Number.isNaN(Date.parse(data.generatedAt))) {
    fail("generatedAt must be an ISO timestamp");
  }
  stringArray(data.globalNotes, "globalNotes");
  stringArray(data.risks, "risks");
  if (!Array.isArray(data.items)) fail("items must be an array");

  const ids = new Set();
  const sourceIds = new Set();
  data.items.forEach((item, index) => {
    const prefix = `items[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`${prefix} must be an object`);
    }
    nonEmpty(item.sourceId, `${prefix}.sourceId`);
    const sourceId = item.sourceId.trim();
    if (item.id !== `${data.site}-${sourceId}`) {
      fail(`${prefix}.id must be ${data.site}-${sourceId}`);
    }
    if (ids.has(item.id)) fail(`duplicate item id ${item.id}`);
    if (sourceIds.has(sourceId)) fail(`duplicate sourceId ${sourceId}`);
    ids.add(item.id);
    sourceIds.add(sourceId);
    if (item.source !== data.site) {
      fail(`${prefix}.source must equal ${data.site}`);
    }

    for (const field of [
      "title",
      "blurb",
      "direction",
      "directionName",
      "validity",
      "conclusion",
    ]) {
      nonEmpty(item[field], `${prefix}.${field}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.direction)) {
      fail(`${prefix}.direction must be kebab-case`);
    }
    const hasAnalysis =
      (typeof item.analysis === "string" && item.analysis.trim()) ||
      (Array.isArray(item.analysis) &&
        item.analysis.length &&
        item.analysis.every(
          (part) => typeof part === "string" && part.trim(),
        ));
    if (!hasAnalysis) {
      fail(`${prefix}.analysis must be a non-empty string or string array`);
    }
    for (const field of ["facts", "opinions", "tags"]) {
      stringArray(item[field], `${prefix}.${field}`);
    }

    if (!Array.isArray(item.links) || !item.links.length) {
      fail(`${prefix}.links must not be empty`);
    }
    item.links.forEach((link, linkIndex) => {
      nonEmpty(link?.label, `${prefix}.links[${linkIndex}].label`);
      nonEmpty(link?.url, `${prefix}.links[${linkIndex}].url`);
      if (linkIndex === 0) {
        validateUrl(
          data.site,
          sourceId,
          link.url,
          `${prefix}.links[0].url`,
        );
      } else {
        let url;
        try {
          url = new URL(link.url);
        } catch {
          fail(`${prefix}.links[${linkIndex}].url must be a valid URL`);
        }
        if (!["http:", "https:"].includes(url.protocol)) {
          fail(`${prefix}.links[${linkIndex}].url must use HTTP(S)`);
        }
      }
    });

    validateCoverage(item.coverage, `${prefix}.coverage`);
    if (
      item.siteMeta?.depth != null &&
      ![1, 2].includes(item.siteMeta.depth)
    ) {
      fail(`${prefix}.siteMeta.depth must be 1 or 2`);
    }
    if (
      data.site === "jisilu" &&
      !item.conclusion.includes("不构成投资建议")
    ) {
      fail(`${prefix}.conclusion must include 不构成投资建议`);
    }
  });

  const unresolved = data.items.filter((item) =>
    ["partial", "unknown"].includes(item.coverage.status),
  );
  if (unresolved.length && !(data.globalNotes || []).length) {
    fail("globalNotes must describe partial/unknown coverage");
  }
  return data;
}

export function validateDeepProvenance(summary, deepData) {
  if (!deepData || typeof deepData !== "object" || Array.isArray(deepData)) {
    fail(`${summary.site} deep.json must be an object`);
  }
  if (deepData.site && deepData.site !== summary.site) {
    fail(`${summary.site} deep.json has site ${deepData.site}`);
  }
  if (deepData.date !== summary.dateYmd) {
    fail(`${summary.site} deep.json date must be ${summary.dateYmd}`);
  }
  if (deepData.mode !== "deep" || !Array.isArray(deepData.deep)) {
    fail(`${summary.site} deep.json must contain a deep-mode result`);
  }
  const tids = new Set(deepData.deep.map((topic) => String(topic.tid)));
  for (const item of summary.items) {
    if (!tids.has(item.sourceId)) {
      fail(`${item.id} sourceId is missing from ${summary.site} deep.json`);
    }
  }
  return summary;
}

function coverageText(coverage) {
  const declared =
    coverage.declaredPosts == null ? "?" : coverage.declaredPosts;
  const note = coverage.note?.trim() ? ` · ${coverage.note.trim()}` : "";
  return `posts=${declared}，scraped ${coverage.scrapedPosts}/${declared} · ${coverage.status}${note}`;
}

export function mergeSiteSummaries(
  summaries,
  generatedAt = new Date().toISOString(),
) {
  if (!summaries.length) fail("at least one site summary is required");
  const dateYmd = summaries[0].dateYmd;
  const seenSites = new Set();
  const seenIds = new Set();
  const cards = new Map();
  const items = [];
  const globalNotes = [];
  const risks = [];

  for (const summary of summaries) {
    validateSiteSummary(summary, { dateYmd });
    if (seenSites.has(summary.site)) {
      fail(`duplicate site summary ${summary.site}`);
    }
    seenSites.add(summary.site);
    for (const note of summary.globalNotes || []) {
      globalNotes.push(`[${summary.site}] ${note}`);
    }
    for (const risk of summary.risks || []) {
      risks.push(`[${summary.site}] ${risk}`);
    }

    for (const item of summary.items) {
      if (seenIds.has(item.id)) {
        fail(`duplicate item id across sites: ${item.id}`);
      }
      seenIds.add(item.id);
      const existing = cards.get(item.direction);
      if (existing && existing.name !== item.directionName) {
        fail(
          `direction ${item.direction} has conflicting names: ${existing.name} / ${item.directionName}`,
        );
      }
      if (!existing) {
        cards.set(item.direction, {
          id: item.direction,
          name: item.directionName,
          sources: new Set(),
          events: [],
        });
      }
      const card = cards.get(item.direction);
      card.sources.add(item.source);
      card.events.push({ text: item.blurb, itemId: item.id });
      items.push({
        ...item,
        coverageData: item.coverage,
        coverage: coverageText(item.coverage),
      });
    }
  }

  const date = `${dateYmd.slice(0, 4)}-${dateYmd.slice(4, 6)}-${dateYmd.slice(6, 8)}`;
  return {
    schemaVersion: 1,
    date,
    dateYmd,
    generatedAt,
    sourceNote: `由 ${[...seenSites].join("、")} 三个站点切片合并；分类与排序待总控复核。`,
    directionCards: [...cards.values()].map((card) => ({
      id: card.id,
      name: card.name,
      summary: `收录 ${card.events.length} 条，来源：${[
        ...card.sources,
      ].join("、")}。`,
      events: card.events,
    })),
    globalNotes,
    items,
    crossLinks: [],
    risks,
  };
}

function parseArgs(argv) {
  const args = {
    dateYmd: null,
    root: process.cwd(),
    out: null,
    validate: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") args.dateYmd = argv[++index];
    else if (arg === "--root") args.root = path.resolve(argv[++index]);
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--validate") args.validate = argv[++index];
    else fail(`unknown argument ${arg}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.validate) {
    const filePath = path.resolve(args.validate);
    const data = validateSiteSummary(readJson(filePath));
    const deepPath = path.join(path.dirname(filePath), "deep.json");
    if (fs.existsSync(deepPath)) {
      validateDeepProvenance(data, readJson(deepPath));
    }
    const provenance = fs.existsSync(deepPath) ? " + deep provenance" : "";
    console.log(
      `valid ${data.site} ${data.dateYmd}: ${data.items.length} items${provenance}`,
    );
    return;
  }
  if (!/^\d{8}$/.test(args.dateYmd || "")) {
    fail(
      "Usage: merge_site_summaries.mjs --date YYYYMMDD [--root PATH] [--out PATH]",
    );
  }

  const summaries = SITES.map((site) => {
    const input = path.join(
      args.root,
      "docs/daily",
      site,
      args.dateYmd,
      "site-summary.json",
    );
    const summary = validateSiteSummary(readJson(input), {
      site,
      dateYmd: args.dateYmd,
    });
    const deepPath = path.join(path.dirname(input), "deep.json");
    return validateDeepProvenance(summary, readJson(deepPath));
  });
  const merged = mergeSiteSummaries(summaries);
  const outPath = path.resolve(
    args.out ||
      path.join(args.root, "docs/daily", args.dateYmd, "summary.json"),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`wrote ${outPath}: ${merged.items.length} items`);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
