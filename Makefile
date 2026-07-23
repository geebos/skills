.PHONY: add sync

SKILLS_NPM_CACHE ?= $(if $(TMPDIR),$(TMPDIR),/tmp/)skills-npm-cache
SYNC_HOME ?= $(HOME)

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

%:
	@:
