#!/usr/bin/env node
/**
 * scrape_site.mjs — registry-driven list/deep scraper via the browser-mcp SDK.
 *
 * One scraper for every site: DOM knowledge lives in scripts/sites/<id>.mjs and
 * is selected through config/sites.json. Adding a site needs no change here.
 *
 * Usage (from repo root):
 *   BROWSER_MCP_TOKEN=test node .../scrape_site.mjs --site v2ex --mode list
 *   node .../scrape_site.mjs --site v2ex --mode deep --tids 1,2 --max-depth 2
 *   node .../scrape_site.mjs --site v2ex --mode custom --url <url> --xpath <xpath>
 *
 * Env: BROWSER_MCP_TOKEN, BROWSER_MCP_SDK, MONKFISH_ROOT, DATE, OUTPUT_DIR,
 *      COOKED_LIMIT, LIST_LIMIT, SCAN_*_DELAY_MS, BROWSER_MCP_WS_PORT[_MAX].
 */
import fs from "node:fs";
import path from "node:path";
import { loadRegistry } from "../lib/registry.mjs";
import {
  DELAY_AFTER_OPEN_MS,
  DELAY_BETWEEN_CATEGORIES_MS,
  DELAY_BETWEEN_TOPICS_MS,
  ROOT,
  applyListMeta,
  loadListByTid,
  loadSdk,
  openTab,
  politeSleep,
  scrapeTargetList,
  scrapeTopic,
  shanghaiDateYmd,
  stripTags,
  waitXpath,
  xpathAll,
} from "../lib/scrape_core.mjs";

function parseArgs(argv) {
  const out = {
    site: null,
    mode: "list",
    tids: [],
    categories: null,
    includeOptional: false,
    outPath: null,
    maxDepth: 1,
    xpath: null,
    url: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site" && argv[i + 1]) out.site = argv[++i];
    else if (a === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (a === "--tids" && argv[i + 1]) {
      out.tids = argv[++i].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    } else if ((a === "--categories" || a === "--tabs") && argv[i + 1]) {
      out.categories = argv[++i].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    } else if (a === "--include-optional") out.includeOptional = true;
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if ((a === "--max-depth" || a === "--depth") && argv[i + 1]) {
      out.maxDepth = Math.min(2, Math.max(1, parseInt(argv[++i], 10) || 1));
    } else if (a === "--xpath" && argv[i + 1]) out.xpath = argv[++i];
    else if (a === "--url" && argv[i + 1]) out.url = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (out.xpath && out.mode === "list") out.mode = "custom";
  return out;
}

const USAGE = `Usage:
  scrape_site.mjs --site <id> --mode list [--categories a,b] [--include-optional]
  scrape_site.mjs --site <id> --mode deep --tids 1,2,3 [--max-depth 2]
  scrape_site.mjs --site <id> --mode custom --url <url> --xpath <xpath>

Sites come from config/sites.json. Run list first, pick tids, then run deep;
deep mode auto-loads the sibling list.json for coverage cross-check.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const registry = await loadRegistry();
  if (!args.site) {
    console.error(`[scan] --site is required; known: ${registry.ids().join(", ")}`);
    process.exit(1);
  }
  const site = registry.require(args.site);

  if (!["list", "deep", "custom"].includes(args.mode)) {
    console.error(`[scan] unknown mode: ${args.mode} (expected list | deep | custom)`);
    process.exit(1);
  }
  if (args.mode === "deep" && !args.tids.length) {
    console.error("[scan] --mode deep requires --tids (pick them from list.json)");
    process.exit(1);
  }

  const dateYmd = shanghaiDateYmd();
  const defaultOutDir =
    process.env.OUTPUT_DIR || path.join(ROOT, "docs/daily", site.id, dateYmd);
  const outPath =
    args.outPath ||
    path.join(defaultOutDir, args.mode === "list" ? "list.json" : "deep.json");

  const { startBrowserServer, BrowserMcpError } = await loadSdk();
  const server = await startBrowserServer({
    token: process.env.BROWSER_MCP_TOKEN?.trim() || "test",
    name: `${site.id}-daily-research`,
    authDir: process.env.BROWSER_MCP_AUTH_DIR || path.join(ROOT, ".browser-mcp"),
    cwd: ROOT,
    wsPort: Number(process.env.BROWSER_MCP_WS_PORT || 11470),
    wsPortMax: Number(process.env.BROWSER_MCP_WS_PORT_MAX || 12460),
  });

  const result = {
    scraped_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    date: dateYmd,
    site: site.id,
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

    if (args.mode === "custom") {
      const targetUrl = args.url || (args.tids[0] ? site.topicUrl(args.tids[0]) : null);
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
        site: site.id,
        url: targetUrl,
        xpath: args.xpath,
        count: htmlList.length,
        results: htmlList.map((h, i) => ({ index: i, html: h, text: stripTags(h) })),
      };
      if (args.outPath) {
        fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
        fs.writeFileSync(args.outPath, `${JSON.stringify(customResult, null, 2)}\n`, "utf8");
      }
      console.log(JSON.stringify(customResult, null, 2));
      return;
    }

    if (args.mode === "list") {
      const targets = site.listTargets({
        categories: args.categories,
        includeOptional: args.includeOptional,
      });
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (i > 0) {
          await politeSleep(DELAY_BETWEEN_CATEGORIES_MS, `before category ${target.key}`);
        }
        try {
          const { tabId: id, rows } = await scrapeTargetList(
            server.client,
            tabId,
            site,
            target,
          );
          tabId = id;
          result.categories.push({
            key: target.key,
            name: target.name,
            path: target.path,
            url: site.listUrl(target),
            topic_count: rows.length,
            topics: rows,
          });
        } catch (e) {
          result.errors.push({
            stage: "list",
            category: target.key,
            err: String(e.message || e),
          });
          console.error(`[scan] list fail ${target.key}:`, e.message || e);
        }
      }
    }

    if (args.mode === "deep") {
      const listByTid = loadListByTid(path.join(path.dirname(outPath), "list.json"));
      const visitedTids = new Set(args.tids.map(String));

      for (let i = 0; i < args.tids.length; i++) {
        const tid = args.tids[i];
        if (i > 0) await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before topic ${tid}`);
        try {
          const listMeta = listByTid.get(String(tid)) || null;
          const { tabId: id, topic } = await scrapeTopic(
            server.client,
            tabId,
            site,
            tid,
            listMeta,
          );
          tabId = id;
          topic.depth = 1;
          applyListMeta(topic, listMeta, site.listMetaFields);
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
          result.errors.push({ stage: "deep", tid: String(tid), err: String(e.message || e) });
          console.error(`[scan] deep fail ${tid}:`, e.message || e);
        }
      }

      if (args.maxDepth >= 2) {
        const depth2Tids = new Set();
        for (const topic of result.deep) {
          const text =
            topic.posts.map((p) => p.text).join("\n") +
            "\n" +
            (topic.externalLinks || []).join("\n");
          for (const m of text.matchAll(site.selfLinkRe)) {
            const refTid = String(m[1]);
            if (!visitedTids.has(refTid)) {
              visitedTids.add(refTid);
              depth2Tids.add(refTid);
            }
          }
        }
        if (depth2Tids.size) {
          console.error(
            `[scan] depth-2 exploration found ${depth2Tids.size} referenced topics: ${[...depth2Tids].join(",")}`,
          );
          for (const refTid of depth2Tids) {
            await politeSleep(DELAY_BETWEEN_TOPICS_MS, `before depth-2 topic ${refTid}`);
            try {
              const listMeta = listByTid.get(String(refTid)) || null;
              const { tabId: id, topic } = await scrapeTopic(
                server.client,
                tabId,
                site,
                refTid,
                listMeta,
              );
              tabId = id;
              topic.depth = 2;
              applyListMeta(topic, listMeta, site.listMetaFields);
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
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.error(`[scan] wrote ${outPath}`);

    const coverageSummary = { complete: 0, capped: 0, partial: 0, unknown: 0 };
    for (const topic of result.deep) {
      const s = topic.post_coverage?.status || "unknown";
      if (coverageSummary[s] != null) coverageSummary[s] += 1;
      else coverageSummary.unknown += 1;
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          site: site.id,
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
          list_topics: result.categories.reduce((a, c) => a + (c.topic_count || 0), 0),
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
