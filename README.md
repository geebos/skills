# skills

Personal agent skill management using the [skills](https://github.com/anomalyco/opencode) system. Skills are versioned and tracked via `skills-lock.json`, and can be imported from GitHub repositories using the provided Makefile.

## Referenced Skills

### [mattpocock/skills](https://github.com/mattpocock/skills)

- **caveman** — Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping full technical accuracy.
- **diagnose** — Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test.
- **grill-me** — Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree.
- **grill-with-docs** — Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise.
- **handoff** — Compact the current conversation into a handoff document for another agent to pick up.
- **improve-codebase-architecture** — Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/.
- **prototype** — Build a throwaway prototype to flesh out a design before committing to it. Routes between a runnable terminal app or several radically different UI variations.
- **setup-matt-pocock-skills** — Sets up an agent skills block in AGENTS.md/CLAUDE.md and docs/agents/ so the engineering skills know the repo's issue tracker, triage labels, and domain doc layout.
- **tdd** — Test-driven development with red-green-refactor loop.
- **to-issues** — Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices.
- **to-prd** — Turn the current conversation context into a PRD and publish it to the project issue tracker.
- **triage** — Triage issues through a state machine driven by triage roles.
- **write-a-skill** — Create new agent skills with proper structure, progressive disclosure, and bundled resources.
- **zoom-out** — Tell the agent to zoom out and give broader context or a higher-level perspective.

## Usage

```bash
# Import all skills from a GitHub repository
make import mattpocock/skills

# Import a specific skill from a repository
make import vercel-labs/agent-skills --skill skill-creator
```
