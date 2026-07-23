---
name: technical-doc-review
description: Run a strict, append-only technical-document review with one persistent Review Agent and one persistent Answer Agent. Use when reviewing architecture documents, RFCs, ADRs, API specifications, runbooks, deployment designs, or other Markdown technical documents that must converge on unique, explicit, executable, and verifiable decisions with per-round Git commits and a durable review audit trail.
---

# Technical Document Review

Use two persistent worker agents and a coordinator. Keep the roles separate:

- `technical_doc_reviewer`: inspect the technical document, append review issues, verify actual document changes, close eligible issues, and commit a completed round.
- `technical_doc_answerer`: answer open issues, edit the technical document, remove conflicts, append answer records, and move issues to `待复核`.
- `technical_doc_review_coordinator`: route work, preserve context, resume or replace failed workers, and stop when the reviewer reports completion. Never perform reviewer or answerer work.

Read [references/review-protocol.md](references/review-protocol.md) before starting. Copy [assets/review-document-template.md](assets/review-document-template.md) when creating a review document.

## Establish scope

1. Resolve exactly one technical document for the review run.
2. Derive `<document-name>` from its filename without `.md`.
3. Use `review-<document-name>.md` in the same directory unless the repository specifies another location.
4. Refuse ambiguous document selection. Do not review multiple documents in one agent pair.
5. Check repository instructions and Git status. Preserve unrelated user changes.

## Prepare the branch

Have the first reviewer invocation perform the branch preflight:

1. Require a clean worktree.
2. Switch to `main`.
3. Pull the latest `main`.
4. Create and switch to `review/<document-name>`.
5. Record the starting commit with `git rev-parse HEAD`.

If repository policy requires a different base branch or branch naming rule, follow the repository policy and record the deviation in the review document. Never review directly on `main`.

## Run the state machine

Run agents sequentially because both append to the same review document.

```text
REVIEW_SCAN
  -> ANSWER
  -> REVIEW_VERIFY_AND_COMMIT
  -> REVIEW_SCAN (when any issue remains open or a new issue is found)
  -> REVIEW_COMPLETE (only when every completion gate passes)
```

The calling agent starts one `technical_doc_review_coordinator` and gives it the resolved document path plus repository policy. The coordinator owns the remaining dispatch loop. If the custom coordinator is unavailable, the calling agent may perform only the coordinator duties defined here; it still must delegate all review, answer, editing, verification, status, and round-commit work.

For Round 1, the coordinator starts one `technical_doc_reviewer`, waits for its branch preflight and scan, and then starts one `technical_doc_answerer`. Reuse those exact worker threads for every later round.

1. Send the reviewer the document paths, branch, round number, starting commit, and current unresolved issue IDs.
2. Wait for `REVIEW_RESULT`.
3. Send the answerer the same context plus the reviewer result.
4. Wait for `ANSWER_RESULT`.
5. Send the answer result back to the original reviewer for verification.
6. Require the reviewer to inspect the actual diff, append verification events, update derived status, run the validator, and create the round commit.
7. Continue only from the reviewer result after the commit.

Do not run reviewer and answerer concurrently. Do not let the coordinator edit either Markdown file, invent conclusions, change statuses, or commit a round.

## Require result envelopes

Require workers to end each turn with one machine-readable fenced block.

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

Treat a missing, malformed, or contradictory envelope as an incomplete agent step.

## Recover agents

When an agent errors, times out, is interrupted, or exits without a valid result:

1. Resume the same agent thread with the last completed phase, current branch, `HEAD`, document paths, round number, open issue IDs, and its incomplete responsibility.
2. Do not advance the state machine.
3. If the same thread cannot continue, start a replacement of the same agent type and provide the full handoff context.
4. Never substitute the coordinator or the other worker type.

## Validate and commit

Before every round commit, have the reviewer run:

```bash
python3 .agents/skills/technical-doc-review/scripts/validate_review.py \
  <document-name>.md review-<document-name>.md --mode round
```

Commit one complete round:

```bash
git add <document-name>.md review-<document-name>.md
git commit -m "docs(<document-name>): complete review round <round-number>"
```

Do not use `git add .`. A round commit must contain both documents and no unrelated files.

Git commits cannot contain their own hash. For fields that refer to the commit containing the field, write `本记录所在 Commit`; resolve the exact hash with `git log`, as defined in the protocol.

## Finish

Allow the reviewer to append `Review Completed` only when every completion gate in the protocol passes. Then require:

```bash
python3 .agents/skills/technical-doc-review/scripts/validate_review.py \
  <document-name>.md review-<document-name>.md --mode complete
```

The reviewer commits the final round before returning `phase: complete`. The coordinator then reports the branch and final commit and stops.

Merge only when the caller authorizes it and repository policy permits it. Use the repository's merge procedure; when the `merge-worktree` skill applies, follow it. Keep the review document in `main`.
