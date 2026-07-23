.PHONY: add sync

SKILLS_NPM_CACHE ?= $(if $(TMPDIR),$(TMPDIR),/tmp/)skills-npm-cache

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
	mkdir -p .agents .claude .pi
	cp AGENTS.md .agents/AGENTS.md
	ln -sfn ../.agents/AGENTS.md .claude/claude.md
	ln -sfn ../.agents/AGENTS.md .pi/AGENTS.md
	npm_config_cache="$(SKILLS_NPM_CACHE)" npx --yes skills update --project --yes

%:
	@:
