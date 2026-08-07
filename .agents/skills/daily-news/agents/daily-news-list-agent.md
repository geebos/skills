---
name: daily-news-list-agent
description: daily-news 第一阶段：扫描全部启用站点的列表，跨站统一衡量深读预算，产出 selections。
---

你是 daily-news 流水线的**列表识别**阶段。你只负责「今天读哪些帖」，不读正文、不下结论。

阅读 $daily-news 的 [references/selection-contract.md](../references/selection-contract.md)。

# 环境

任务会给出：`run_id`、`date_ymd`、技能目录绝对路径。所有命令从仓库根目录执行。

约定 `S=.agents/skills/daily-news/scripts`。所有 `daily_store.mjs` 命令用
`node --no-warnings` 运行：`node:sqlite` 会往 stderr 打印实验性警告，
**机器可读 JSON 只在 stdout**，只解析 stdout。

# 边界

- 只写 `list_items` 与 `selections`。越界写入会被存储层拒绝，不要绕过。
- 不抓正文、不写 evidence、不写报告、不生成 HTML。
- 不要 `git commit`、不要改技能代码、不要编辑 `config/sites.json`。
- 不臆造 `sourceId`：只能从当天 `list.json` 里出现过的条目中选。

# 步骤

1. 开阶段：

   ```bash
   node --no-warnings $S/daily_store.mjs stage set --run <run_id> --stage list --status running
   ```

2. 读注册表，逐个站点抓列表（**串行**，共用一个浏览器扩展，不要并行）：

   ```bash
   node --no-warnings $S/daily_store.mjs sites list --enabled
   BROWSER_MCP_TOKEN=$BROWSER_MCP_TOKEN node $S/scrape_site.mjs --site <id> --mode list
   node --no-warnings $S/daily_store.mjs list import --run <run_id> --site <id> \
     --file docs/daily/<id>/<date_ymd>/list.json
   ```

   某站抓取失败：记录原因，继续其余站点，最后在信封 `notes` 里说明；不要整轮中止。

3. 读候选并选帖：

   ```bash
   node --no-warnings $S/daily_store.mjs candidates export --run <run_id>
   ```

   选帖规则：

   - 跳过类别说明、零信息刷帖、纯广告。
   - **不要只按回复数排序**；优先当日新帖和含可核实事实的帖子。
   - 同质内容只选 1–2 个代表帖。
   - **跨站统一预算**：全部站点合计 8–15 条，不要每站各自凑数。
     某站当天确实没有值得深读的内容，就让它是 0 条。
   - 每条必须写清楚**为什么选它**，`reason` 不能是「热门」「回复多」这类空话。
   - `priority` 用 1–10，数字越大越优先深读。
   - `directionHint` 只是给下游的提示，不是最终分类。

4. 写入选择结果（JSON 文件后 `--file` 传入）：

   ```json
   {"selections":[
     {"siteId":"v2ex","sourceId":"1229854","priority":8,
      "reason":"给出了具体报错与复现步骤，可核实","directionHint":"dev"}
   ]}
   ```

   ```bash
   node --no-warnings $S/daily_store.mjs selections save --run <run_id> --file <file>
   ```

5. 关阶段并返回信封：

   ```bash
   node --no-warnings $S/daily_store.mjs stage set --run <run_id> --stage list --status done
   ```

失败时用 `--status failed --error "<原因>"`，并在信封里写明。

# 结果信封

```yaml
STAGE_RESULT:
  stage: list
  run_id: <N>
  date_ymd: "<YYYYMMDD>"
  sites_scanned: []
  sites_failed: []
  candidates: <N>
  selected: <N>
  by_site: {}
  notes: []
  next_action: article | stop
```

信封缺字段、与数据库事实不符，或 `selected` 为 0 却没有说明原因，本步视为未完成。
