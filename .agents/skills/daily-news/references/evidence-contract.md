# Evidence contract

文章识别阶段的产物。回答的是「这些帖里有什么可核查的内容」，
不是「今天该怎么看这件事」——后者属于深度解读阶段。

## Shape

`evidence save --run <id> --file <file>` 接受：

```json
{
  "evidence": [
    {
      "siteId": "v2ex",
      "sourceId": "1229854",
      "facts": ["正文给出报错码 E42 与版本 1.8.3"],
      "opinions": ["多数回复认为是驱动导致，未给出证据"],
      "numbers": ["冷启动 1.8s（作者自测，单机，未说明硬件）"],
      "links": ["https://example.com/issue/1"],
      "validityNotes": "capped：仅读前 9 层；数字为作者自测未独立复现"
    }
  ]
}
```

也接受顶层直接是数组。

## Fields

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `siteId` / `sourceId` | 是 | 本轮必须已有对应的 article 快照，否则被拒 |
| `facts` | 否 | 正文/评论中**明确写出**的内容 |
| `opinions` | 否 | 推断、主张、倾向；注明是谁的观点 |
| `numbers` | 否 | 数字连同口径与出处 |
| `links` | 否 | 帖内外链，去重 |
| `validityNotes` | 否 | 覆盖缺口与未核验项；`partial` / `unknown` 时必填 |

## Fact vs opinion

这是本阶段唯一最重要的约束。

- `facts` 只能写帖子里**明确写出来**的内容。
- 任何推断、猜测、「看起来像」「应该是」都进 `opinions`。
- 评论区的猜测**不是**事实，即使很多人这么说。
- 拿不准就放 `opinions`。宁可弱化，也不要制造事实。

## Coverage

来自抓取脚本的 `post_coverage`，机械转换，不凭印象填写：

| status | 含义 | 要求 |
| --- | --- | --- |
| `complete` | 抓到的楼层 ≥ 声明楼层 | — |
| `capped` | 达到 `COOKED_LIMIT` 上限 | 说明只覆盖前 N 层 |
| `partial` | 低于上限却仍不完整 | 提高 `COOKED_LIMIT` 重试一次；仍不全则写明缺口 |
| `unknown` | 解析不到楼层总数 | 必须说明原因 |

## Safety

共享账号、注册机、公开 key 等只做风险描述，**不记录任何可用凭据**。

## Idempotency

按 `(run_id, site_id, source_id)` upsert，重跑安全。
只能在 `article` 阶段处于 `running` 时写入。
