#!/usr/bin/env node
/**
 * render_summary.mjs — fill summary-template.html from structured JSON.
 *
 * Preferred shape:
 * {
 *   "date": "2026-07-23",
 *   "dateYmd": "20260723",
 *   "generatedAt": "ISO",
 *   "sourceNote": "…",
 *   "globalNotes": ["跨分区备注 / 数据缺口…"],   // optional, under cards
 *   "todaySummary": ["…"],                      // fallback only if no cards
 *   "directionCards": [                         // preferred for 今日汇总
 *     {
 *       "id": "llm",
 *       "name": "AI / LLM 工具与应用",
 *       "summary": "该分区一句话总结",
 *       "events": [
 *         "核心事件（纯文本）",
 *         { "text": "可点事件", "itemId": "linuxdo-123" }  // 跳转到详析
 *       ]
 *     }
 *   ],
 *   "items": [
 *     {
 *       "id": "linuxdo-123", "title": "…", "blurb": "推荐一句话",
 *       "direction": "llm", "links": [{ "label": "主帖", "url": "…" }],
 *       "analysis": "支持 **加粗**、[链接](https://…)、GFM 表格与 - 列表",
 *       // analysis 也可为 string[]；每段可含表格
 *       "facts": ["可选要点，亦支持 **md**"], "opinions": ["可选"],
 *       "coverage": "posts=60，cooked 9/60 · capped",
 *       "validity": "…", "conclusion": "…", "tags": []
 *     }
 *   ],  // 推荐序 = 数组序；详析以 analysis 为主（rich md → HTML）
 *   "crossLinks": ["…"],
 *   "risks": ["…"]
 * }
 *
 * Auto cards: if directionCards missing, group items by direction
 * (first-seen order; only dirs that appear — no fixed four slots).
 *
 * Usage:
 *   node render_summary.mjs --in summary.json --out summary.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, "../assets/summary-template.html");

/** Optional display-name aliases for common ids; free-form ids use directionName or id as-is. */
const DIR_ALIASES = {
  llm: "AI / LLM 工具与应用",
  dev: "开发与自建",
  finance: "投资 / 加密 / 财经",
  resources: "数字权益与资源",
};

function dirDisplayName(id, explicit) {
  if (explicit) return explicit;
  if (id && DIR_ALIASES[id]) return DIR_ALIASES[id];
  return id || "其他";
}

function parseArgs(argv) {
  const out = { inPath: null, outPath: null, template: TEMPLATE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) out.inPath = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if (a === "--template" && argv[i + 1]) out.template = argv[++i];
  }
  return out;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safe http(s) URL only — reject javascript: etc. */
function safeHref(url) {
  const u = String(url || "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/[a-zA-Z0-9/_\-.#?&=%]+$/.test(u)) return u;
  return null;
}

/**
 * Minimal Markdown for analysis / prose fields:
 * - **bold**
 * - [label](https://…)
 * - `code`
 * - GFM tables (| a | b | + separator + rows)
 * No raw HTML. Escapes first, then applies marks.
 */
function inlineMd(escaped) {
  // links: [text](url) — text/url already escaped as content; recover raw url from source later via separate pass
  // We receive already-escaped text, so [ and ] ( ) are literal.
  let s = escaped;
  // bold **…**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // inline code `…`
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // links [label](url) — label may contain escaped chars; url must be safe
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, urlRaw) => {
      // url was escaped (&amp; etc.) — unescape entities for href check only
      const url = urlRaw
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
      const href = safeHref(url);
      if (!href) return label;
      return `<a class="topic-link" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    },
  );
  return s;
}

function isTableSep(line) {
  // | --- | :---: | ---: |
  return /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(line) && /---/.test(line);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function tableHtml(rows) {
  if (rows.length < 2) return null;
  const head = rows[0];
  const body = rows.slice(1);
  const th = head
    .map((c) => `<th>${inlineMd(esc(c))}</th>`)
    .join("");
  const trs = body
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${inlineMd(esc(c))}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table></div>`;
}

/**
 * Render a markdown-ish block (string) to HTML fragments.
 * Supports paragraphs, GFM tables, and inline bold/link/code.
 */
function richMdHtml(src) {
  const text = String(src ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join("\n").trim();
    para = [];
    if (!joined) return;
    // single-line list items starting with -
    const listLines = joined.split("\n");
    if (listLines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push(
        `<ul>${listLines
          .map((l) => {
            const item = l.replace(/^\s*[-*]\s+/, "");
            return `<li>${inlineMd(esc(item))}</li>`;
          })
          .join("\n")}</ul>`,
      );
      return;
    }
    out.push(
      `<p>${inlineMd(esc(joined)).replace(/\n/g, "<br />")}</p>`,
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    // detect table: header + separator
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSep(lines[i + 1])
    ) {
      flushPara();
      const rows = [splitTableRow(line)];
      i += 2; // skip sep
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        if (isTableSep(lines[i])) {
          i++;
          continue;
        }
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const t = tableHtml(rows);
      if (t) out.push(t);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

function listHtml(items, empty = "—") {
  if (!items || !items.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul>${items.map((x) => `<li>${inlineMd(esc(x))}</li>`).join("\n")}</ul>`;
}

function linksHtml(links) {
  if (!links || !links.length) return "";
  return links
    .map((l) => {
      const label = esc(l.label || l.url || "链接");
      const url = esc(l.url || "#");
      return `<a class="topic-link" href="${url}" target="_blank" rel="noopener">${label}</a>`;
    })
    .join(' <span class="sep">·</span> ');
}

function tagsHtml(tags) {
  if (!tags || !tags.length) return "";
  return `<div class="tags">${tags
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join("")}</div>`;
}

function normalizeItems(data) {
  let items = Array.isArray(data.items) ? [...data.items] : null;
  if (!items) {
    items = [];
    for (const dir of data.directions || []) {
      for (const it of dir.items || []) {
        items.push({
          ...it,
          direction: it.direction || dir.id,
          directionName: dirDisplayName(
            it.direction || dir.id,
            it.directionName || dir.name,
          ),
        });
      }
    }
  } else {
    items = items.map((it) => ({
      ...it,
      directionName: dirDisplayName(it.direction, it.directionName),
    }));
  }
  return items;
}

/**
 * Build directionCards from explicit data or items grouping.
 * Only dirs that appear (or are explicitly listed) — no fixed four slots.
 * Order: directionCards array order, else first-seen order in items.
 */
function normalizeCards(data, items) {
  if (Array.isArray(data.directionCards) && data.directionCards.length) {
    return data.directionCards.map((c) => ({
      id: c.id || "other",
      name: dirDisplayName(c.id, c.name),
      summary: c.summary || "",
      events: c.events || [],
      count:
        c.count != null
          ? c.count
          : items.filter((it) => it.direction === c.id).length,
    }));
  }

  // auto from items + optional directions[].overview (only dirs that appear)
  const overviewByDir = new Map();
  const nameByDir = new Map();
  for (const d of data.directions || []) {
    if (d.overview?.length) overviewByDir.set(d.id, d.overview.join(" "));
    if (d.name) nameByDir.set(d.id, d.name);
  }

  const byDir = new Map();
  const order = [];
  for (const it of items) {
    const id = it.direction || "other";
    if (!byDir.has(id)) {
      byDir.set(id, []);
      order.push(id);
    }
    byDir.get(id).push(it);
    if (it.directionName && !nameByDir.has(id)) {
      nameByDir.set(id, it.directionName);
    }
  }
  // include overview-only dirs that have no items (explicit empty notes)
  for (const id of overviewByDir.keys()) {
    if (!byDir.has(id)) {
      byDir.set(id, []);
      order.push(id);
    }
  }

  return order.map((id) => {
    const list = byDir.get(id) || [];
    return {
      id,
      name: dirDisplayName(id, nameByDir.get(id)),
      summary:
        overviewByDir.get(id) ||
        (list.length
          ? `收录 ${list.length} 条推荐条目。`
          : "本日无入选核心事件。"),
      events: list.map((it) => ({
        text: it.blurb || it.title || it.id,
        itemId: it.id,
      })),
      count: list.length,
    };
  });
}

function dirCardsHtml(cards) {
  if (!cards.length) {
    return '<p class="muted">本日无分区汇总。</p>';
  }
  return cards
    .map((c) => {
      let eventsBlock;
      if (!c.events?.length) {
        eventsBlock = '<p class="empty">暂无核心事件</p>';
      } else {
        const lis = c.events
          .map((ev) => {
            if (typeof ev === "string") {
              return `<li>${esc(ev)}</li>`;
            }
            const text = esc(ev.text || ev.title || "");
            if (ev.itemId) {
              return `<li><a href="#detail-${esc(ev.itemId)}">${text}</a></li>`;
            }
            return `<li>${text}</li>`;
          })
          .join("\n");
        eventsBlock = `<p class="events-label">核心事件</p><ul class="events">${lis}</ul>`;
      }
      return `<article class="dir-card" data-dir="${esc(c.id)}" id="card-${esc(c.id)}">
  <div class="dir-card-head">
    <h3>${esc(c.name)}</h3>
    <span class="count">${esc(String(c.count ?? c.events?.length ?? 0))} 事</span>
  </div>
  <p class="summary">${esc(c.summary || "—")}</p>
  ${eventsBlock}
</article>`;
    })
    .join("\n");
}

function globalNotesHtml(notes) {
  if (!notes || !notes.length) return "";
  return `<div class="global-note">
  <strong>补充说明</strong>
  ${listHtml(notes)}
</div>`;
}

const SOURCE_LABELS = { linuxdo: "linux.do", v2ex: "V2EX", jisilu: "集思录" };

function sourceBadge(source) {
  if (!source || !SOURCE_LABELS[source]) return "";
  return `<span class="rec-source rec-source-${esc(source)}">${SOURCE_LABELS[source]}</span>`;
}

function recListHtml(items) {
  if (!items.length) {
    return '<p class="muted">本日无推荐条目。</p>';
  }
  const lis = items
    .map((it, i) => {
      const anchor = `detail-${esc(it.id || String(i + 1))}`;
      const dir = it.directionName
        ? `<span class="rec-dir">${esc(it.directionName)}</span>`
        : "";
      const idBadge = it.id
        ? `<span class="rec-id">${esc(it.id)}</span>`
        : "";
      const src = sourceBadge(it.source);
      const blurb = it.blurb
        ? `<p class="rec-blurb">${esc(it.blurb)}</p>`
        : it.conclusion
          ? `<p class="rec-blurb">${esc(String(it.conclusion).slice(0, 160))}</p>`
          : "";
      return `<li>
  <span class="rec-rank" aria-hidden="true"></span>
  <div class="rec-body">
    <div class="rec-title-row">
      ${src}
      <a class="rec-title" href="#${anchor}">${esc(it.title || "（无标题）")}</a>
      ${idBadge}
      ${dir}
    </div>
    ${blurb}
    <a class="rec-jump" href="#${anchor}">查看详析 ↓</a>
  </div>
</li>`;
    })
    .join("\n");
  return `<ol class="rec-list">${lis}</ol>`;
}

function analysisHtml(item) {
  let parts = [];
  if (Array.isArray(item.analysis)) {
    parts = item.analysis.map((p) => String(p || "").trim()).filter(Boolean);
  } else if (item.analysis) {
    // Keep as one blob so GFM tables spanning lines survive;
    // richMdHtml already splits paragraphs on blank lines.
    parts = [String(item.analysis).trim()].filter(Boolean);
  }
  // fallback: synthesize thin prose from facts if author forgot analysis
  if (!parts.length && item.facts?.length) {
    parts = [
      item.facts.join(" "),
      ...(item.opinions?.length
        ? ["评论区方面：" + item.opinions.join("；") + "。"]
        : []),
    ];
  }
  if (!parts.length) {
    return '<p class="muted">（无详细总结）</p>';
  }
  // Each array element is a block (paragraph cluster or table-containing section)
  return parts.map((p) => richMdHtml(p) || `<p>${inlineMd(esc(p))}</p>`).join("\n");
}

function detailHtml(item, rank) {
  const id = item.id || String(rank);
  const srcLabel = item.source && SOURCE_LABELS[item.source]
    ? `${SOURCE_LABELS[item.source]} · `
    : "";
  const dirLine = item.directionName
    ? `<p class="detail-meta">${esc(srcLabel + item.directionName)}${item.id ? ` · ${esc(item.id)}` : ""}</p>`
    : item.id || srcLabel
      ? `<p class="detail-meta">${esc(srcLabel)}${item.id ? esc(item.id) : ""}</p>`
      : "";
  const coverage = item.coverage
    ? `<p class="detail-coverage">${esc(item.coverage)}</p>`
    : "";
  const hasFacts = item.facts?.length;
  const hasOpinions = item.opinions?.length;
  const factsBlock = hasFacts
    ? `<section class="block secondary">
    <h4>要点摘录 · 事实</h4>
    ${listHtml(item.facts)}
  </section>`
    : "";
  const opinionsBlock = hasOpinions
    ? `<section class="block secondary">
    <h4>要点摘录 · 观点</h4>
    ${listHtml(item.opinions)}
  </section>`
    : "";
  return `
<article class="detail" id="detail-${esc(id)}">
  <div class="detail-head">
    <h3><span class="item-id">#${rank}</span> ${esc(item.title || "（无标题）")}</h3>
    <span class="detail-rank">推荐 ${rank}</span>
  </div>
  ${dirLine}
  ${tagsHtml(item.tags)}
  <p class="links">${linksHtml(item.links)}</p>
  ${coverage}
  <section class="block analysis">
    <h4>内容详细总结</h4>
    <div class="analysis-body">
      ${analysisHtml(item)}
    </div>
  </section>
  ${factsBlock}
  ${opinionsBlock}
  <section class="block">
    <h4>有效性核验</h4>
    <p>${inlineMd(esc(item.validity || "—"))}</p>
  </section>
  <section class="block conclusion">
    <h4>结论</h4>
    <p>${inlineMd(esc(item.conclusion || "—"))}</p>
  </section>
  <a class="back-top" href="#recs">↑ 返回推荐列表</a>
</article>`;
}

function render(data, template) {
  const items = normalizeItems(data);
  const cards = normalizeCards(data, items);
  const details = items.map((it, i) => detailHtml(it, i + 1)).join("\n");

  const globalNotes =
    data.globalNotes ||
    (!data.directionCards && data.todaySummary ? data.todaySummary : null);

  const map = {
    "{{DATE}}": esc(data.date || ""),
    "{{DATE_YMD}}": esc(data.dateYmd || ""),
    "{{GENERATED_AT}}": esc(data.generatedAt || ""),
    "{{SOURCE_NOTE}}": esc(data.sourceNote || ""),
    "{{DIR_CARDS}}": dirCardsHtml(cards),
    "{{GLOBAL_NOTES}}": globalNotesHtml(globalNotes),
    "{{REC_LIST}}": recListHtml(items),
    "{{DETAILS}}": details || '<p class="muted">本日无详析条目。</p>',
    "{{CROSS_LINKS}}": listHtml(data.crossLinks, "（无）"),
    "{{RISKS}}": listHtml(data.risks, "（无额外风险项）"),
    "{{ITEM_COUNT}}": String(items.length),
  };

  let html = template;
  for (const [k, v] of Object.entries(map)) {
    html = html.split(k).join(v);
  }
  return html;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inPath) {
    console.error(
      "Usage: render_summary.mjs --in summary.json [--out summary.html]",
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(args.inPath, "utf8"));
  const template = fs.readFileSync(args.template, "utf8");
  const html = render(data, template);
  const outPath =
    args.outPath ||
    path.join(
      path.dirname(args.inPath),
      path.basename(args.inPath).replace(/\.json$/i, "") + ".html",
    );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  console.log(outPath);
}

main();
