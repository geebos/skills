---
name: technical-doc-review
description: 以严格的追加-only 方式评审技术文档：固定一名 Review Agent 与一名 Answer Agent。适用于架构文档、RFC、ADR、API 规范、runbook、部署设计等 Markdown 技术文档，要求收敛到唯一、明确、可执行、可验证的结论，并按轮次提交 Git 与保留完整评审审计记录。
---

# 技术文档评审

使用三名角色，职责严格分离：

| 角色 | 职责 |
|------|------|
| **调用方（本 skill）** | 解析文档、分支预检、准备评审文档骨架，然后启动协调者。 |
| `technical_doc_review_coordinator` | 调度串行循环、恢复失败 worker、汇总结果。不评审、不回答、不编辑、不提交。 |
| `technical_doc_reviewer` | 扫描问题、核实 Answer、关闭问题、校验并提交轮次。 |
| `technical_doc_answerer` | 回答未关闭问题、编辑技术文档、追加 Answer。 |

操作细则：

- [agents/technical-doc-review-coordinator.toml](agents/technical-doc-review-coordinator.toml)（调度；不要塞进 worker 上下文）
- [agents/technical-doc-reviewer.toml](agents/technical-doc-reviewer.toml)
- [agents/technical-doc-answerer.toml](agents/technical-doc-answerer.toml)

reviewer / answerer 阅读的工作说明与文档约定：

- [references/review-protocol.md](references/review-protocol.md)
- [assets/review-document-template.md](assets/review-document-template.md)

向两名 worker 下发任务时，提示里不要提另一方的名称或职责；只给路径、轮次、问题 ID、阶段，以及需要阅读的文档内容或结果信封原文。

## 启动

### 1. 确定范围

1. 解析**恰好一份**待评审技术文档；选择不明确时拒绝。
2. 由文件名去掉 `.md` 得到 `<document-name>`。
3. 评审文档默认同目录 `review-<document-name>.md`（仓库另有规定时从其规定）。
4. 检查仓库说明；保留无关用户改动。

### 2. 分支预检（由本 skill / 调用方执行，不交给 agent）

1. 要求工作区干净（`git status` 无未提交改动，或仅有将纳入评审的目标文档且已说明）。
2. 切换到基线分支（默认 `main`）。
3. 拉取最新基线：`git pull`。
4. 创建并切换到 `review/<document-name>`：
   ```bash
   git switch -c review/<document-name>
   ```
   若分支已存在且属于本次评审续跑，则 `git switch review/<document-name>` 并确认基线无误。
5. 记录起始 commit：
   ```bash
   git rev-parse HEAD
   ```
6. 禁止在 `main`（或基线分支）上直接评审。仓库策略有不同基线或命名时从其规定，并在评审文档基本信息中注明。

### 3. 准备评审文档

若 `review-<document-name>.md` 尚不存在：从 [assets/review-document-template.md](assets/review-document-template.md) 复制，填入基本信息（技术文档名、Review 文档名、分支、基线、agent 名）与 Round 1 的起始 / 技术文档 Commit（使用上一步 hash）。**不要**预填问题、结论或 Answer/Review 内容。

若评审文档已存在（续跑），不要覆盖历史；确认当前已在正确的 `review/<document-name>` 分支。

### 4. 启动协调者

启动**一个** `technical_doc_review_coordinator`，传入：

- 技术文档路径
- 评审文档路径
- 当前分支名（`review/<document-name>`）
- 起始 commit hash
- 仓库策略（基线分支、是否允许合并等）

由协调者调度 `technical_doc_reviewer` 与 `technical_doc_answerer` 直至完成。调用方**不再**自行扫描、回答、核实或提交轮次。

### 5. 结束

协调者报告完成（分支、最终 commit）后停止。仅在用户明确授权且仓库策略允许时合并；合并走仓库既定流程（适用时用 `merge-worktree`）。

若自定义协调者不可用，调用方**仅**可代行协调职责（调度与恢复），且必须把全部评审、回答、编辑、核实、状态与轮次提交委托给对应 worker agent。分支预检仍由调用方在启动协调前完成。
