import { Editor, EditorPosition, Plugin, MarkdownView, PluginSettingTab, Setting, App } from "obsidian";

interface EmacsKeyRepeatSettings {
	enableKeyRepeat: boolean;
	keyRepeatDelay: number;
	keyRepeatInterval: number;
}

const DEFAULT_SETTINGS: EmacsKeyRepeatSettings = {
	enableKeyRepeat: true,
	keyRepeatDelay: 500,  // Initial delay before repeat starts (ms)
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

export default class EmacsTextEditorPlugin extends Plugin {
	settings: EmacsKeyRepeatSettings;
	pluginTriggerSelection = false;
	disableSelectionWhenPossible = false;

	// Key repeat state handling
	private activeKeyRepeats: Map<string, { timeoutId: number; intervalId?: number }> = new Map();

	async onload() {
		console.log("loading plugin: Emacs text editor");

		await this.loadSettings();

		this.addSettingTab(new EmacsKeyRepeatSettingTab(this.app, this));

		this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
			// Existing selection interruption logic
			if (isEventInterruptSelection(e)) {
				this.disableSelectionWhenPossible = true;
				this.pluginTriggerSelection = false;
			}

			if (this.settings.enableKeyRepeat) {
				this.handleKeyRepeat(e);
			}
		});

		// Register keyup listener to stop key repeat
		this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
			const keyId = this.getKeyId(e);
			this.stopKeyRepeat(keyId);
		});

		// Stop all repeats on window focus change (prevents stuck keys)
		this.registerDomEvent(window, "blur", () => {
			this.stopAllKeyRepeats();
		});

		// Stop repeats when switching between notes
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.stopAllKeyRepeats();
		}));

		this.addCommand({
			id: "forward-char",
			name: "Forward char",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executeForwardChar(editor);
			},
		});

		this.addCommand({
			id: "backward-char",
			name: "Backward char",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executeBackwardChar(editor);
			},
		});

		this.addCommand({
			id: "next-line",
			name: "Next line",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executeNextLine(editor);
			},
		});

		this.addCommand({
			id: "previous-line",
			name: "Previous line",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executePreviousLine(editor);
			},
		});

		this.addCommand({
			id: "forward-word",
			name: "Forward word",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executeForwardWord(editor);
			},
		});

		this.addCommand({
			id: "backward-word",
			name: "Backward word",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.executeBackwardWord(editor);
			},
		});

		this.addCommand({
			id: "move-end-of-line",
			name: "Move end of line",
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
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					editor.exec("goStart");
				});
			},
		});

		this.addCommand({
			id: "end-of-buffer",
			name: "End of buffer",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					editor.exec("goEnd");
				});
			},
		});

		this.addCommand({
			id: "kill-line",
			name: "Kill line",
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
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withDeleteInText(editor, () => {
					editor.exec("goWordRight");
				});
			},
		});

		this.addCommand({
			id: "backward-kill-word",
			name: "Backward kill word",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.withDeleteInText(editor, () => {
					editor.exec("goWordLeft");
				});
			},
		});

		this.addCommand({
			id: "kill-ring-save",
			name: "Kill ring save",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.putSelectionInClipboard(editor, CopyCut.Copy);
			},
		});

		this.addCommand({
			id: "kill-region",
			name: "Kill region",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.putSelectionInClipboard(editor, CopyCut.Cut);
			},
		});

		this.addCommand({
			id: "yank",
			name: "Yank",
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
			editorCallback: (editor: Editor, _: MarkdownView) => {
				this.disableSelection(editor);
			},
		});

		this.addCommand({
			id: "undo",
			name: "Undo",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				editor.undo();
			},
		});

		this.addCommand({
			id: "redo",
			name: "Redo",
			editorCallback: (editor: Editor, _: MarkdownView) => {
				editor.redo();
			},
		});

		this.addCommand({
			id: "recenter-top-bottom",
			name: "Recenter",
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
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.moveToNextParagraph(editor, Direction.Forward);
				});
			},
		});

		this.addCommand({
			id: "backward-paragraph",
			name: "Backward paragraph",
			editorCallback: async (editor: Editor, _: MarkdownView) => {
				this.withSelectionUpdate(editor, () => {
					this.moveToNextParagraph(editor, Direction.Backward);
				});
			},
		});
	}

	onunload() {
		console.log("unloading plugin: Emacs text editor");
		// Clean up any active key repeats
		this.stopAllKeyRepeats();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.settings.keyRepeatDelay = Math.max(50, Math.min(2000, this.settings.keyRepeatDelay));
		this.settings.keyRepeatInterval = Math.max(10, Math.min(1000, this.settings.keyRepeatInterval));
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private handleKeyRepeat(e: KeyboardEvent) {
		// Only handle events when focused in a markdown editor
		if (!this.isInValidEditorContext()) {
			return;
		}

		const keyId = this.getKeyId(e);
		const handler = this.getRepeatHandler(e);

		if (handler) {
			e.preventDefault();
			e.stopPropagation();

			// Prevent duplicate registrations
			if (this.activeKeyRepeats.has(keyId)) {
				return;
			}

			try {
				handler();
			} catch (error) {
				console.error('Key repeat handler error:', error);
				return;
			}

			// Repetition after configured delay
			const timeoutId = window.setTimeout(() => {
				const intervalId = window.setInterval(() => {
					// Re-validate context before each repeat (prevents stuck keys)
					if (this.isInValidEditorContext() && this.activeKeyRepeats.has(keyId)) {
						try {
							handler();
						} catch (error) {
							console.error('Key repeat interval error:', error);
							this.stopKeyRepeat(keyId);
						}
					} else {
						// Context changed, stop repeating
						this.stopKeyRepeat(keyId);
					}
				}, this.settings.keyRepeatInterval);

				const repeatState = this.activeKeyRepeats.get(keyId);
				if (repeatState) {
					repeatState.intervalId = intervalId;
				}
			}, this.settings.keyRepeatDelay);

			this.activeKeyRepeats.set(keyId, { timeoutId });
		}
	}

	private isInValidEditorContext(): boolean {
		const activeLeaf = this.app.workspace.activeLeaf;
		return !!(activeLeaf?.view instanceof MarkdownView && activeLeaf.view.editor);
	}

	private getKeyId(e: KeyboardEvent): string {
		const modifiers = [];
		if (e.ctrlKey) modifiers.push('ctrl');
		if (e.altKey) modifiers.push('alt');
		if (e.shiftKey) modifiers.push('shift');
		if (e.metaKey) modifiers.push('meta');
		return [...modifiers, e.key.toLowerCase()].join('+');
	}

	private getRepeatHandler(e: KeyboardEvent): (() => void) | null {
		const activeLeaf = this.app.workspace.activeLeaf;
		if (!(activeLeaf?.view instanceof MarkdownView)) return null;

		const editor = activeLeaf.view.editor;

		// Only repeat movement commands that benefit from repetition
		if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
			switch (e.key.toLowerCase()) {
				case 'f': return () => this.executeForwardChar(editor);
				case 'b': return () => this.executeBackwardChar(editor);
				case 'n': return () => this.executeNextLine(editor);
				case 'p': return () => this.executePreviousLine(editor);
			}
		}
		if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
			switch (e.key.toLowerCase()) {
				case 'f': return () => this.executeForwardWord(editor);
				case 'b': return () => this.executeBackwardWord(editor);
			}
		}
		return null;
	}

	private stopKeyRepeat(keyId: string) {
		const repeatState = this.activeKeyRepeats.get(keyId);
		if (repeatState) {
			// Clear timeout if it exists
			if (repeatState.timeoutId) {
				clearTimeout(repeatState.timeoutId);
			}
			// Clear interval if it exists  
			if (repeatState.intervalId) {
				clearInterval(repeatState.intervalId);
			}
			this.activeKeyRepeats.delete(keyId);
		}
	}

	private stopAllKeyRepeats() {
		// Robust cleanup - stop all active repeats
		this.activeKeyRepeats.forEach(({ timeoutId, intervalId }) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (intervalId) clearInterval(intervalId);
		});
		this.activeKeyRepeats.clear();
	}

	// Extract command execution methods to reuse logic
	private executeForwardChar(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goRight");
		});
	}

	private executeBackwardChar(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goLeft");
		});
	}

	private executeNextLine(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goDown");
		});
	}

	private executePreviousLine(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goUp");
		});
	}

	private executeForwardWord(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goWordRight");
		});
	}

	private executeBackwardWord(editor: Editor) {
		this.withSelectionUpdate(editor, () => {
			editor.exec("goWordLeft");
		});
	}

	// All existing methods remain unchanged
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
			.setDesc(`Time before key repeat starts (50-2000ms). Current: ${this.plugin.settings.keyRepeatDelay}ms`)
			.addSlider(slider => slider
				.setLimits(50, 2000, 50)
				.setValue(this.plugin.settings.keyRepeatDelay)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.keyRepeatDelay = value;
					await this.plugin.saveSettings();
					// Update description
					slider.sliderEl.parentElement?.parentElement
						?.querySelector('.setting-item-description')
						?.setText(`Time before key repeat starts (50-2000ms). Current: ${value}ms`);
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
				this.plugin.settings.keyRepeatDelay = 250;
				this.plugin.settings.keyRepeatInterval = 25;
				await this.plugin.saveSettings();
				this.display();
			});
	}
}