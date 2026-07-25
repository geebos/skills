# Site summary contract

每个站点 agent 只写自己的 `site-summary.json`。总控 agent 是
`summary.json`、分类卡片、跨站关联和全局排序的唯一负责人。

## Schema

```json
{
  "schemaVersion": 1,
  "site": "linuxdo",
  "dateYmd": "20260726",
  "generatedAt": "2026-07-26T10:00:00Z",
  "globalNotes": [],
  "risks": [],
  "items": [
    {
      "id": "linuxdo-2633331",
      "sourceId": "2633331",
      "source": "linuxdo",
      "title": "标题",
      "blurb": "一句话推荐理由",
      "direction": "dev",
      "directionName": "开发与自建",
      "links": [
        {
          "label": "主帖",
          "url": "https://linux.do/t/topic/2633331"
        }
      ],
      "coverage": {
        "declaredPosts": 54,
        "scrapedPosts": 9,
        "status": "capped",
        "note": "达到默认抓取上限"
      },
      "analysis": [
        "包含正文核心数字、步骤、专有名词和证据边界的详细总结。"
      ],
      "facts": [],
      "opinions": [],
      "validity": "事实来源与未核验项",
      "conclusion": "明确、克制的结论",
      "tags": [],
      "siteMeta": {
        "section": "develop",
        "depth": 1
      }
    }
  ]
}
```

## Required fields

顶层必填：

- `schemaVersion`: 固定为 `1`
- `site`: `linuxdo` / `v2ex` / `jisilu`
- `dateYmd`: 八位日期，必须与目录及 `list.json`、`deep.json` 一致
- `generatedAt`: ISO 时间
- `items`: 数组

条目必填：

- `id`: 固定为 `<site>-<sourceId>`，禁止 A1、D1 等局部编号
- `sourceId`: 对应 `deep.json` 中的 `tid`
- `source`: 必须等于顶层 `site`
- `title`、`blurb`、`direction`、`directionName`
- `links`: 至少包含一个与站点及 `sourceId` 一致的 HTTP(S) 主帖
- `coverage`: 从 `deep[].post_coverage` 机械转换，不凭印象填写
- `analysis`: 非空字符串或非空字符串数组
- `validity`、`conclusion`

`globalNotes`、`risks`、`facts`、`opinions`、`tags`、`siteMeta` 可选。

## Coverage

```json
{
  "declaredPosts": 54,
  "scrapedPosts": 9,
  "status": "complete",
  "note": ""
}
```

- `status` 只能为 `complete`、`capped`、`partial`、`unknown`。
- `declaredPosts` 可为 `null`；`scrapedPosts` 必须为非负整数。
- `partial` / `unknown` 必须写非空 `note`，并在顶层 `globalNotes` 说明。
- `complete` 允许 `scrapedPosts >= declaredPosts`；其他已知总数的状态应满足
  `scrapedPosts < declaredPosts`。

## Site provenance

| site | 主帖 URL |
| --- | --- |
| `linuxdo` | `https://linux.do/t/topic/<sourceId>` |
| `v2ex` | `https://www.v2ex.com/t/<sourceId>` |
| `jisilu` | `https://www.jisilu.cn/question/<sourceId>` |

选入条目的 `sourceId` 必须存在于同目录 `deep.json`。`siteMeta.depth` 只允许
`1` 或 `2`。V2EX 与集思录分别把首次出现的 tab / 分类写到
`siteMeta.section`。

## Content rules

- `direction` 使用短 kebab-case；站点 agent 提供候选分类，总控 agent 最终归一化。
- `analysis` 可用 `**加粗**`、HTTP(S) 链接、行内代码、GFM 表格和纯列表；
  不写 raw HTML。
- 明确区分事实与观点，不把评论猜测写成事实。
- 不记录可滥用凭据。
- 财经内容在 `validity` 中注明数据来源和未核验项，在 `conclusion` 中写明
  “不构成投资建议”。
