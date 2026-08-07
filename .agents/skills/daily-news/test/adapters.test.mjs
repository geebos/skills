import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../lib/registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const registry = await loadRegistry();

function fixtureRows(siteId) {
  const file = path.join(HERE, "fixtures", `${siteId}-rows.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).rows;
}

test("registry exposes every configured site with a complete interface", () => {
  assert.deepEqual(registry.ids(), ["linuxdo", "v2ex", "jisilu"]);
  for (const site of registry.all()) {
    assert.ok(site.listTargets({}).length > 0, `${site.id} must define list targets`);
    assert.match(site.topicUrl("123"), /^https:\/\//);
    assert.ok(site.host.startsWith("https://"));
  }
});

test("adapters parse real list-row HTML", () => {
  for (const site of registry.all()) {
    const rows = site.parseListRows(fixtureRows(site.id));
    assert.ok(rows.length > 0, `${site.id} parsed no rows`);
    for (const row of rows) {
      assert.match(String(row.tid), /^\d+$/, `${site.id} row has a non-numeric tid`);
      assert.equal(typeof row.title, "string");
      assert.ok(row.title.length > 0, `${site.id} row ${row.tid} has an empty title`);
    }
    for (const field of site.listMetaFields) {
      assert.ok(field in rows[0], `${site.id} rows must carry declared meta field ${field}`);
    }
  }
});

test("article URLs validate against their own site and reject others", () => {
  for (const site of registry.all()) {
    assert.equal(site.validateArticleUrl(site.topicUrl("42"), "42"), true);
    assert.equal(site.validateArticleUrl(site.topicUrl("42"), "43"), false);
    assert.equal(site.validateArticleUrl("https://example.com/t/42", "42"), false);
    for (const other of registry.all()) {
      if (other.id === site.id) continue;
      assert.equal(
        site.validateArticleUrl(other.topicUrl("42"), "42"),
        false,
        `${site.id} accepted a ${other.id} URL`,
      );
    }
  }
});

test("linuxdo filters category-about topics", () => {
  const linuxdo = registry.require("linuxdo");
  assert.equal(linuxdo.filterListRow({ title: "关于“前沿快讯”类别" }), false);
  assert.equal(linuxdo.filterListRow({ title: "类别说明" }), false);
  assert.equal(linuxdo.filterListRow({ title: "日方拆完宇树机器人" }), true);
});

test("external-link extraction drops same-site and asset URLs", () => {
  const v2ex = registry.require("v2ex");
  const html = `<a href="https://www.v2ex.com/t/1">self</a>
    <a href="https://cdn.v2ex.com/avatar.png">asset</a>
    <a href="https://example.com/post">keep</a>
    <a href="https://example.com/post">dupe</a>`;
  assert.deepEqual(v2ex.extractLinks(html), ["https://example.com/post"]);
});
