# Selection contract

列表识别阶段的产物。回答的是「今天读哪些帖」，不是「这些帖讲了什么」。

## Shape

`selections save --run <id> --file <file>` 接受：

```json
{
  "selections": [
    {
      "siteId": "v2ex",
      "sourceId": "1229854",
      "priority": 8,
      "reason": "给出了具体报错码与复现步骤，可核实",
      "directionHint": "dev"
    }
  ]
}
```

也接受顶层直接是数组。

## Fields

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `siteId` | 是 | 必须是注册表中已启用的站点 id |
| `sourceId` | 是 | 必须存在于本轮该站点的 `list_items`，否则外键拒绝 |
| `priority` | 是 | 1–10 整数，越大越优先深读 |
| `reason` | 是 | 非空。写**为什么值得读**，不接受「热门」「回复多」 |
| `directionHint` | 否 | 短 kebab-case，仅作下游提示，不是最终分类 |

## Budget

深读预算**跨站统一**衡量，全部站点合计 8–15 条。
不要每站各自凑数；某站当天没有值得深读的内容就是 0 条。

## Selection rules

- 跳过类别说明、零信息刷帖、纯广告。
- 不要只按回复数排序；优先当日新帖与含可核实事实的帖子。
- 同质内容只选 1–2 个代表帖。
- 同站按 `sourceId` 去重（`list import` 已按首次出现去重）。

## Idempotency

按 `(run_id, site_id, source_id)` upsert，重跑安全。
只能在 `list` 阶段处于 `running` 时写入。
