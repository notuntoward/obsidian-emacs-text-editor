TARGET_DIR_PATH = ${OBSIDIAN_PLUGINS_DIR}/emacs-text-editor

build:
	npm run build

install: build
	mkdir -p ${TARGET_DIR_PATH}
	cp main.js manifest.json ${TARGET_DIR_PATH}

uninstall:
	rm -rf ${TARGET_DIR_PATH}
