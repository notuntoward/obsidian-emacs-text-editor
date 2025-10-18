import { Editor, EditorPosition, Plugin, MarkdownView, PluginSettingTab, Setting, App } from "obsidian";

interface EmacsKeyRepeatSettings {
	enableKeyRepeat: boolean;
	keyRepeatDelay: number;
	keyRepeatInterval: number;
}

const DEFAULT_SETTINGS: EmacsKeyRepeatSettings = {
	enableKeyRepeat: true,
	keyRepeatDelay: 500, // Initial delay before repeat starts (ms)
	keyRepeatInterval: 50, // Interval between repeats (ms)
};

enum Direction {
	Forward,
	Backward,
}

enum CopyCut {
	Copy,
	Cut,
}

const insertableSpecialKeys = [
	"Comma",
	"Period",
	"Slash",
	"Semicolon",
	"Quote",
	"BracketLeft",
	"BracketRight",
	"Backslash",
	"Backquote",
	"Minus",
	"Equal",
];

export default class EmacsTextEditorPlugin extends Plugin {
	settings: EmacsKeyRepeatSettings;
	pluginTriggerSelection = false;
	disableSelectionWhenPossible = false;

	private currentRepeatTimeouts: Map<string, { timeoutId: number; intervalId?: number }> = new Map();

    // async so can wait for settings before full init
	async onload() {
		console.log("loading plugin: Emacs text editor");

		await this.loadSettings();
		this.addSettingTab(new EmacsKeyRepeatSettingTab(this.app, this));

                // DOM so timer events + residual listeners cleared if unload plugin
		this.registerDomEvent(document, "keydown", (e) => {
			if (isEventInterruptSelection(e)) {
				this.disableSelectionWhenPossible = true;
				this.pluginTriggerSelection = false;
			}

			if (this.settings.enableKeyRepeat) {
				this.handleKeyRepeat(e);
			}
		});

        // Things that stop repeat

        // stop holding a key down
		this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
			const keyId = this.getKeyId(e);
			this.stopKeyRepeat(keyId);
		});

		// change window focus
		this.registerDomEvent(window, "blur", () => {
			this.stopAllKeyRepeats();
		});

		// defocus current editor
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.stopAllKeyRepeats();
		}));

		this.addCommand({
			id: "forward-char",
			name: "Forward char",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'f' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveForwardOneChar(editor);
			},
		});

		this.addCommand({
			id: "backward-char",
			name: "Backward char",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'b' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveBackOneChar(editor);
			},
		});

		this.addCommand({
			id: "next-line",
			name: "Next line",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'n' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveNextLine(editor);
			},
		});

		this.addCommand({
			id: "previous-line",
			name: "Previous line",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'p' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.movePreviousLine(editor);
			},
		});

		this.addCommand({
			id: "forward-word",
			name: "Forward word",
			hotkeys: [{ modifiers: ['Alt'], key: 'f' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveForwardOneWord(editor);
			},
		});

		this.addCommand({
			id: "backward-word",
			name: "Backward word",
			hotkeys: [{ modifiers: ['Alt'], key: 'b' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.moveBackOneWord(editor);
			},
		});

		this.addCommand({
			id: "move-end-of-line",
			name: "Move end of line",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'e' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					const cursor = editor.getCursor();
					const lineContent = editor.getLine(cursor.line);
					editor.setCursor({
						line: cursor.line,
						ch: lineContent.length,
					});
				});
			},
		});

		this.addCommand({
			id: "move-beginning-of-line",
			name: "Move cursor to beginning of line",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'a' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					const cursor = editor.getCursor();
					editor.setCursor({ line: cursor.line, ch: 0 });
				});
			},
		});

		this.addCommand({
			id: "beginning-of-buffer",
			name: "Beginning of buffer",
			hotkeys: [{ modifiers: ['Alt', 'Shift'], key: ',' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					editor.exec("goStart");
				});
			},
		});

		this.addCommand({
			id: "end-of-buffer",
			name: "End of buffer",
			hotkeys: [{ modifiers: ['Alt', 'Shift'], key: '.' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					editor.exec("goEnd");
				});
			},
		});

		this.addCommand({
			id: "kill-line",
			name: "Kill line",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'k' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.disableSelection(editor);

				const cursor = editor.getCursor();
				const lineContent = editor.getLine(cursor.line);
				if (lineContent === "") {
					editor.exec("deleteLine");
				} else {
					editor.setSelection(cursor, {
						line: cursor.line,
						ch: lineContent.length,
					});
					this.putSelectionInClipboard(editor, CopyCut.Cut);
					editor.setCursor(cursor);
				}
			},
		});

		this.addCommand({
			id: "delete-char",
			name: "Delete char",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'd' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.disableSelection(editor);

				this.withDeleteInText(editor, () => {
					editor.exec("goRight");
				});
			},
		});

		this.addCommand({
			id: "kill-word",
			name: "Kill word",
			hotkeys: [{ modifiers: ['Alt'], key: 'd' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withDeleteInText(editor, () => {
					editor.exec("goWordRight");
				});
			},
		});

		this.addCommand({
			id: "backward-kill-word",
			name: "Backward kill word",
			hotkeys: [{ modifiers: ['Alt'], key: 'Backspace' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withDeleteInText(editor, () => {
					editor.exec("goWordLeft");
				});
			},
		});

		this.addCommand({
			id: "kill-ring-save",
			name: "Kill ring save",
			hotkeys: [{ modifiers: ['Alt'], key: 'w' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.putSelectionInClipboard(editor, CopyCut.Copy);
			},
		});

		this.addCommand({
			id: "kill-region",
			name: "Kill region",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'w' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.putSelectionInClipboard(editor, CopyCut.Cut);
			},
		});

		this.addCommand({
			id: "yank",
			name: "Yank",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'y' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				const clipboardContent = await navigator.clipboard.readText();
				const cursor = editor.getCursor();

				if (!this.getCurrentSelectionStart(editor)) {
					editor.replaceRange(clipboardContent, cursor);
				} else {
					editor.replaceSelection(clipboardContent);
					this.disableSelection(editor);
				}

				editor.setCursor(
					cursor.line,
					cursor.ch + clipboardContent.length,
				);
				document.dispatchEvent(new ClipboardEvent("paste"));
			},
		});

		this.addCommand({
			id: "set-mark-command",
			name: "Set mark command",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'Space' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				if (this.pluginTriggerSelection) {
					this.disableSelection(editor);
				} else {
					this.pluginTriggerSelection = true;
				}
				this.disableSelectionWhenPossible = false;
			},
		});

		this.addCommand({
			id: "keyboard-quit",
			name: "Keyboard-quit",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'g' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.disableSelection(editor);
			},
		});

		this.addCommand({
			id: "undo",
			name: "Undo",
			hotkeys: [{ modifiers: ['Ctrl'], key: '/' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				editor.undo();
			},
		});

		this.addCommand({
			id: "redo",
			name: "Redo",
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: '-' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				editor.redo();
			},
		});

		this.addCommand({
			id: "recenter-top-bottom",
			name: "Recenter",
			hotkeys: [{ modifiers: ['Ctrl'], key: 'l' }],
			editorCallback: (editor: Editor, _: MarkdownView) => {
				const cursor = editor.getCursor();
				const range = {
					from: { line: cursor.line, ch: cursor.ch },
					to: { line: cursor.line, ch: cursor.ch },
				};
				editor.scrollIntoView(range, true);
			},
		});

		this.addCommand({
			id: "forward-paragraph",
			name: "Forward paragraph",
			hotkeys: [{ modifiers: ['Alt', 'Shift'], key: ']' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.moveToNextParagraph(editor, Direction.Forward);
				});
			},
		});

		this.addCommand({
			id: "backward-paragraph",
			name: "Backward paragraph",
			hotkeys: [{ modifiers: ['Alt', 'Shift'], key: '[' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.moveToNextParagraph(editor, Direction.Backward);
				});
			},
		});

		this.addCommand({
			id: 'upcase-word',
			name: 'Upcase word',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformWordAtCursor(editor, word => word.toUpperCase());
			}
		});

		this.addCommand({
			id: 'downcase-word',
			name: 'Downcase word',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformWordAtCursor(editor, word => word.toLowerCase());
			}
		});

		this.addCommand({
			id: 'capitalize-word',
			name: 'Capitalize word',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformWordAtCursor(editor, capitalizeOneWord);
			}
		});

		this.addCommand({
			id: 'upcase-region',
			name: 'Upcase region',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.transformSelection(editor, word => word.toUpperCase());
				});
			}
		});

		this.addCommand({
			id: 'downcase-region',
			name: 'Downcase region',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.transformSelection(editor, word => word.toLowerCase());
				});
			}
		});

		this.addCommand({
			id: 'capitalize-region',
			name: 'Capitalize region',
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.transformSelection(editor, capitalizeWords);
				});
			}
		});

		this.addCommand({
			id: 'upcase-dwim',
			name: 'Upcase dwim',
			hotkeys: [{ modifiers: ['Alt'], key: 'u' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformDWIM(editor, word => word.toUpperCase());
			}
		});

		this.addCommand({
			id: 'downcase-dwim',
			name: 'Downcase dwim',
			hotkeys: [{ modifiers: ['Alt'], key: 'l' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformDWIM(editor, word => word.toLowerCase());
			}
		});

		this.addCommand({
			id: 'capitalize-dwim',
			name: 'Capitalize dwim',
			hotkeys: [{ modifiers: ['Alt'], key: 'c' }],
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.transformDWIM(editor, capitalizeOneWord, capitalizeWords);
			}
		});
	}

	onunload() {
		console.log("unloading plugin: Emacs text editor");
		this.stopAllKeyRepeats();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.keyRepeatDelay = Math.max(25, Math.min(2000, this.settings.keyRepeatDelay));
		this.settings.keyRepeatInterval = Math.max(10, Math.min(1000, this.settings.keyRepeatInterval));
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	handleKeyRepeat(keyEvent: KeyboardEvent) {
		if (!this.isInActiveEditor()) {
			return;
		}

		const keyId = this.getKeyId(keyEvent);
		const keyMoveFunc = this.getKeyMoveFunc(keyEvent);

		if (keyMoveFunc) {
			keyEvent.preventDefault();
			keyEvent.stopPropagation();

			if (this.currentRepeatTimeouts.has(keyId)) {
				return;
			}

			try {
				keyMoveFunc();  // 1st key movement
			} catch (error) {
				console.error('Key move function error:', error);
				return;
			}

			// Following delay after 1st key movement, do repeated key movements at intervals
			const timeoutId = window.setTimeout(() => {
				const intervalId = window.setInterval(() => {
					if (this.isInActiveEditor() && this.currentRepeatTimeouts.has(keyId)) {
						// Still in editor and still repeating
						try {
							keyMoveFunc();
						} catch (error) {
							console.error('Key repeat interval error:', error);
							this.stopKeyRepeat(keyId);
						}
					} else {
						this.stopKeyRepeat(keyId);
					}
				}, this.settings.keyRepeatInterval);

				const repeatState = this.currentRepeatTimeouts.get(keyId);
				if (repeatState) {
					repeatState.intervalId = intervalId;
				}
			}, this.settings.keyRepeatDelay);

			this.currentRepeatTimeouts.set(keyId, { timeoutId });
		}
	}

	isInActiveEditor(): boolean {
		const markdownView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
		return !!(markdownView && markdownView.editor);
	}

	getKeyId(e: KeyboardEvent): string {
		const modifiers = [];
		if (e.ctrlKey) modifiers.push('ctrl');
		if (e.altKey) modifiers.push('alt');
		if (e.shiftKey) modifiers.push('shift');
		if (e.metaKey) modifiers.push('meta');
		return [...modifiers, e.key.toLowerCase()].join('+');
	}

	getKeyMoveFunc(e: KeyboardEvent): (() => void) | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return null;

		const editor = activeView.editor;

		if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
			switch (e.key.toLowerCase()) {
				case 'f': return () => this.moveForwardOneChar(editor);
				case 'b': return () => this.moveBackOneChar(editor);
				case 'n': return () => this.moveNextLine(editor);
				case 'p': return () => this.movePreviousLine(editor);
			}
		}
		if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
			switch (e.key.toLowerCase()) {
				case 'f': return () => this.moveForwardOneWord(editor);
				case 'b': return () => this.moveBackOneWord(editor);
			}
		}
		return null;
	}

	stopKeyRepeat(keyId: string) {
		const timeout = this.currentRepeatTimeouts.get(keyId);
		if (timeout) {
			if (timeout.timeoutId) {
				clearTimeout(timeout.timeoutId);
			}
			if (timeout.intervalId) {
				clearInterval(timeout.intervalId);
			}
			this.currentRepeatTimeouts.delete(keyId);
		}
	}

	stopAllKeyRepeats() {
		this.currentRepeatTimeouts.forEach(({ timeoutId, intervalId }) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (intervalId) clearInterval(intervalId);
		});
		this.currentRepeatTimeouts.clear();
	}

	moveForwardOneChar(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goRight");
		});
	}

	moveBackOneChar(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goLeft");
		});
	}

	moveNextLine(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goDown");
		});
	}

	movePreviousLine(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goUp");
		});
	}

	moveForwardOneWord(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goWordRight");
		});
	}

	moveBackOneWord(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goWordLeft");
		});
	}

	disableSelection(editor: Editor) {
		editor.setSelection(editor.getCursor(), editor.getCursor());
		this.pluginTriggerSelection = false;
		this.disableSelectionWhenPossible = false;
	}

	withSelectionUpdate(editor: Editor, callback: () => void) {
		if (this.disableSelectionWhenPossible) {
			this.disableSelection(editor);
		}

		const currentSelectionStart = this.getCurrentSelectionStart(editor);
		if (currentSelectionStart) {
			editor.setSelection(editor.getCursor());
		}

		callback();

		if (currentSelectionStart) {
			editor.setSelection(currentSelectionStart, editor.getCursor());
		}
	}

	getCurrentSelectionStart(editor: Editor): EditorPosition | undefined {
		const selections = editor.listSelections();

		if (selections.length == 0) {
			return undefined;
		}

		if (
			selections[0].anchor.line !== selections[0].head.line ||
			selections[0].anchor.ch !== selections[0].head.ch
		) {
			return selections[0].anchor;
		}

		if (this.pluginTriggerSelection) {
			return selections[0].anchor;
		}

		return undefined;
	}

	withDeleteInText(editor: Editor, callback: () => void) {
		const cursorBefore = editor.getCursor();

		callback();

		const cursorAfter = editor.getCursor();

		editor.setSelection(cursorBefore, cursorAfter);

		this.putSelectionInClipboard(editor, CopyCut.Cut);
	}

	putSelectionInClipboard(editor: Editor, mode: CopyCut) {
		if (!this.getCurrentSelectionStart(editor)) {
			return;
		}

		navigator.clipboard.writeText(editor.getSelection());

		if (mode == CopyCut.Copy) {
			document.dispatchEvent(new ClipboardEvent("copy"));
		} else if (mode == CopyCut.Cut) {
			editor.replaceSelection("");
			document.dispatchEvent(new ClipboardEvent("cut"));
		}

		this.disableSelection(editor);
	}

	moveToNextParagraph(editor: Editor, direction: Direction) {
		const cursor = editor.getCursor();
		const value = editor.getValue();
		const maxOffset = value.length;
		const currentOffset = editor.posToOffset(cursor);

		if (
			(direction === Direction.Forward && currentOffset >= maxOffset) ||
			(direction === Direction.Backward && currentOffset === 0)
		) {
			return;
		}

		let nextParagraphOffset =
			direction === Direction.Forward ? maxOffset : 0;
		let foundText = false;
		let foundFirstBreak = false;

		function isNewLine(position: number, direction: Direction): boolean {
			if (direction === Direction.Forward) {
				return (
					value[position] === "\n" ||
					(value[position] === "\r" && value[position + 1] === "\n")
				);
			} else {
				return (
					value[position] === "\n" ||
					(position > 0 &&
						value[position - 1] === "\r" &&
						value[position] === "\n")
				);
			}
		}

		const step = direction === Direction.Forward ? 1 : -1;
		let i = currentOffset;

		while (
			(direction === Direction.Forward && i < maxOffset) ||
			(direction === Direction.Backward && i > 0)
		) {
			if (foundText && isNewLine(i, direction)) {
				if (foundFirstBreak) {
					nextParagraphOffset =
						direction === Direction.Forward ? i : i + 1;
					if (
						(direction === Direction.Forward &&
							value[i] === "\r") ||
						(direction === Direction.Backward &&
							i > 0 &&
							value[i - 1] === "\r")
					) {
						nextParagraphOffset +=
							direction === Direction.Forward ? 1 : -1;
					}
					break;
				} else {
					foundFirstBreak = true;
					i += step;
					continue;
				}
			} else {
				foundFirstBreak = false;
			}

			if (value[i] !== "\n" && value[i] !== "\r" && value[i] !== " ") {
				foundText = true;
			}

			i += step;
		}

		const newPos = editor.offsetToPos(nextParagraphOffset);
		editor.setCursor(newPos);
	}

	transformWordAtCursor(
		editor: Editor,
		transform: (word: string) => string
	) {
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		let ch = cursor.ch;

		// Find word boundaries
		while (ch < line.length && !/\w/.test(line[ch])) {
			ch++;
		}
		const start = ch;
		while (ch < line.length && /\w/.test(line[ch])) {
			ch++;
		}
		const end = ch;

		const word = line.substring(start, end);
		const newWord = transform(word);
		const range = {
			from: { line: cursor.line, ch: start },
			to: { line: cursor.line, ch: end }
		};
		editor.replaceRange(newWord, range.from, range.to);
		editor.setCursor(cursor.line, end);
	}

	transformSelection(
		editor: Editor,
		transform: (word: string) => string
	) {
		const selection = editor.getSelection();
		if (!selection) {
			return;
		}

		const transformedSelection = transform(selection);
		editor.replaceSelection(transformedSelection);
		this.disableSelection(editor);
	}

	transformDWIM(
		editor: Editor,
		transformOneWord: (word: string) => string,
		transformWords?: (text: string) => string
	) {
		if (editor.getSelection()) {
			this.transformSelection(editor, transformWords ? transformWords : transformOneWord);
		} else {
			this.transformWordAtCursor(editor, transformOneWord);
		}
	}
}

class EmacsKeyRepeatSettingTab extends PluginSettingTab {
	plugin: EmacsTextEditorPlugin;

	constructor(app: App, plugin: EmacsTextEditorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Emacs Key Repeat Settings' });

		new Setting(containerEl)
			.setName('Enable key repeat')
			.setDesc('Allow cursor movement keys to repeat when held down')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableKeyRepeat)
				.onChange(async (value) => {
					this.plugin.settings.enableKeyRepeat = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Initial delay')
			.setDesc(`Time before key repeat starts (25-1000ms). Current: ${this.plugin.settings.keyRepeatDelay}ms`)
			.addSlider(slider => slider
				.setLimits(25, 1000, 50)
				.setValue(this.plugin.settings.keyRepeatDelay)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.keyRepeatDelay = value;
					await this.plugin.saveSettings();
					// Update description
					slider.sliderEl.parentElement?.parentElement
						?.querySelector('.setting-item-description')
						?.setText(`Time before key repeat starts (0-1000ms). Current: ${value}ms`);
				})
			);

		new Setting(containerEl)
			.setName('Repeat interval')
			.setDesc(`Time between repeats (10-1000ms). Current: ${this.plugin.settings.keyRepeatInterval}ms`)
			.addSlider(slider => slider
				.setLimits(10, 1000, 5)
				.setValue(this.plugin.settings.keyRepeatInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.keyRepeatInterval = value;
					await this.plugin.saveSettings();
					// Update description 
					slider.sliderEl.parentElement?.parentElement
						?.querySelector('.setting-item-description')
						?.setText(`Time between repeats (10-1000ms). Current: ${value}ms`);
				})
			);

		containerEl.createEl('h3', { text: 'Quick Presets' });
		const presetContainer = containerEl.createEl('div', { cls: 'setting-item' });
		const buttonContainer = presetContainer.createEl('div', { cls: 'setting-item-control' });

		buttonContainer.createEl('button', { text: 'Slow' })
			.addEventListener('click', async () => {
				this.plugin.settings.keyRepeatDelay = 750;
				this.plugin.settings.keyRepeatInterval = 100;
				await this.plugin.saveSettings();
				this.display();
			});

		buttonContainer.createEl('button', { text: 'Medium' })
			.addEventListener('click', async () => {
				this.plugin.settings.keyRepeatDelay = 500;
				this.plugin.settings.keyRepeatInterval = 50;
				await this.plugin.saveSettings();
				this.display();
			});

		buttonContainer.createEl('button', { text: 'Fast' })
			.addEventListener('click', async () => {
				this.plugin.settings.keyRepeatDelay = 25;
				this.plugin.settings.keyRepeatInterval = 25;
				await this.plugin.saveSettings();
				this.display();
			});
	}
}

function isEventInterruptSelection(e: KeyboardEvent): boolean {
	let withKeyModifier = e.ctrlKey || e.altKey;
	return (
		e.code == "Backspace" ||
		e.code == "Delete" ||
		(Boolean(e.code.match(/^Key[A-Z]$/)) && !withKeyModifier) ||
		(Boolean(e.code.match(/^Digit[0-9]$/)) && !withKeyModifier) ||
		(Boolean(e.code.match(/^Numpad[0-9]$/)) && !withKeyModifier) ||
		(insertableSpecialKeys.includes(e.code) && !withKeyModifier)
	);
}

function capitalizeOneWord(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function capitalizeWords(selection: string): string {
	const words = selection.split(/\b/);
	const capitalizedWords = words.map(word => {
		if (/\w/.test(word)) {
			return capitalizeOneWord(word);
		}
		return word;
	});
	return capitalizedWords.join('');
}
