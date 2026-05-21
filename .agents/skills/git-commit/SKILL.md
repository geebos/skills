---
name: git-commit
description: Create Git commits using Conventional Commits. Use when the user asks to commit changes, generate a commit message, or mentions commit, commits, git commit, or conventional commit.
---

# Git Commit

Use Conventional Commits:

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Examples

- No body: `docs: correct spelling in changelog`
- With scope: `feat(lang): add zh-CN locale`
- Breaking change with `!`: `feat(api)!: require signed webhook payloads`
- Breaking change footer:
  ```text
  feat: support shared configuration presets

  BREAKING CHANGE: preset resolution now starts from the project root.
  ```
- Body and footers:
  ```text
  fix: prevent duplicate requests

  Track the latest request id and ignore stale responses.

  Reviewed-by: Core Team
  Refs: #123
  ```

## Rules

- Commit directly when the user asks to commit; do not ask for confirmation.
- If the user only asks for a message, output the message and do not commit.
- Keep one logical change per commit; split large or mixed changes by scope in dependency order.
- Use lowercase scopes; write `description` as an imperative, lowercase summary with no trailing period.
- Use the commands below; avoid alternate git workflows.

## Workflow

### 1. Inspect changes
```bash
# Show changed files and staging state.
git status --short

# Review unstaged changes before deciding commit scope.
git diff

# Review already staged changes.
git diff --staged

# Match the repository's recent commit style when useful.
git log --oneline -5
```

### 2. Plan scopes
```bash
# List changed files to group related changes.
git diff --name-only

# Inspect one file when deciding its scope.
git diff -- path/to/file
```
Commit order example:
```text
build/config -> core logic -> callers/ui -> tests -> docs
```

### 3. Stage one scope
```bash
# Stage only files that belong in the same commit.
git add path/to/file1 path/to/file2

# Check which staged files will be committed.
git diff --staged --stat

# Review staged content before committing.
git diff --staged

# Unstage a file that does not belong in this commit.
git restore --staged path/to/file
```

### 4. Commit directly
```bash
# Commit a simple docs-only change.
git commit -m "docs: correct spelling in changelog"

# Commit a scoped feature.
git commit -m "feat(lang): add zh-CN locale"

# Commit a breaking API change.
git commit -m "feat(api)!: require signed webhook payloads"
```
Choose the matching command form and commit without asking for confirmation.

For a multi-line message, use one `-m` per paragraph. Git inserts blank lines
between `-m` values. Use `$'...\n...'` when one paragraph needs line breaks
without blank lines:
```bash
# Create subject, body, and footer blocks without opening an editor.
git commit \
  -m "fix: prevent duplicate requests" \
  -m $'Track the latest request id.\nIgnore stale responses from older requests.' \
  -m $'Reviewed-by: Core Team\nRefs: #123'
```

### 5. Repeat and verify
```bash
# Confirm remaining uncommitted changes.
git status --short

# Stage the next scope.
git add path/to/next-file

# Commit the next scope.
git commit -m "test(scope): cover changed behavior"

# Verify the new commits.
git log --oneline -5
```

## Safety

Do not run unless the user explicitly asks: `git push`, `git commit --amend`, `git commit --no-verify`, `git rebase`, `git reset`, `git cherry-pick`, `git stash`, `git clean`, or `git tag`.
Do not use commands with `--force`, `-f`, `--hard`, or `--delete`.
