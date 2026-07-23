---
name: technical-doc-review
description: 以严格的追加-only 方式评审技术文档：固定一名 Review Agent 与一名 Answer Agent。适用于架构文档、RFC、ADR、API 规范、runbook、部署设计等 Markdown 技术文档，要求收敛到唯一、明确、可执行、可验证的结论，并按轮次提交 Git 与保留完整评审审计记录。
---

# 技术文档评审

使用两名持久化 worker agent 与一名协调者，角色严格分离：

- `technical_doc_reviewer`：检查技术文档、追加评审问题、核实实际文档修改、关闭合格问题，并提交完整轮次。
- `technical_doc_answerer`：回答未关闭问题、编辑技术文档、消除冲突、追加 Answer 记录，并将问题状态改为 `待复核`。
- `technical_doc_review_coordinator`：路由工作、保留上下文、恢复或替换失败 worker，并在 reviewer 报告完成后停止。绝不执行 reviewer 或 answerer 的工作。

开始前阅读 [references/review-protocol.md](references/review-protocol.md)。创建评审文档时复制 [assets/review-document-template.md](assets/review-document-template.md)。

## 确定范围

1. 本轮评审只解析并使用一份技术文档。
2. 由文件名去掉 `.md` 得到 `<document-name>`。
3. 默认在同目录使用 `review-<document-name>.md`，除非仓库另有规定。
4. 文档选择不明确时拒绝执行。一对 agent 不得同时评审多份文档。
5. 检查仓库说明与 Git 状态。保留无关的用户改动。

## 准备分支

由首次调用的 reviewer 执行分支预检：

1. 要求工作区干净。
2. 切换到 `main`。
3. 拉取最新 `main`。
4. 创建并切换到 `review/<document-name>`。
5. 用 `git rev-parse HEAD` 记录起始 commit。

若仓库策略要求不同的基线分支或命名规则，遵循仓库策略，并在评审文档中记录偏差。禁止直接在 `main` 上评审。

## 运行状态机

因双方都向同一份评审文档追加内容，agent 必须串行运行。

```text
REVIEW_SCAN
  -> ANSWER
  -> REVIEW_VERIFY_AND_COMMIT
  -> REVIEW_SCAN（仍有未关闭问题或发现新问题时）
  -> REVIEW_COMPLETE（仅当全部完成门禁通过时）
```

调用方启动一个 `technical_doc_review_coordinator`，并传入已解析的文档路径与仓库策略。协调者负责后续调度循环。若自定义协调者不可用，调用方只能执行本文定义的协调职责；仍须把全部评审、回答、编辑、核实、状态与轮次提交工作委托出去。

Round 1：协调者启动一个 `technical_doc_reviewer`，等待其完成分支预检与扫描，再启动一个 `technical_doc_answerer`。后续每一轮复用这两条线程。

1. 向 reviewer 发送文档路径、分支、轮次、起始 commit 与当前未解决问题 ID。
2. 等待 `REVIEW_RESULT`。
3. 向 answerer 发送相同上下文及 reviewer 结果。
4. 等待 `ANSWER_RESULT`。
5. 将 answer 结果回传给原 reviewer 做核实。
6. 要求 reviewer 检查实际 diff、追加核实事件、更新派生状态、运行校验器并创建轮次 commit。
7. 仅在 commit 之后的 reviewer 结果上继续推进。

禁止 reviewer 与 answerer 并发。协调者不得编辑任一 Markdown 文件、发明结论、改状态或提交轮次。

## 要求结果信封

要求 worker 每轮结束时输出一个机器可读的围栏块。

```yaml
REVIEW_RESULT:
  phase: scan | verify | complete
  round: 1
  branch: review/example
  head_commit: "<hash>"
  added_issue_ids: [R001]
  open_issue_ids: [R001]
  closed_issue_ids: []
  next_action: answer | review_next_round | stop
```

```yaml
ANSWER_RESULT:
  round: 1
  branch: review/example
  head_commit: "<hash-before-round-commit>"
  answered_issue_ids: [R001]
  pending_review_issue_ids: [R001]
  blocked_issue_ids: []
  next_action: review_verify
```

缺少、格式错误或与事实矛盾的信封，均视为该步骤未完成。

## 恢复 agent

当 agent 报错、超时、被中断或未返回有效结果时：

1. 用最近完成的阶段、当前分支、`HEAD`、文档路径、轮次、未解决问题 ID 及其未完成职责，恢复同一条 agent 线程。
2. 不得推进状态机。
3. 若原线程无法继续，启动同类型替换 agent，并提供完整交接上下文。
4. 禁止用协调者或另一类 worker 顶替。

## 校验与提交

每轮提交前，由 reviewer 运行：

```bash
python3 .agents/skills/technical-doc-review/scripts/validate_review.py \
  <document-name>.md review-<document-name>.md --mode round
```

提交一个完整轮次：

```bash
git add <document-name>.md review-<document-name>.md
git commit -m "docs(<document-name>): complete review round <round-number>"
```

禁止使用 `git add .`。轮次 commit 必须只包含这两份文档，不得夹带无关文件。

Git commit 无法包含自身 hash。对指向本 commit 的字段写 `本记录所在 Commit`；精确 hash 按协议用 `git log` 解析。

## 结束

仅当协议中全部完成门禁通过时，reviewer 才可追加 `Review Completed`。然后要求：

```bash
python3 .agents/skills/technical-doc-review/scripts/validate_review.py \
  <document-name>.md review-<document-name>.md --mode complete
```

reviewer 在返回 `phase: complete` 前完成最终轮次提交。协调者随后报告分支与最终 commit，并停止。

仅在调用方授权且仓库策略允许时合并。使用仓库既定合并流程；若适用 `merge-worktree` skill，则遵循它。评审文档应保留在 `main`。
