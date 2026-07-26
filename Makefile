.PHONY: add sync sync-agents

SKILLS_NPM_CACHE ?= $(if $(TMPDIR),$(TMPDIR),/tmp/)skills-npm-cache
SYNC_HOME ?= $(HOME)
CLAUDE_AGENTS_DIR ?= $(SYNC_HOME)/.claude/agents
AGENT_FILES := $(wildcard .agents/skills/*/agents/*.md)

# Usage:
#   make add vercel-labs/agent-skills
#   make add vercel-labs/agent-skills --skill skill-creator
#   make import vercel-labs/agent-skills --skill skill-creator

add:
	@if [ -z "$(word 2,$(MAKECMDGOALS))" ]; then \
		echo "Usage:"; \
		echo "  make $@ <github-org/repo> [skills args...]"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make $@ vercel-labs/agent-skills"; \
		echo "  make $@ vercel-labs/agent-skills --skill skill-creator"; \
		exit 1; \
	fi
	npx --yes skills add "$(word 2,$(MAKECMDGOALS))" \
		--agent claude-code \
		--copy \
		$(wordlist 3,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
	@echo "Done. Skills are in ./.agents"

sync:
	mkdir -p "$(SYNC_HOME)/.agents" "$(SYNC_HOME)/.claude" "$(SYNC_HOME)/.pi"
	cp AGENTS.md "$(SYNC_HOME)/.agents/AGENTS.md"
	ln -sfn ../.agents/AGENTS.md "$(SYNC_HOME)/.claude/claude.md"
	ln -sfn ../.agents/AGENTS.md "$(SYNC_HOME)/.pi/AGENTS.md"
	npm_config_cache="$(SKILLS_NPM_CACHE)" npx --yes skills update --global --yes

# Copy every skill's agent markdown definitions into ~/.claude/agents
sync-agents:
	@mkdir -p "$(CLAUDE_AGENTS_DIR)"
	@if [ -z "$(AGENT_FILES)" ]; then \
		echo "no agent definitions found under .agents/skills/*/agents/" >&2; \
		exit 1; \
	fi
	@for src in $(AGENT_FILES); do \
		cp "$$src" "$(CLAUDE_AGENTS_DIR)/$$(basename $$src)"; \
		echo "copied $$src -> $(CLAUDE_AGENTS_DIR)/$$(basename $$src)"; \
	done
	@# Drop legacy Codex toml copies if present
	@rm -f \
		"$(CLAUDE_AGENTS_DIR)/technical-doc-review-coordinator.toml" \
		"$(CLAUDE_AGENTS_DIR)/technical-doc-reviewer.toml" \
		"$(CLAUDE_AGENTS_DIR)/technical-doc-answerer.toml"
	@echo "Done. Claude agents are in $(CLAUDE_AGENTS_DIR)"

%:
	@:
