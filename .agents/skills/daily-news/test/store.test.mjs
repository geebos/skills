import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDb } from "../lib/db.mjs";
import { migrate } from "../lib/migrations.mjs";
import * as store from "../lib/store.mjs";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-news-test-"));
  const db = openDb(path.join(dir, "test.sqlite"));
  migrate(db);
  store.syncSites(db, [
    { id: "v2ex", name: "V2EX", label: "V2EX", adapter: "scripts/sites/v2ex.mjs" },
  ]);
  return db;
}

const ARTICLE = {
  coverage: { status: "capped", declared_posts: 20, cooked_scraped: 9 },
  content: { title: "t", posts: [{ index: 0, role: "op", text: "body" }] },
};

function seedThroughEvidence(db) {
  const { runId } = store.startRun(db, "20260726");
  store.setStage(db, runId, "list", "running");
  store.upsertListItems(db, runId, "v2ex", [
    { sourceId: "1", title: "one", url: "https://www.v2ex.com/t/1" },
  ]);
  store.saveSelections(db, runId, [
    { siteId: "v2ex", sourceId: "1", priority: 5, reason: "worth reading" },
  ]);
  store.setStage(db, runId, "list", "done");

  store.setStage(db, runId, "article", "running");
  const saved = store.saveArticle(db, runId, "v2ex", "1", ARTICLE);
  store.saveEvidence(db, runId, [
    { siteId: "v2ex", sourceId: "1", facts: ["f"], opinions: ["o"], validityNotes: "n" },
  ]);
  store.setStage(db, runId, "article", "done");
  return { runId, saved };
}

test("pipeline round-trips list through report", () => {
  const db = freshDb();
  const { runId } = seedThroughEvidence(db);

  assert.equal(store.listCandidates(db, runId).length, 1);
  assert.equal(store.listSelections(db, runId)[0].reason, "worth reading");
  const evidence = store.listEvidence(db, runId);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].coverageStatus, "capped");
  assert.equal(evidence[0].priority, 5);

  store.setStage(db, runId, "analysis", "running");
  store.saveReportItems(db, runId, [
    {
      siteId: "v2ex",
      sourceId: "1",
      direction: "dev",
      directionName: "开发与自建",
      rank: 1,
      title: "one",
      blurb: "b",
      analysis: ["detailed"],
      validity: "v",
      conclusion: "c",
    },
  ]);
  const report = store.listReportItems(db, runId);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].analysis, ["detailed"]);
  assert.equal(report[0].url, "https://www.v2ex.com/t/1");
});

test("writes outside the running stage are rejected", () => {
  const db = freshDb();
  const { runId } = store.startRun(db, "20260726");

  // list stage never started
  assert.throws(
    () => store.upsertListItems(db, runId, "v2ex", [{ sourceId: "1", title: "x" }]),
    /stage list has not been started|stage list is pending/,
  );

  store.setStage(db, runId, "list", "running");
  store.upsertListItems(db, runId, "v2ex", [
    { sourceId: "1", title: "one", url: "https://www.v2ex.com/t/1" },
  ]);
  // article stage is still pending, so article writes must fail
  assert.throws(
    () => store.saveArticle(db, runId, "v2ex", "1", ARTICLE),
    /stage article is pending/,
  );
});

test("identical content across runs reuses one snapshot", () => {
  const db = freshDb();
  const first = seedThroughEvidence(db);
  assert.equal(first.saved.reused, false);

  const second = store.startRun(db, "20260727");
  store.setStage(db, second.runId, "list", "running");
  store.upsertListItems(db, second.runId, "v2ex", [
    { sourceId: "1", title: "one", url: "https://www.v2ex.com/t/1" },
  ]);
  store.setStage(db, second.runId, "list", "done");
  store.setStage(db, second.runId, "article", "running");

  const again = store.saveArticle(db, second.runId, "v2ex", "1", ARTICLE);
  assert.equal(again.reused, true, "unchanged article must reuse the stored snapshot");
  assert.equal(again.articleId, first.saved.articleId);

  const changed = store.saveArticle(db, second.runId, "v2ex", "1", {
    ...ARTICLE,
    content: { ...ARTICLE.content, title: "edited" },
  });
  assert.equal(changed.reused, false, "changed article must create a new snapshot");
  assert.notEqual(changed.articleId, first.saved.articleId);
});

test("evidence requires an article and report requires evidence", () => {
  const db = freshDb();
  const { runId } = store.startRun(db, "20260726");
  store.setStage(db, runId, "article", "running");
  assert.throws(
    () => store.saveEvidence(db, runId, [{ siteId: "v2ex", sourceId: "404" }]),
    /no article snapshot/,
  );

  store.setStage(db, runId, "analysis", "running");
  assert.throws(
    () =>
      store.saveReportItems(db, runId, [
        {
          siteId: "v2ex",
          sourceId: "404",
          direction: "d",
          directionName: "D",
          analysis: ["a"],
        },
      ]),
    /no evidence/,
  );
});

test("unknown site and malformed input are rejected", () => {
  const db = freshDb();
  const { runId } = store.startRun(db, "20260726");
  store.setStage(db, runId, "list", "running");
  assert.throws(
    () => store.upsertListItems(db, runId, "nope", [{ sourceId: "1", title: "x" }]),
    /unknown site nope/,
  );
  assert.throws(() => store.startRun(db, "2026-07-26"), /dateYmd must be YYYYMMDD/);
  assert.throws(
    () => store.saveSelections(db, runId, [{ siteId: "v2ex", sourceId: "1", reason: " " }]),
    /requires a reason/,
  );
});
