// Static guard: Obsidian pop-out windows have their own document/window/navigator. The bare
// globals are the MAIN window's, which broke clipboard commands (the clipboard API rejects
// unfocused documents), and key-repeat (listeners/timers on the wrong window).
// Use activeWindow/activeDocument, or the window the event came from.
//
// Run with: npm test
import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "..", "main.ts"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function check(name: string, fn: () => void) {
	fn();
	passed++;
	console.log(`ok - ${name}`);
}

check("no bare navigator.clipboard (use activeWindow.navigator.clipboard)", () => {
	assert.ok(!/(^|[^\w.])navigator\.clipboard/.test(src));
});

check("clipboard events are dispatched on activeDocument, not the main document", () => {
	assert.ok(!/(^|[^\w.])document\.dispatchEvent/.test(src));
});

check("no bare setTimeout/setInterval/clearTimeout/clearInterval (use the event's window)", () => {
	assert.ok(!/(^|[^\w.])(setTimeout|setInterval|clearTimeout|clearInterval)\(/.test(src));
});

check("global listeners are registered per window via hookWindow, not on document/window directly in onload", () => {
	assert.ok(!/registerDomEvent\(\s*(document|window)\s*,/.test(src));
	assert.ok(/window-open/.test(src), "must hook pop-outs via the window-open event");
});

console.log(`\n${passed} tests passed`);
