# Technical document review protocol

## Contents

1. Role boundaries
2. Review model
3. Technical-point standard
4. Issue and status rules
5. Append-only round schema
6. Git semantics
7. Recovery protocol
8. Completion gates

## 1. Role boundaries

### Coordinator

The coordinator may create, resume, replace, message, wait for, and stop agents. It passes factual state only: paths, branch, commits, round, issue IDs, completed phase, and worker outputs.

It must not:

- identify or write review findings;
- answer an issue or select a technical solution;
- edit either document;
- verify a solution;
- change an issue status;
- decide that an issue is closed;
- create the round commit.

### Review Agent

The Review Agent owns review judgment, the review record, verification, and the round commit. It must inspect the current technical document on every scan and inspect the actual document diff on every verification.

It must not edit the technical document, overwrite history, accept an answer without checking the document, or close an issue with missing boundaries or verification.

### Answer Agent

The Answer Agent owns technical conclusions and technical-document edits. It appends answer events to the review document but never overwrites earlier records.

It must not close issues, write reviewer conclusions, create the round commit, or respond only with acknowledgements such as “已确认”, “后续处理”, or “实现时决定”.

## 2. Review model

Treat the review document as an append-only event log.

- Define a new issue exactly once under the round that discovered it.
- Never reuse an issue ID.
- Append later answers, verification results, corrections, and status transitions under the current round.
- Derive the current issue status from its latest status event.
- Correct historical errors with a new correction event. Never edit the old event.
- Start issue IDs at `R001` and increase monotonically.
- Start conclusion IDs at `C001` and increase monotonically.

Use these terminal states:

- `已关闭`

Use these non-terminal states:

- `待处理`
- `处理中`
- `已回复`
- `已修改`
- `部分处理`
- `暂不处理`
- `待复核`
- `需进一步确认`

Only the reviewer may append a transition to `已关闭`.

## 3. Technical-point standard

Split the document by independent implementation decisions. Typical independent points include:

- authentication method;
- field type or schema rule;
- timeout;
- retry trigger, count, and interval;
- error handling;
- transaction boundary;
- consistency model;
- cache location and expiry;
- dependency failure or degradation;
- deployment topology;
- log content and retention;
- data retention period.

Do not combine separate decisions into a vague umbrella statement.

For every technical point, require one currently effective conclusion that states:

1. adopted solution;
2. rejected solution or explicitly states that no alternative is in scope;
3. applicable scope;
4. non-applicable scope;
5. prerequisites;
6. key constraints;
7. error, failure, and degradation behavior;
8. verification or acceptance method.

Flag expressions such as `可以`, `建议`, `推荐`, `尽量`, `原则上`, `视情况而定`, `按需处理`, `根据实际情况决定`, `必要时`, `合理设置`, `适当调整`, and `后续确定` when they affect behavior, boundaries, or acceptance. Permit them only when followed by objective conditions and one deterministic outcome for every condition.

Cross-check body text, examples, tables, diagrams, sequence diagrams, API definitions, appendices, configuration examples, and pseudocode. A conflict in any representation is a review issue.

### Undecided points

A key decision must not remain undecided at completion. Before completion, an undecided point must record:

- question and current status;
- why it cannot yet be decided;
- candidates and their differences;
- accountable owner;
- decision deadline;
- required inputs;
- temporary conclusion;
- exception reason and follow-up process, if an explicit exemption is requested.

Missing owner, deadline, required input, or temporary conclusion is invalid. `部分处理`, `暂不处理`, and `需进一步确认` always continue into the next round.

## 4. Issue and status rules

Every new issue definition must contain:

- issue ID and title;
- technical point;
- discovery round;
- discovery commit;
- current document wording;
- problem;
- risk or impact;
- reviewer recommendation;
- deterministic conclusion required;
- initial status `待处理`.

Every Answer event must contain:

- round;
- final technical conclusion;
- rejected solution;
- applicable and non-applicable scope;
- prerequisites;
- exception or degradation behavior;
- verification method;
- document edit locations;
- exact edit summary;
- resulting status `待复核`, or a documented non-terminal blocker.

Every verification event must contain:

- round;
- whether the conclusion is unique, explicit, executable, and verifiable;
- whether scope, prerequisites, constraints, and failures are complete;
- whether conflicts remain;
- whether the Answer record matches the document;
- whether new conflicts were introduced;
- verification conclusion and next requirement;
- final status;
- closing commit reference when closed.

The reviewer must not close an issue when the document was not edited, alternatives remain, wording is still discretionary, scope is missing, implementation judgment is required, representations conflict, or verification is unspecified.

Create a new issue ID for a newly discovered problem. Do not hide it inside an existing issue.

## 5. Append-only round schema

Append exactly one top-level section per round:

```markdown
## Review Round N

- Review 起始 Commit：<hash>
- 本轮完成 Commit：本记录所在 Commit
- Review Agent：technical_doc_reviewer
- Answer Agent：technical_doc_answerer
- 当前技术文档版本：<hash-before-round>

### 本轮新增问题
### 本轮确定的技术结论
### 历史问题状态变更
### Answer 处理记录
### Review 复核结论
### 本轮未关闭问题
```

Keep all seven subsections even when a subsection contains only `- 无`.

In a later round, do not duplicate an issue definition. Append new Answer and verification events keyed by its existing issue ID.

Use a correction event:

```markdown
> 更正记录（Round N）：Round 1 中 R003 的文档修改位置记录有误；正确位置为“缓存失效策略”章节。原记录保留。
```

The final round may append:

```markdown
## Review Completed

- 最终状态：已完成
- 总 Review 轮次：N
- 已审阅技术点数量：<count>
- 已确定技术结论数量：<count>
- 已关闭问题数量：<count>
- 未决技术点数量：0
- 最终技术文档 Commit：本次最终轮次 Commit
- 最终 Review 文档 Commit：本记录所在 Commit
- 完成时间：<ISO-8601 timestamp with timezone>
```

## 6. Git semantics

### Branch

Start from the latest allowed base branch and use `review/<document-name>`. Both workers remain in the same worktree and branch. Run them sequentially.

### Round commit

The reviewer creates the commit only after scan, answer, document edit, verification, record append, and status update all finish. Stage only the technical document and its review document.

Use:

```text
docs(<document-name>): complete review round <N>
```

Do not squash multiple rounds on the review branch. The branch history and review event log jointly form the audit record.

### Self-referential commit fields

A Git commit hash covers the file content, so a file cannot contain the hash of the commit that contains that file. Use:

- `本记录所在 Commit` for a closing or review-document commit field;
- `本次最终轮次 Commit` for the last commit that changes the technical document.

Resolve either value after commit with:

```bash
git log -1 --format=%H -- review-<document-name>.md
git log -1 --format=%H -- <document-name>.md
```

This symbolic value is a deterministic reference, not a placeholder.

## 7. Recovery protocol

The coordinator maintains a handoff snapshot after each valid worker result:

```yaml
document: path/to/name.md
review_document: path/to/review-name.md
branch: review/name
round: 2
head_commit: "<hash>"
completed_phase: answer
open_issue_ids: [R004]
review_agent_thread: "<id>"
answer_agent_thread: "<id>"
```

On failure, first resume the original thread from the incomplete phase. If that thread is unavailable, start a new agent of the same type and pass the snapshot plus the latest valid result and current file state. An exception never completes a phase.

## 8. Completion gates

Only the reviewer may declare completion, and only when all are true:

- every independent technical point has one effective conclusion;
- all scopes, prerequisites, constraints, failures, and verification methods are explicit;
- body, examples, tables, diagrams, APIs, appendices, configuration, and pseudocode agree;
- every issue's latest state is `已关闭`;
- a fresh scan finds no new issue;
- every round has one complete round commit;
- the completion block is appended;
- the review branch has no uncommitted changes after the final commit;
- the validator passes in `complete` mode.

Completion does not authorize a merge. Follow repository policy and obtain any required user authorization.
