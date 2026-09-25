.DEFAULT_GOAL := dev
.PHONY: install dev start build preview deploy clean

# One command to play locally. `make` is an alias for `make dev`.
install:
	npm install

dev: install
	npm run dev

start: dev

build: install
	npm run build

preview: install
	npm run build
	npm run preview

# Publish dist/ to the gh-pages branch (GitHub Pages). Each deploy is a fresh
# single-commit branch, so the history holds nothing but the current build.
deploy: build
	@set -e; sha=$$(git rev-parse --short HEAD); tmp=$$(mktemp -d); \
	cp -R dist/. "$$tmp"; touch "$$tmp/.nojekyll"; \
	cd "$$tmp" && git init -q -b gh-pages && git add -A && \
	git commit -q -m "Deploy from main@$$sha" && \
	git push -f "$$(git -C "$(CURDIR)" remote get-url origin)" gh-pages; \
	rm -rf "$$tmp"

clean:
	rm -rf dist node_modules
