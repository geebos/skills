---
name: git-commit
description: Generate Git commit messages following the Conventional Commits specification. Use when the user wants to create commits, generate commit messages, or mentions "commit", "conventional commit", or needs to write commit messages.
---

# Git Commit Message Generator

## Quick start

Generate a commit message by analyzing staged changes (`git diff --staged`) and crafting a conventional commit.

## Format

```
<type>(<scope>): <subject>

[optional body]
[optional footer]
```

## Rules

### type (required)

Must be one of:

```
feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert
```

### scope (optional)

The affected module or feature name, in lowercase English.

### subject (required)

A concise, clear description of the change. Max 50 characters. No leading capital letter. No trailing period.

### body (optional)

Motivation for the change and details of what was modified. Each line max 72 characters.

### footer (optional)

Use for `BREAKING CHANGE:` notices or issue references (e.g., `Closes #123`).

## Multiple Change Types

When changes span multiple types, create separate commits in the order listed above.

## Workflow

### Step 1: Review staged changes

```bash
git diff --staged
```

Examine what files and changes are staged. If nothing is staged, run `git status` first.

### Step 2: Inspect commit history

```bash
git log --oneline -10
```

Identify the repo's commit conventions — prefix style, language, verb form, etc.

### Step 3: Stage files (if needed)

Only stage related changes together. Use one of:

```bash
# Stage specific files
git add path/to/file1 path/to/file2

# Stage all changes in current directory
git add .

# Stage all tracked files
git add -u
```

**Never** blindly use `git add .` — always review what's being staged first.

### Step 4: Determine type and scope

Example categorizations:

| Change | Type | Example scope |
|---|---|---|
| New feature | `feat` | `api`, `auth`, `ui` |
| Bug fix | `fix` | `parser`, `login`, `cache` |
| Docs only | `docs` | `readme`, `api-docs` |
| Code style | `style` | `lint`, `formatting` |
| Refactor | `refactor` | `utils`, `hooks` |
| Performance | `perf` | `queries`, `rendering` |
| Tests | `test` | `unit`, `e2e` |
| Build/CI | `build` / `ci` | `webpack`, `docker` |
| Chores | `chore` | `deps`, `config` |
| Revert | `revert` | — |

### Step 5: Draft the commit message

Example messages:

```
feat(auth): add OAuth2 login support
fix(parser): handle empty input gracefully
refactor(utils): extract date formatting helper
docs(readme): update installation instructions
chore(deps): bump lodash to 4.17.21
```

### Step 6: Present for review

Show the drafted message and wait for user approval. The **only** commit command to use is:

```bash
git commit -m "<type>(<scope>): <subject>" -m "<optional body>"
```

Or for multi-line messages:

```bash
git commit -m "feat(auth): add OAuth2 login support" \
  -m "Implements authorization code grant flow.
Requires client_id and client_secret configuration."
```

## Forbidden commands

**Never** use any of these unless the user explicitly requests:

- `git commit --amend` — rewrites history
- `git commit --no-verify` / `-n` — skips hooks
- `git push` / `git push --force` / `git push -f`
- `git rebase` / `git reset` / `git cherry-pick` / `git stash`
- `git tag` / `git branch -D` / `git clean`
- Any command with `--force`, `-f`, `--hard`, or `--delete`

## Tips

- Default working directory is the current directory
- Never commit without user approval — show the message first
- If no changes are staged, remind the user to stage files first
- Keep commits focused: one logical change per commit
