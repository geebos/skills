import crypto from "node:crypto";
import { transaction } from "./db.mjs";

const STAGES = ["list", "article", "analysis"];

export class StoreError extends Error {}

function fail(message) {
  throw new StoreError(message);
}

function now() {
  return new Date().toISOString();
}

/**
 * Write boundary: each mutation declares its owning stage, and that stage must
 * be running. This is what stops the article agent from rewriting selections.
 */
function assertStage(db, runId, stage) {
  const row = db
    .prepare("SELECT status FROM stage_runs WHERE run_id = ? AND stage = ?")
    .get(runId, stage);
  if (!row) fail(`stage ${stage} has not been started for run ${runId}`);
  if (row.status !== "running") {
    fail(`stage ${stage} is ${row.status}, expected running`);
  }
}

function requireRun(db, runId) {
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) fail(`run ${runId} not found`);
  return run;
}

// ── runs & stages ───────────────────────────────────────────────

export function startRun(db, dateYmd) {
  if (!/^\d{8}$/.test(dateYmd || "")) fail("dateYmd must be YYYYMMDD");
  return transaction(db, () => {
    const info = db
      .prepare(
        "INSERT INTO runs (date_ymd, status, started_at) VALUES (?, 'running', ?)",
      )
      .run(dateYmd, now());
    const runId = Number(info.lastInsertRowid);
    for (const stage of STAGES) {
      db.prepare(
        "INSERT INTO stage_runs (run_id, stage, status) VALUES (?, ?, 'pending')",
      ).run(runId, stage);
    }
    return { runId, dateYmd, status: "running" };
  });
}

export function getRun(db, runId) {
  const run = requireRun(db, runId);
  const stages = db
    .prepare("SELECT stage, status, error FROM stage_runs WHERE run_id = ?")
    .all(runId);
  return { ...run, stages };
}

export function latestRun(db, dateYmd) {
  const sql = dateYmd
    ? "SELECT * FROM runs WHERE date_ymd = ? ORDER BY id DESC LIMIT 1"
    : "SELECT * FROM runs ORDER BY id DESC LIMIT 1";
  const run = dateYmd ? db.prepare(sql).get(dateYmd) : db.prepare(sql).get();
  return run || null;
}

export function setStage(db, runId, stage, status, error = null) {
  requireRun(db, runId);
  if (!STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  if (!["pending", "running", "done", "failed"].includes(status)) {
    fail(`unknown status ${status}`);
  }
  const stamp = now();
  db.prepare(
    `UPDATE stage_runs SET status = ?,
       started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
       finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END,
       error = ?
     WHERE run_id = ? AND stage = ?`,
  ).run(status, status, stamp, status, stamp, error, runId, stage);
  return { runId, stage, status };
}

export function finishRun(db, runId, status = "done") {
  requireRun(db, runId);
  if (!["done", "failed"].includes(status)) fail(`unknown run status ${status}`);
  db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(
    status,
    now(),
    runId,
  );
  return { runId, status };
}

// ── sites ───────────────────────────────────────────────────────

export function syncSites(db, sites) {
  return transaction(db, () => {
    for (const site of sites) {
      db.prepare(
        `INSERT INTO sites (id, name, label, enabled, adapter, config_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, label = excluded.label,
           enabled = excluded.enabled, adapter = excluded.adapter,
           config_json = excluded.config_json, updated_at = excluded.updated_at`,
      ).run(
        site.id,
        site.name,
        site.label ?? site.name,
        site.enabled === false ? 0 : 1,
        site.adapter,
        JSON.stringify(site.config ?? {}),
        now(),
      );
    }
    return { synced: sites.length };
  });
}

export function listSites(db, { enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? "SELECT * FROM sites WHERE enabled = 1 ORDER BY id"
    : "SELECT * FROM sites ORDER BY id";
  return db
    .prepare(sql)
    .all()
    .map((row) => ({ ...row, enabled: !!row.enabled, config: JSON.parse(row.config_json) }));
}

function requireSite(db, siteId) {
  const site = db.prepare("SELECT id FROM sites WHERE id = ?").get(siteId);
  if (!site) fail(`unknown site ${siteId}; register it in config/sites.json first`);
}

// ── list stage ──────────────────────────────────────────────────

export function upsertListItems(db, runId, siteId, items) {
  requireRun(db, runId);
  requireSite(db, siteId);
  assertStage(db, runId, "list");
  return transaction(db, () => {
    const stmt = db.prepare(
      `INSERT INTO list_items
         (run_id, site_id, source_id, title, url, section, metadata_json, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, site_id, source_id) DO UPDATE SET
         title = excluded.title, url = excluded.url, section = excluded.section,
         metadata_json = excluded.metadata_json`,
    );
    for (const item of items) {
      if (!item.sourceId) fail("list item requires sourceId");
      stmt.run(
        runId,
        siteId,
        String(item.sourceId),
        item.title ?? "",
        item.url ?? "",
        item.section ?? null,
        JSON.stringify(item.metadata ?? {}),
        now(),
      );
    }
    return { runId, siteId, count: items.length };
  });
}

export function listCandidates(db, runId, siteId = null) {
  requireRun(db, runId);
  const rows = siteId
    ? db
        .prepare("SELECT * FROM list_items WHERE run_id = ? AND site_id = ? ORDER BY site_id, source_id")
        .all(runId, siteId)
    : db
        .prepare("SELECT * FROM list_items WHERE run_id = ? ORDER BY site_id, source_id")
        .all(runId);
  return rows.map((row) => ({
    runId: row.run_id,
    siteId: row.site_id,
    sourceId: row.source_id,
    title: row.title,
    url: row.url,
    section: row.section,
    metadata: JSON.parse(row.metadata_json),
  }));
}

export function saveSelections(db, runId, selections) {
  requireRun(db, runId);
  assertStage(db, runId, "list");
  return transaction(db, () => {
    const stmt = db.prepare(
      `INSERT INTO selections
         (run_id, site_id, source_id, priority, reason, direction_hint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, site_id, source_id) DO UPDATE SET
         priority = excluded.priority, reason = excluded.reason,
         direction_hint = excluded.direction_hint, created_at = excluded.created_at`,
    );
    for (const sel of selections) {
      if (!sel.siteId || !sel.sourceId) fail("selection requires siteId and sourceId");
      if (!String(sel.reason || "").trim()) {
        fail(`selection ${sel.siteId}-${sel.sourceId} requires a reason`);
      }
      stmt.run(
        runId,
        sel.siteId,
        String(sel.sourceId),
        Number(sel.priority ?? 0),
        sel.reason,
        sel.directionHint ?? null,
        now(),
      );
    }
    return { runId, count: selections.length };
  });
}

export function listSelections(db, runId, siteId = null) {
  requireRun(db, runId);
  const rows = siteId
    ? db
        .prepare(
          `SELECT s.*, l.title, l.url FROM selections s
             JOIN list_items l USING (run_id, site_id, source_id)
           WHERE s.run_id = ? AND s.site_id = ?
           ORDER BY s.priority DESC, s.site_id, s.source_id`,
        )
        .all(runId, siteId)
    : db
        .prepare(
          `SELECT s.*, l.title, l.url FROM selections s
             JOIN list_items l USING (run_id, site_id, source_id)
           WHERE s.run_id = ?
           ORDER BY s.priority DESC, s.site_id, s.source_id`,
        )
        .all(runId);
  return rows.map((row) => ({
    runId: row.run_id,
    siteId: row.site_id,
    sourceId: row.source_id,
    priority: row.priority,
    reason: row.reason,
    directionHint: row.direction_hint,
    title: row.title,
    url: row.url,
  }));
}

// ── article stage ───────────────────────────────────────────────

export function contentHash(content) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
}

export function saveArticle(db, runId, siteId, sourceId, article) {
  requireRun(db, runId);
  requireSite(db, siteId);
  assertStage(db, runId, "article");
  const coverage = article.coverage ?? {};
  const status = coverage.status ?? "unknown";
  const hash = contentHash(article.content);
  return transaction(db, () => {
    const existing = db
      .prepare(
        "SELECT id FROM articles WHERE site_id = ? AND source_id = ? AND content_hash = ?",
      )
      .get(siteId, String(sourceId), hash);
    let articleId;
    let reused = false;
    if (existing) {
      articleId = existing.id;
      reused = true;
    } else {
      const info = db
        .prepare(
          `INSERT INTO articles
             (site_id, source_id, content_hash, fetched_at, coverage_status, coverage_json, content_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          siteId,
          String(sourceId),
          hash,
          now(),
          status,
          JSON.stringify(coverage),
          JSON.stringify(article.content),
        );
      articleId = Number(info.lastInsertRowid);
    }
    db.prepare(
      `INSERT INTO run_articles (run_id, site_id, source_id, article_id, linked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, site_id, source_id) DO UPDATE SET
         article_id = excluded.article_id, linked_at = excluded.linked_at`,
    ).run(runId, siteId, String(sourceId), articleId, now());
    return { articleId, contentHash: hash, reused, coverageStatus: status };
  });
}

export function listRunArticles(db, runId) {
  requireRun(db, runId);
  return db
    .prepare(
      `SELECT ra.site_id, ra.source_id, a.content_json, a.coverage_json, a.coverage_status
       FROM run_articles ra JOIN articles a ON a.id = ra.article_id
       WHERE ra.run_id = ? ORDER BY ra.site_id, ra.source_id`,
    )
    .all(runId)
    .map((row) => ({
      siteId: row.site_id,
      sourceId: row.source_id,
      coverageStatus: row.coverage_status,
      coverage: JSON.parse(row.coverage_json),
      content: JSON.parse(row.content_json),
    }));
}

export function saveEvidence(db, runId, entries) {
  requireRun(db, runId);
  assertStage(db, runId, "article");
  return transaction(db, () => {
    const stmt = db.prepare(
      `INSERT INTO evidence
         (run_id, site_id, source_id, facts_json, opinions_json, numbers_json,
          links_json, validity_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, site_id, source_id) DO UPDATE SET
         facts_json = excluded.facts_json, opinions_json = excluded.opinions_json,
         numbers_json = excluded.numbers_json, links_json = excluded.links_json,
         validity_notes = excluded.validity_notes, created_at = excluded.created_at`,
    );
    for (const entry of entries) {
      if (!entry.siteId || !entry.sourceId) fail("evidence requires siteId and sourceId");
      const linked = db
        .prepare(
          "SELECT 1 FROM run_articles WHERE run_id = ? AND site_id = ? AND source_id = ?",
        )
        .get(runId, entry.siteId, String(entry.sourceId));
      if (!linked) {
        fail(`evidence ${entry.siteId}-${entry.sourceId} has no article snapshot in this run`);
      }
      stmt.run(
        runId,
        entry.siteId,
        String(entry.sourceId),
        JSON.stringify(entry.facts ?? []),
        JSON.stringify(entry.opinions ?? []),
        JSON.stringify(entry.numbers ?? []),
        JSON.stringify(entry.links ?? []),
        entry.validityNotes ?? "",
        now(),
      );
    }
    return { runId, count: entries.length };
  });
}

export function listEvidence(db, runId) {
  requireRun(db, runId);
  return db
    .prepare(
      `SELECT e.*, l.title, l.url, s.priority, s.direction_hint, ra.article_id,
              a.coverage_status, a.coverage_json
       FROM evidence e
         LEFT JOIN list_items l USING (run_id, site_id, source_id)
         LEFT JOIN selections s USING (run_id, site_id, source_id)
         LEFT JOIN run_articles ra USING (run_id, site_id, source_id)
         LEFT JOIN articles a ON a.id = ra.article_id
       WHERE e.run_id = ?
       ORDER BY s.priority DESC, e.site_id, e.source_id`,
    )
    .all(runId)
    .map((row) => ({
      siteId: row.site_id,
      sourceId: row.source_id,
      title: row.title,
      url: row.url,
      priority: row.priority,
      directionHint: row.direction_hint,
      coverageStatus: row.coverage_status,
      coverage: row.coverage_json ? JSON.parse(row.coverage_json) : {},
      facts: JSON.parse(row.facts_json),
      opinions: JSON.parse(row.opinions_json),
      numbers: JSON.parse(row.numbers_json),
      links: JSON.parse(row.links_json),
      validityNotes: row.validity_notes,
    }));
}

// ── analysis stage ──────────────────────────────────────────────

export function saveReportItems(db, runId, items) {
  requireRun(db, runId);
  assertStage(db, runId, "analysis");
  return transaction(db, () => {
    const stmt = db.prepare(
      `INSERT INTO report_items
         (run_id, site_id, source_id, direction, direction_name, rank, title, blurb,
          analysis_json, validity, conclusion, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, site_id, source_id) DO UPDATE SET
         direction = excluded.direction, direction_name = excluded.direction_name,
         rank = excluded.rank, title = excluded.title, blurb = excluded.blurb,
         analysis_json = excluded.analysis_json, validity = excluded.validity,
         conclusion = excluded.conclusion, tags_json = excluded.tags_json,
         created_at = excluded.created_at`,
    );
    for (const item of items) {
      if (!item.siteId || !item.sourceId) fail("report item requires siteId and sourceId");
      const hasEvidence = db
        .prepare(
          "SELECT 1 FROM evidence WHERE run_id = ? AND site_id = ? AND source_id = ?",
        )
        .get(runId, item.siteId, String(item.sourceId));
      if (!hasEvidence) {
        fail(`report item ${item.siteId}-${item.sourceId} has no evidence in this run`);
      }
      const analysis = Array.isArray(item.analysis) ? item.analysis : [item.analysis];
      if (!analysis.length || analysis.some((part) => !String(part || "").trim())) {
        fail(`report item ${item.siteId}-${item.sourceId} requires non-empty analysis`);
      }
      stmt.run(
        runId,
        item.siteId,
        String(item.sourceId),
        item.direction,
        item.directionName,
        Number(item.rank ?? 0),
        item.title ?? "",
        item.blurb ?? "",
        JSON.stringify(analysis),
        item.validity ?? "",
        item.conclusion ?? "",
        JSON.stringify(item.tags ?? []),
        now(),
      );
    }
    return { runId, count: items.length };
  });
}

export function listReportItems(db, runId) {
  requireRun(db, runId);
  return db
    .prepare(
      `SELECT r.*, ra.article_id, a.coverage_json, l.url
       FROM report_items r
         LEFT JOIN run_articles ra USING (run_id, site_id, source_id)
         LEFT JOIN articles a ON a.id = ra.article_id
         LEFT JOIN list_items l USING (run_id, site_id, source_id)
       WHERE r.run_id = ? ORDER BY r.rank, r.site_id, r.source_id`,
    )
    .all(runId)
    .map((row) => ({
      siteId: row.site_id,
      sourceId: row.source_id,
      direction: row.direction,
      directionName: row.direction_name,
      rank: row.rank,
      title: row.title,
      blurb: row.blurb,
      analysis: JSON.parse(row.analysis_json),
      validity: row.validity,
      conclusion: row.conclusion,
      tags: JSON.parse(row.tags_json),
      url: row.url,
      coverage: row.coverage_json ? JSON.parse(row.coverage_json) : {},
    }));
}

export function purgeRun(db, runId) {
  requireRun(db, runId);
  return transaction(db, () => {
    for (const table of [
      "report_items",
      "evidence",
      "run_articles",
      "selections",
      "list_items",
      "stage_runs",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(runId);
    }
    db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    return { runId, purged: true };
  });
}
