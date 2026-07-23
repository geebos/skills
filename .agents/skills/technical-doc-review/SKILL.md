---
name: technical-doc-review
description: 以严格的追加-only 方式评审技术文档：固定一名 Review Agent 与一名 Answer Agent。适用于架构文档、RFC、ADR、API 规范、runbook、部署设计等 Markdown 技术文档，要求收敛到唯一、明确、可执行、可验证的结论，并按轮次提交 Git 与保留完整评审审计记录。
---

# 技术文档评审

使用三名角色，职责严格分离：

| Agent | 职责 |
|-------|------|
| `technical_doc_review_coordinator` | 解析范围、调度串行循环、恢复失败 worker、汇总结果。不评审、不回答、不编辑、不提交。 |
| `technical_doc_reviewer` | 分支预检、扫描问题、核实 Answer、关闭问题、校验并提交轮次。 |
| `technical_doc_answerer` | 回答未关闭问题、编辑技术文档、追加 Answer。 |

操作细则分别写在：

- [agents/technical-doc-review-coordinator.toml](agents/technical-doc-review-coordinator.toml)
- [agents/technical-doc-reviewer.toml](agents/technical-doc-reviewer.toml)
- [agents/technical-doc-answerer.toml](agents/technical-doc-answerer.toml)

文档结构与完成门禁见 [references/review-protocol.md](references/review-protocol.md)。评审文档模板见 [assets/review-document-template.md](assets/review-document-template.md)。

## 启动

1. 解析**恰好一份**待评审技术文档；选择不明确时拒绝。
2. 由文件名去掉 `.md` 得到 `<document-name>`；评审文档默认同目录 `review-<document-name>.md`（仓库另有规定时从其规定）。
3. 检查 Git 状态，保留无关用户改动。若评审文档尚不存在，从模板复制并填入基本信息占位（不要预填结论）。
4. 启动**一个** `technical_doc_review_coordinator`，传入：
   - 技术文档路径
   - 评审文档路径
   - 仓库策略（基线分支、是否允许合并等）
5. 由协调者调度 `technical_doc_reviewer` 与 `technical_doc_answerer` 直至完成；调用方不再自行扫描、回答、核实或提交。
6. 协调者报告完成（分支、最终 commit）后停止。仅在用户明确授权且仓库策略允许时合并；合并走仓库既定流程（适用时用 `merge-worktree`）。

若自定义协调者不可用，调用方**仅**可代行协调职责，且必须把全部评审、回答、编辑、核实、状态与轮次提交委托给对应 worker agent。
