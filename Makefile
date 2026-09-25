.DEFAULT_GOAL := dev
.PHONY: install dev start build preview clean

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

clean:
	rm -rf dist node_modules
