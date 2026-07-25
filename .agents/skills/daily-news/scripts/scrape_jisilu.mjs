#!/usr/bin/env node
/**
 * scrape-jisilu — multi-category 集思录 list + question scraper via browser-mcp SDK.
 *
 * Skill: .agents/skills/daily-news/
 * Usage (from repo root) — two modes; agent picks deep tids between them:
 *   BROWSER_MCP_TOKEN=test node .agents/skills/daily-news/scripts/scrape_jisilu.mjs --mode list
 *   node .../scrape_jisilu.mjs --mode deep --tids 521729,522000
 *
 * Flow: list → list.json; agent reads it and picks tids; deep → deep.json
 * (deep mode auto-loads sibling list.json for coverage cross-check).
 *
 * Env:
 *   BROWSER_MCP_TOKEN   (required for extension bind; default "test")
 *   BROWSER_MCP_SDK     optional path to sdk.js
 *   MONKFISH_ROOT       optional explicit repo root
 *   BROWSER_MCP_WS_PORT / BROWSER_MCP_WS_PORT_MAX
 *   SCAN_TOPIC_DELAY_MS / SCAN_OPEN_DELAY_MS / SCAN_CATEGORY_DELAY_MS
 *   OUTPUT_DIR          override output dir (default docs/daily/jisilu/YYYYMMDD)
 *   DATE                override YYYYMMDD (Asia/Shanghai)
 *   COOKED_LIMIT        max posts per question (default 9 = OP + 8 replies)
 *   LIST_LIMIT          max question rows per category (default 30)
 *
 * SDK: @geebos/browser-mcp from GitHub Packages (see package.json).
 *
 * 集思录 DOM (WeCenter; verified 2026-07-24 via curl probe):
 *   list rows:    //div[@class='aw-item'] containing span.aw-question-replay-count
 *                 (explore 首条广告位 aw-item 无 replay-count，天然被过滤)
 *   title:        h4 内首个 a，href="https://www.jisilu.cn/question/{tid}"
 *   reply count:  span.aw-question-replay-count > em
 *   views:        文本 "N 次浏览"（列表 meta 行；问题页无此字段）
 *   category tag: span.aw-question-tags > a（/category/N）
 *   author:       "贡献 :" 后首个 /people/{username} 链接
 *   question title: //div[contains(@class,'aw-question-detail-title')]//h1
 *   declared replies: //div[contains(@class,'aw-question-detail-box')]//h2 → "N 个回复"
 *   OP body:      //div[contains(@class,'aw-question-detail-txt')]
 *   replies:      //div[contains(@class,'aw-dynamic-topic')]//div[@class='markitup-box']
 *                 （问题页无分页，全部楼层在同一 DOM；注意站点 class 拼写为 aw-questoin-content）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

/** Repo root whether this file lives under skill scripts/ or repo scripts/. */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    // AGENTS.md / STOCKS.md only exist at the true repo root — NOT package.json,
    // which the skill dir also has (SDK dependency) and would false-match.
    if (
      fs.existsSync(path.join(dir, "STOCKS.md")) ||
      fs.existsSync(path.join(dir, "AGENTS.md"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // skill: .agents/skills/daily-news/scripts → repo root
  if (
    path.basename(startDir) === "scripts" &&
    path.basename(path.dirname(startDir)) === "daily-news"
  ) {
    return path.resolve(startDir, "../../../..");
  }
  return path.resolve(startDir, "../..");
}

const ROOT = process.env.MONKFISH_ROOT
  ? path.resolve(process.env.MONKFISH_ROOT)
  : findRepoRoot(__dirname);

const SDK_PKG = "@geebos/browser-mcp";
const SDK_EXPORT = "@geebos/browser-mcp/sdk";

const DELAY_BETWEEN_TOPICS_MS = Number(process.env.SCAN_TOPIC_DELAY_MS || 2500);
const DELAY_AFTER_OPEN_MS = Number(process.env.SCAN_OPEN_DELAY_MS || 800);
const DELAY_BETWEEN_TABS_MS = Number(
  process.env.SCAN_CATEGORY_DELAY_MS || 1500,
);
const COOKED_LIMIT = Number(process.env.COOKED_LIMIT || 9);
const LIST_LIMIT = Number(process.env.LIST_LIMIT || 30);

/** 集思录 categories to scan (explore 是全站最新聚合，与分类重叠按 tid 去重). */
const DEFAULT_CATEGORIES = [
  { key: "explore", name: "最新", path: "/explore/" },
  { key: "bond", name: "债券/可转债", path: "/category/4" },
  { key: "fund", name: "基金", path: "/category/7" },
  { key: "arbitrage", name: "套利", path: "/category/5" },
  { key: "stock", name: "股票", path: "/category/8" },
];

// ── CLI ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    mode: "list", // list | deep | custom
    tids: [],
    categories: null, // null = default
    outPath: null,
    maxDepth: 1,
    xpath: null,
    url: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (a === "--tids" && argv[i + 1]) {
      out.tids = argv[++i]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if ((a === "--categories" || a === "--tabs") && argv[i + 1]) {
      out.categories = argv[++i]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if ((a === "--max-depth" || a === "--depth") && argv[i + 1]) {
      out.maxDepth = Math.min(2, Math.max(1, parseInt(argv[++i], 10) || 1));
    } else if (a === "--xpath" && argv[i + 1]) out.xpath = argv[++i];
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (out.xpath && out.mode === "list") out.mode = "custom";
  return out;
}

function shanghaiDateYmd() {
  if (process.env.DATE && /^\d{8}$/.test(process.env.DATE)) {
    return process.env.DATE;
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → YYYY-MM-DD
  return fmt.format(new Date()).replace(/-/g, "");
}

function resolveCategories(args) {
  if (!args.categories || !args.categories.length) return DEFAULT_CATEGORIES;
  const byKey = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c]));
  const out = [];
  for (const raw of args.categories) {
    if (byKey.has(raw)) out.push(byKey.get(raw));
    else if (raw.startsWith("/")) {
      const key = (raw.match(/category-(\d+)/) || [])[1] || raw;
      out.push({ key, name: raw, path: raw });
    } else {
      console.error(`[scan] unknown category key: ${raw}`);
    }
  }
  return out;
}

// ── SDK resolve ─────────────────────────────────────────────────
function runOk(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if ((r.status ?? 1) !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed: ${err.slice(0, 400)}`);
  }
  return r;
}

function packageInstalled() {
  return (
    fs.existsSync(
      path.join(SKILL_DIR, "node_modules", "@geebos", "browser-mcp", "package.json"),
    ) ||
    fs.existsSync(
      path.join(ROOT, "node_modules", "@geebos", "browser-mcp", "package.json"),
    )
  );
}

async function importSdkPackage() {
  console.error(`[scan] loading ${SDK_EXPORT}`);
  return import(SDK_EXPORT);
}

async function loadSdk() {
  if (process.env.BROWSER_MCP_SDK) {
    const p = process.env.BROWSER_MCP_SDK;
    if (!fs.existsSync(p)) {
      throw new Error(`BROWSER_MCP_SDK not found: ${p}`);
    }
    const abs = path.resolve(p);
    console.error(`[scan] loading browser-mcp SDK from ${abs}`);
    return import(pathToFileURL(abs).href);
  }

  // fallback: CLIProxyAPI install if repo has none
  const cliproxySdk = path.join(
    process.env.HOME || "",
    "workplace/github/CLIProxyAPI/node_modules/@geebos/browser-mcp/server/dist/sdk.js",
  );

  if (!packageInstalled()) {
    // prefer skill-local install (self-contained / distributable)
    const skillPkgJson = path.join(SKILL_DIR, "package.json");
    const rootPkgJson = path.join(ROOT, "package.json");
    const installDir = fs.existsSync(skillPkgJson) ? SKILL_DIR : ROOT;
    const pkgJson = installDir === SKILL_DIR ? skillPkgJson : rootPkgJson;
    if (fs.existsSync(pkgJson)) {
      console.error(`[scan] installing ${SDK_PKG} in ${installDir} (GitHub Packages)…`);
      try {
        runOk("npm", ["install", "--no-fund", "--no-audit"], {
          cwd: installDir,
          stdio: "inherit",
        });
      } catch (e) {
        if (fs.existsSync(cliproxySdk)) {
          console.error(
            `[scan] npm install failed; falling back to CLIProxyAPI SDK`,
          );
          return import(pathToFileURL(cliproxySdk).href);
        }
        throw e;
      }
    } else if (fs.existsSync(cliproxySdk)) {
      console.error(`[scan] loading SDK from CLIProxyAPI fallback`);
      return import(pathToFileURL(cliproxySdk).href);
    } else {
      throw new Error(
        `missing ${pkgJson}; add dependency "${SDK_PKG}" and run npm install`,
      );
    }
  }

  try {
    return await importSdkPackage();
  } catch (e) {
    if (fs.existsSync(cliproxySdk)) {
      console.error(`[scan] package import failed; CLIProxyAPI fallback`);
      return import(pathToFileURL(cliproxySdk).href);
    }
    throw new Error(
      `failed to import ${SDK_EXPORT}: ${e.message}\n` +
        `Ensure ~/.npmrc has:\n` +
        `  @geebos:registry=https://npm.pkg.github.com\n` +
        `  //npm.pkg.github.com/:_authToken=<GITHUB_PAT with read:packages>\n` +
        `Then: npm install`,
    );
  }
}

// ── HTML helpers ────────────────────────────────────────────────
function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIntLoose(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse 集思录 list rows (div.aw-item with replay-count) into question records.
 * posts = replies +1 (OP) to keep schema parity with linuxdo/v2ex scrapers.
 */
function parseTopicRows(htmlList) {
  const rows = [];
  for (const h of htmlList || []) {
    // skip the explore-page promo aw-item (no replay-count, no /question/ link)
    const idM = h.match(/\/question\/(\d+)/);
    if (!idM) continue;
    if (!/aw-question-replay-count/.test(h)) continue;
    const tid = idM[1];
    // title: first link inside <h4> (may contain <strong>[置顶]</strong> etc.)
    const tM = h.match(/<h4>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const title = tM ? stripTags(tM[1]) : "";
    const cM = h.match(
      /aw-question-replay-count[^>]*>[\s\S]*?<em>(\d+)<\/em>/,
    );
    const replies = cM ? parseIntLoose(cM[1]) ?? 0 : 0;
    const vM = h.match(/([\d,]+)\s*次浏览/);
    const views = vM ? parseIntLoose(vM[1]) : null;
    const nM = h.match(/aw-question-tags[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const node = nM ? stripTags(nM[1]) : "";
    const aM = h.match(/贡献[\s\S]{0,300}?\/people\/([^"\/?#]+)/);
    let author = "";
    if (aM) {
      try {
        author = decodeURIComponent(aM[1]);
      } catch {
        author = aM[1];
      }
    }
    rows.push({
      tid,
      title,
      excerpt: "",
      posts: replies + 1,
      replies,
      views,
      node,
      author,
    });
  }
  return rows;
}

/**
 * Compare declared total posts (OP + replies) vs scraped count.
 * Same semantics as linuxdo/v2ex buildPostCoverage for schema parity.
 */
function buildPostCoverage({ listPosts, pagePosts, cookedCount, cookedLimit }) {
  const declared =
    pagePosts != null ? pagePosts : listPosts != null ? listPosts : null;
  const source =
    pagePosts != null ? "topic_page" : listPosts != null ? "list" : "unknown";
  const scraped = cookedCount ?? 0;
  const limit = cookedLimit ?? COOKED_LIMIT;
  let status;
  let note;
  if (declared == null) {
    status = "unknown";
    note = "could not parse reply count from list or question page";
  } else if (scraped >= declared) {
    status = "complete";
    note = `scraped ${scraped} posts >= declared ${declared}`;
  } else if (scraped >= limit && declared > limit) {
    status = "capped";
    note = `declared ${declared} posts; scraped first ${scraped} (COOKED_LIMIT=${limit}); remaining ${declared - scraped} not fetched`;
  } else if (scraped < declared) {
    status = "partial";
    note = `declared ${declared} but only scraped ${scraped} posts (below limit ${limit}) — DOM incomplete or paginated replies`;
  } else {
    status = "complete";
    note = `scraped ${scraped}, declared ${declared}`;
  }
  const repliesDeclared =
    declared != null && declared >= 1 ? Math.max(0, declared - 1) : null;
  const commentsScraped = Math.max(0, scraped - 1);
  return {
    declared_posts: declared,
    declared_replies: repliesDeclared,
    declared_source: source,
    list_posts: listPosts ?? null,
    page_posts: pagePosts ?? null,
    cooked_scraped: scraped,
    comments_scraped: commentsScraped,
    cooked_limit: limit,
    status, // complete | capped | partial | unknown
    note,
    mismatch: declared != null && scraped < declared,
  };
}

function extractLinks(joinedHtml) {
  const links = [];
  const seen = new Set();
  for (const m of joinedHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = m[1];
    if (/jisilu\.cn|avatar|uploads|gravatar|static\/img/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
  }
  return links.slice(0, 30);
}

// ── browser helpers ─────────────────────────────────────────────
function jitter(ms) {
  const j = ms * 0.2;
  return Math.max(0, Math.round(ms - j + Math.random() * 2 * j));
}

async function politeSleep(ms, label = "") {
  const t = jitter(ms);
  if (t <= 0) return;
  if (label) console.error(`[scan] sleep ${t}ms ${label}`);
  await sleep(t);
}

async function openTab(client, url, tabId) {
  const params = { url, active: false };
  if (tabId != null) params.tabId = tabId;
  return client.tab.open(params);
}

async function waitXpath(client, tabId, xpath, timeoutMs = 15000) {
  return client.page.wait({
    tabId,
    xpath,
    state: "attached",
    timeoutMs,
  });
}

async function xpathAll(client, tabId, xpath) {
  const r = await client.page.xpath({ tabId, xpath, all: true });
  return r.htmlList || (r.html ? [r.html] : []);
}

// ── scrape steps ────────────────────────────────────────────────
async function scrapeCategoryList(client, tabId, cat) {
  const url = `https://www.jisilu.cn${cat.path}`;
  console.error(`[scan] list ${cat.key} ${url}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after tab open");
  await waitXpath(
    client,
    id,
    "//span[contains(@class,'aw-question-replay-count')]",
    20000,
  );
  const rowHtml = await xpathAll(client, id, "//div[@class='aw-item']");
  let rows = parseTopicRows(rowHtml);
  // fallback: title links only if aw-item structure changed
  if (!rows.length) {
    const links = await xpathAll(
      client,
      id,
      "//div[contains(@class,'aw-questoin-content')]//h4//a",
    );
    for (const h of links) {
      const idM = h.match(/\/question\/(\d+)/);
      if (!idM) continue;
      rows.push({
        tid: idM[1],
        title: stripTags(h).slice(0, 200),
        excerpt: "",
        posts: null,
        replies: null,
        views: null,
        node: "",
        author: "",
      });
    }
  }
  rows = rows.slice(0, LIST_LIMIT);
  console.error(`[scan] ${cat.key}: ${rows.length} topics`);
  return { tabId: id, rows };
}

async function scrapeTopic(client, tabId, tid, listMeta = null) {
  const url = `https://www.jisilu.cn/question/${tid}`;
  console.error(`[scan] topic ${tid}`);
  const open = await openTab(client, url, tabId);
  const id = open.tabId;
  await politeSleep(DELAY_AFTER_OPEN_MS, "after topic open");
  await waitXpath(
    client,
    id,
    "//div[contains(@class,'aw-question-detail-title')]//h1",
    15000,
  );

  const titleHtml = await xpathAll(
    client,
    id,
    "//div[contains(@class,'aw-question-detail-title')]//h1",
  );
  const title = titleHtml.length ? stripTags(titleHtml[0]).slice(0, 300) : "";

  // declared reply count: aw-question-detail-box h2 → "N 个回复"
  const metaHtml = await xpathAll(
    client,
    id,
    "//div[contains(@class,'aw-question-detail-box')]//h2",
  ).catch(() => []);
  let pageReplies = null;
  for (const h of metaHtml || []) {
    const m = stripTags(h).match(/(\d+)\s*个回复/);
    if (m) {
      pageReplies = parseIntLoose(m[1]);
      break;
    }
  }

  // OP body (aw-question-detail-txt) + replies (markitup-box under aw-dynamic-topic, capped)
  const opHtml = await xpathAll(
    client,
    id,
    "//div[contains(@class,'aw-question-detail-txt')]",
  );
  const replyHtml = await xpathAll(
    client,
    id,
    `(//div[contains(@class,'aw-dynamic-topic')]//div[@class='markitup-box'])[position() <= ${COOKED_LIMIT - 1}]`,
  );

  const posts = [];
  if (opHtml.length) {
    posts.push({
      index: 0,
      role: "op",
      text: stripTags(opHtml[0]).slice(0, 4000),
      htmlLength: opHtml[0].length,
    });
  }
  replyHtml.forEach((html, i) => {
    posts.push({
      index: i + 1,
      role: "comment",
      text: stripTags(html).slice(0, 4000),
      htmlLength: html.length,
    });
  });

  const joined = [...opHtml, ...replyHtml].join("\n");
  const links = extractLinks(joined);

  // posts = OP + replies; keep schema parity with linuxdo/v2ex scrapers
  const listPosts = listMeta?.replies != null ? listMeta.replies + 1 : null;
  const pagePosts = pageReplies != null ? pageReplies + 1 : null;
  const coverage = buildPostCoverage({
    listPosts,
    pagePosts,
    cookedCount: posts.length,
    cookedLimit: COOKED_LIMIT,
  });

  if (coverage.mismatch) {
    console.error(
      `[scan] coverage ${tid} status=${coverage.status} declared=${coverage.declared_posts} scraped=${coverage.cooked_scraped} — ${coverage.note}`,
    );
  } else {
    console.error(
      `[scan] coverage ${tid} status=${coverage.status} declared=${coverage.declared_posts} scraped=${coverage.cooked_scraped}`,
    );
  }

  return {
    tabId: id,
    topic: {
      tid: String(tid),
      url,
      title,
      posts,
      externalLinks: links,
      cookedCount: posts.length,
      posts_count: coverage.declared_posts,
      replies_count: coverage.declared_replies,
      post_coverage: coverage,
    },
  };
}

/** Load sibling list.json (written by --mode list) for deep-mode cross-check. */
function loadListByTid(listPath) {
  const map = new Map();
  if (!fs.existsSync(listPath)) {
    console.error(
      `[scan] no list.json at ${listPath} — deep coverage falls back to topic page only`,
    );
    return map;
  }
  try {
    const data = JSON.parse(fs.readFileSync(listPath, "utf8"));
    for (const cat of data.categories || []) {
      for (const t of cat.topics || []) {
        const tid = String(t.tid);
        if (map.has(tid)) continue;
        map.set(tid, {
          ...t,
          category: cat.key,
          categoryName: cat.name,
        });
      }
    }
    console.error(`[scan] loaded ${map.size} list rows from ${listPath}`);
  } catch (e) {
    console.error(`[scan] list.json parse failed: ${e.message}`);
  }
  return map;
}

// ── main ────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  scrape_jisilu.mjs --mode list [options]      # step 1: scan category lists → list.json
  scrape_jisilu.mjs --mode deep --tids 1,2,3   # step 2: agent-picked tids → deep.json

Options:
  --mode list|deep          list categories (default) | deep-read agent-picked tids
  --tids 521729,522000      question ids (deep mode; agent decides from list.json)
  --categories explore,bond,stock  category keys or /category/N paths
  --out path.json           output path override (default <outDir>/list.json|deep.json)

Flow: run list, agent reads list.json and picks tids, then run deep.
deep mode auto-loads sibling list.json for coverage cross-check.
`);
    return;
  }
  if (args.mode !== "list" && args.mode !== "deep" && args.mode !== "custom") {
    console.error(
      `[scan] unknown mode: ${args.mode} (expected list | deep | custom)`,
    );
    process.exit(1);
  }
  if (args.mode === "deep" && !args.tids.length) {
    console.error("[scan] --mode deep requires --tids (agent picks them from list.json)");
    process.exit(1);
  }

  const dateYmd = shanghaiDateYmd();
  const defaultOutDir =
    process.env.OUTPUT_DIR || path.join(ROOT, "docs/daily/jisilu", dateYmd);
  const outPath =
    args.outPath ||
    path.join(defaultOutDir, args.mode === "list" ? "list.json" : "deep.json");

  const { startBrowserServer, BrowserMcpError } = await loadSdk();
  const token = process.env.BROWSER_MCP_TOKEN?.trim() || "test";
  const authDir =
    process.env.BROWSER_MCP_AUTH_DIR || path.join(ROOT, ".browser-mcp");

  const server = await startBrowserServer({
    token,
    name: "jisilu-daily-research",
    authDir,
    cwd: ROOT,
    wsPort: Number(process.env.BROWSER_MCP_WS_PORT || 11470),
    wsPortMax: Number(process.env.BROWSER_MCP_WS_PORT_MAX || 12460),
  });

  const result = {
    scraped_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    date: dateYmd,
    site: "jisilu",
    mode: args.mode,
    categories: [],
    deep: [],
    errors: [],
  };

  let tabId = null;
  try {
    console.error(
      `[scan] ws://127.0.0.1:${server.port} name=${server.name} waiting extension…`,
    );
    await server.waitForExtension({ timeoutMs: 120_000 });
    const meta = await server.client.meta.version();
    console.error(
      `[scan] extension connected server=${meta.serverVersion} ext=${meta.extensionVersion}`,
    );

    // 0) custom mode: agent specifies custom xpath and target url to extract unformatted content
    if (args.mode === "custom" || args.xpath) {
      const targetUrl = args.url || (args.tids[0] ? `https://www.jisilu.cn/question/${args.tids[0]}` : null);
      if (!targetUrl || !args.xpath) {
        console.error("[scan] custom mode requires --url (or --tids) and --xpath");
        process.exit(1);
      }
      console.error(`[scan] custom xpath extract url=${targetUrl} xpath=${args.xpath}`);
      const open = await openTab(server.client, targetUrl, tabId);
      tabId = open.tabId;
      await politeSleep(DELAY_AFTER_OPEN_MS, "after custom open");
      await waitXpath(server.client, tabId, args.xpath, 20000).catch(() => {});
      const htmlList = await xpathAll(server.client, tabId, args.xpath);
      const customResult = {
        ok: true,
        mode: "custom",
        url: targetUrl,
        xpath: args.xpath,
        count: htmlList.length,
        results: htmlList.map((h, i) => ({
          index: i,
          html: h,
          text: stripTags(h),
        })),
      };
      if (args.outPath) {
        fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
        fs.writeFileSync(args.outPath, JSON.stringify(customResult, null, 2) + "\n", "utf8");
      }
      console.log(JSON.stringify(customResult, null, 2));
      return;
    }

    // 1) list mode: scan category lists, then done (agent picks deep tids)
    if (args.mode === "list") {
      const cats = resolveCategories(args);
      for (let i = 0; i < cats.length; i++) {
        const cat = cats[i];
        if (i > 0) {
          await politeSleep(DELAY_BETWEEN_TABS_MS, `before category ${cat.key}`);
        }
        try {
          const { tabId: id, rows } = await scrapeCategoryList(
            server.client,
            tabId,
            cat,
          );
          tabId = id;
          result.categories.push({
            key: cat.key,
            name: cat.name,
            path: cat.path,
            url: `https://www.jisilu.cn${cat.path}`,
            topic_count: rows.length,
            topics: rows,
          });
        } catch (e) {
          result.errors.push({
            stage: "list",
            category: cat.key,
            err: String(e.message || e),
          });
          console.error(`[scan] list fail ${cat.key}:`, e.message || e);
        }
      }
    }

    // 2) deep mode: agent-picked tids; sibling list.json feeds coverage cross-check
    const listByTid =
      args.mode === "deep"
        ? loadListByTid(path.join(path.dirname(outPath), "list.json"))
        : new Map();

    if (args.mode === "deep") {
      const deepTids = [...args.tids];
      const visitedTids = new Set(deepTids.map(String));

      // Depth 1 fetch
      for (let i = 0; i < deepTids.length; i++) {
        const tid = deepTids[i];
        if (i > 0) {
          await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before topic ${tid}`);
        }
        try {
          const listMeta = listByTid.get(String(tid)) || null;
          const { tabId: id, topic } = await scrapeTopic(
            server.client,
            tabId,
            tid,
            listMeta,
          );
          tabId = id;
          topic.depth = 1;
          if (listMeta) {
            topic.listTitle = listMeta.title;
            topic.listExcerpt = listMeta.excerpt;
            topic.listPosts = listMeta.posts;
            topic.listReplies = listMeta.replies;
            topic.listViews = listMeta.views;
            topic.category = listMeta.category;
            topic.categoryName = listMeta.categoryName;
            topic.node = listMeta.node;
            topic.author = listMeta.author;
          }
          result.deep.push(topic);
          const cov = topic.post_coverage || {};
          console.error(
            `[scan] deep ${tid} (depth 1) cooked=${topic.cookedCount} declared=${topic.posts_count} coverage=${cov.status} title=${(topic.title || "").slice(0, 60)}`,
          );
          if (cov.status === "partial" || cov.status === "unknown") {
            result.errors.push({
              stage: "coverage",
              tid: String(tid),
              err: cov.note || cov.status,
              coverage: cov,
            });
          }
        } catch (e) {
          result.errors.push({
            stage: "deep",
            tid: String(tid),
            err: String(e.message || e),
          });
          console.error(`[scan] deep fail ${tid}:`, e.message || e);
        }
      }

      // Depth 2 max exploration: if maxDepth >= 2, extract referenced topics from depth-1 topics
      if (args.maxDepth >= 2) {
        const depth2Tids = new Set();
        for (const topic of result.deep) {
          const textToScan =
            topic.posts.map((p) => p.text).join("\n") +
            "\n" +
            (topic.externalLinks || []).join("\n");
          const matches = textToScan.matchAll(/jisilu\.cn\/question\/(\d+)/gi);
          for (const m of matches) {
            const refTid = String(m[1]);
            if (!visitedTids.has(refTid)) {
              visitedTids.add(refTid);
              depth2Tids.add(refTid);
            }
          }
        }

        if (depth2Tids.size > 0) {
          console.error(`[scan] depth-2 exploration found ${depth2Tids.size} referenced topics: ${Array.from(depth2Tids).join(",")}`);
          for (const refTid of depth2Tids) {
            await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before depth-2 topic ${refTid}`);
            try {
              const listMeta = listByTid.get(String(refTid)) || null;
              const { tabId: id, topic } = await scrapeTopic(
                server.client,
                tabId,
                refTid,
                listMeta,
              );
              tabId = id;
              topic.depth = 2;
              if (listMeta) {
                topic.listTitle = listMeta.title;
                topic.listExcerpt = listMeta.excerpt;
                topic.listPosts = listMeta.posts;
                topic.listReplies = listMeta.replies;
                topic.listViews = listMeta.views;
                topic.category = listMeta.category;
                topic.categoryName = listMeta.categoryName;
                topic.node = listMeta.node;
                topic.author = listMeta.author;
              }
              result.deep.push(topic);
              console.error(
                `[scan] deep ${refTid} (depth 2) cooked=${topic.cookedCount} title=${(topic.title || "").slice(0, 60)}`,
              );
            } catch (e) {
              result.errors.push({
                stage: "deep_depth2",
                tid: String(refTid),
                err: String(e.message || e),
              });
              console.error(`[scan] depth-2 fail ${refTid}:`, e.message || e);
            }
          }
        }
      }
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.error(`[scan] wrote ${outPath}`);

    // human summary on stdout
    const listN = result.categories.reduce(
      (a, c) => a + (c.topic_count || 0),
      0,
    );
    const coverageSummary = { complete: 0, capped: 0, partial: 0, unknown: 0 };
    for (const t of result.deep) {
      const s = t.post_coverage?.status || "unknown";
      if (coverageSummary[s] != null) coverageSummary[s] += 1;
      else coverageSummary.unknown += 1;
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          site: "jisilu",
          date: result.date,
          out: outPath,
          categories: result.categories.map((c) => ({
            key: c.key,
            topics: c.topic_count,
            with_replies: (c.topics || []).filter((t) => t.replies > 0).length,
          })),
          deep: result.deep.length,
          coverage: coverageSummary,
          errors: result.errors.length,
          list_topics: listN,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (e instanceof BrowserMcpError) {
      console.error(`[scan] BrowserMcpError ${e.code}: ${e.message}`);
    } else {
      console.error("[scan] fatal:", e);
    }
    process.exitCode = 1;
  } finally {
    if (tabId != null) {
      try {
        await server.client.tab.close({ tabId });
      } catch {
        /* extension may auto-close */
      }
    }
    await server.close().catch(() => {});
  }
}

main();
