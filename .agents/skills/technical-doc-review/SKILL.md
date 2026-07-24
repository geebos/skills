---
name: technical-doc-review
description: 以严格的追加-only 方式评审技术文档：固定一名 Review Agent 与一名 Answer Agent。适用于架构文档、RFC、ADR、API 规范、runbook、部署设计等 Markdown 技术文档，要求收敛到唯一、明确、可执行、可验证的结论，并按轮次提交 Git 与保留完整评审审计记录。
---

# 技术文档评审

## 硬规则（先读）

读完本 skill 后，**你只做启动器**，不做评审循环。

| 允许 | 禁止 |
|------|------|
| 解析文档、分支预检、复制评审模板骨架 | 自己扫描问题、写 Answer、写 Review、改技术文档结论 |
| **启动恰好一个** `technical_doc_review_coordinator` 子 agent | 自己调度 worker；启动多个 coordinator；并行开多个 reviewer/answerer |
| **阻塞等待**协调者跑完全流程后返回最终 branch / commit 并转述 | 自己跑 `validate_review.py`、自己 `git commit` 轮次 |
| 用户明确要求合并时再合并 | 协调者仍在跑或仅中间态时「代行 verify/scan」；仅当协调者**进程启动失败或已确认死亡**且用户同意才可按 coordinator.toml 代行 |

状态机、恢复、worker 提示写法**只**在协调者 agent 文件里。不要把那些步骤抄进本会话自己执行。

协调者若中途回复「等待 reviewer / 是否代行 verify」而**没有** `phase: complete` 或终端失败快照：视为协调者未遵守阻塞规则——**resume 同一协调者线程**，令其从快照继续（通常是 verify），不要立刻在本会话代行。

Agent 定义：

- [agents/technical-doc-review-coordinator.toml](agents/technical-doc-review-coordinator.toml) ← 唯一调度入口
- [agents/technical-doc-reviewer.toml](agents/technical-doc-reviewer.toml)
- [agents/technical-doc-answerer.toml](agents/technical-doc-answerer.toml)

模板（仅预检时复制骨架用）：[assets/review-document-template.md](assets/review-document-template.md)

`references/review-protocol.md` 给 **reviewer / answerer** 读，**不要**在本会话按它做评审。

---

## 启动步骤

### 1. 定范围

1. 解析**恰好一份**技术文档；不明确就停问。
2. `<document-name>` = 文件名去掉 `.md`。
3. 评审文档默认：同目录 `review-<document-name>.md`。
4. 保留无关用户改动。

### 2. 分支预检（仅此由你做）

1. 工作区干净（或仅含已说明的目标文档）。
2. 切到基线（默认 `main`）并 `git pull`。
3. `git switch -c review/<document-name>`（续跑则 `git switch` 已有分支）。
4. `START_COMMIT=$(git rev-parse HEAD)`。
5. 禁止在基线上直接评审。

### 3. 评审文档骨架

- **不存在**：从模板复制，只填基本信息 + Round 1 的起始/技术文档 Commit（`$START_COMMIT`）。**不要**预填问题、Answer、Review、结论。
- **已存在**：不覆盖历史；确认已在正确 review 分支。

### 4. 交接给协调者（必须）

立即启动 **一个** 子 agent，类型/名称：`technical_doc_review_coordinator`（按其 [toml](agents/technical-doc-review-coordinator.toml) 加载指令）。

首条消息**只**给事实，例如：

```text
document: <绝对或仓库相对路径>
review_document: <路径>
branch: review/<document-name>
starting_commit: <START_COMMIT>
base_branch: main
merge_authorized: false
```

然后：

1. **停止**本会话的评审工作。
2. **等待**该子 agent 跑完并返回最终 `branch` + `head_commit`（或失败原因）。
3. 把结果报告给用户。

不要在本会话再 spawn reviewer/answerer，除非协调者进程**启动失败**（agent 类型不存在/无法创建）。仅在那时：告知用户，并询问是否由你按 coordinator.toml **全文**代行调度；未经同意不得代行。

### 5. 合并

默认不合并。仅当用户明确授权且仓库策略允许时，用仓库流程（适用时 `merge-worktree`）。
