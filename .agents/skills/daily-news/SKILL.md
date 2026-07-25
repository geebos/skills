---
name: daily-news
description: >
  用 browser-mcp 分别扫描 Linux.do、V2EX 与集思录，由三个站点 agent 独立完成
  列表筛选、深读、核验和站点摘要，再由总控 agent 合并为结构化 JSON 与 HTML 日报。
  Use when the user asks to 跑 daily-news、每日调研、三站日报、linux.do 日报、
  V2EX 日报、集思录日报，或更新 docs/daily 下的合并日报。
---

# daily-news

称呼操作者为 **主人**；自称 **俺** / **Me**。从仓库根目录执行。

## 产物

只生成以下文件：

| 负责方 | 文件 |
| --- | --- |
| Linux.do agent | `docs/daily/linuxdo/YYYYMMDD/{list,deep,site-summary}.json` |
| V2EX agent | `docs/daily/v2ex/YYYYMMDD/{list,deep,site-summary}.json` |
| 集思录 agent | `docs/daily/jisilu/YYYYMMDD/{list,deep,site-summary}.json` |
| 总控 agent | `docs/daily/YYYYMMDD/{summary.json,summary.html}` |

不要生成分方向 Markdown、持仓文件或策略文件。

## 必读

- 启动站点 agent 前阅读 [references/categories.md](references/categories.md)。
- 编写或校验 `site-summary.json` 前阅读
  [references/site-summary-contract.md](references/site-summary-contract.md)。

## 总控工作流

### 1. 准备

1. 确定分析日：Asia/Shanghai `YYYYMMDD`，允许 `DATE=` 覆盖。
2. 确认 browser-mcp 扩展已连接；脚本默认等待 120 秒。
3. 设置 `BROWSER_MCP_TOKEN`。脚本首次运行时会在技能目录安装依赖。

### 2. 分发三个站点 agent

创建三个独立 agent，每个 agent 只负责一个站点及其目录：

| agent | site | script |
| --- | --- | --- |
| Linux.do | `linuxdo` | `scripts/scrape_linuxdo.mjs` |
| V2EX | `v2ex` | `scripts/scrape_v2ex.mjs` |
| 集思录 | `jisilu` | `scripts/scrape_jisilu.mjs` |

向每个 agent 传递相同任务契约，仅替换 `<site>` 与 `<script>`：

```text
处理 <site> 的 YYYYMMDD 日报切片。只操作
docs/daily/<site>/YYYYMMDD/。
1. 运行 <script> --mode list。
2. 读 list.json，按价值、时效和信息密度选 tids；按 tid 去重。
3. 运行 --mode deep --tids ... --max-depth 2。
4. 核验 coverage；partial 优先重试，unknown 必须说明。
5. 按 references/site-summary-contract.md 写 site-summary.json。
6. 运行 merge_site_summaries.mjs --validate <path>。
完成后只回报条目数、产物路径、partial/unknown 与风险；不要写总 summary。
```

默认串行执行抓取，避免共享浏览器扩展和礼貌限速相互干扰。`deep.json` 已存在时，
三个 agent 可并行做筛选、核验和摘要。

### 3. 站点 agent 处理规则

每个站点 agent 必须：

1. 跳过类别说明、零信息刷帖和纯广告。
2. 同站按 `tid` 去重，保留首次出现的 tab/分类。
3. 不只按回复数排序；优先当日新帖和有可核事实的帖子。
4. 同质内容只选 1–2 个代表帖深读。
5. `partial` 提高 `COOKED_LIMIT` 后重试；仍不完整则写入 `globalNotes`。
6. 共享账号、注册机、公开 key 等只做风险描述，不写凭据。
7. 集思录及其他财经内容标明数据来源、未核验项和“不构成投资建议”。

抓取命令：

```bash
node .agents/skills/daily-news/scripts/scrape_linuxdo.mjs --mode list
node .agents/skills/daily-news/scripts/scrape_v2ex.mjs --mode list
node .agents/skills/daily-news/scripts/scrape_jisilu.mjs --mode list

node .agents/skills/daily-news/scripts/scrape_linuxdo.mjs \
  --mode deep --tids 2633331,2633318 --max-depth 2
```

限定扫描范围时分别使用 `--categories`、`--tabs`、`--categories`。遇到非标准
DOM 时才使用 `custom --url <url> --xpath "<xpath>"`。

### 4. 总控合并

等待三个站点 agent 完成后运行：

```bash
node .agents/skills/daily-news/scripts/merge_site_summaries.mjs \
  --date YYYYMMDD
```

合并脚本负责校验契约、拒绝跨站链接和重复 ID、格式化 coverage，并生成初始
`directionCards`。总控 agent 随后只做跨站工作：

1. 归一化同义 `direction`，动态保留 3–6 个当日分类。
2. 合并同一事件，补 `crossLinks`，但保留各站独立来源。
3. 按推荐优先级重排 `items`；不要按站点分块。
4. 汇总 `globalNotes` 和 `risks`，核对所有事件引用的 `itemId`。

### 5. 渲染与验收

```bash
node .agents/skills/daily-news/scripts/render_summary.mjs \
  --in docs/daily/YYYYMMDD/summary.json \
  --out docs/daily/YYYYMMDD/summary.html
```

检查：

- 三个 `site-summary.json` 均通过 `--validate`。
- `summary.json` 每条都有 `source`，ID 全局唯一。
- HTML 顺序为分类卡片 → 推荐列表 → 同序详析，来源徽章正确。
- `analysis` 含正文核心数字、步骤或专有名词；不只复述标题。
- `partial/unknown`、未独立核验项和投资边界在成品中可见。

最后向主人报告 HTML 路径、各站条数、主旋律、缺口与风险。

## 抓取约束

browser-mcp only；`active=false`；serial + 礼貌延时；复用单 tab；结束关闭 tab。
最大探索深度为 2。不要全站无差别抓取，不要使用 Playwright。
