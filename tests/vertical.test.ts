// Unit tests for moveVerticallyUnstuck in vertical.ts.
//
// Run with: npm test
import * as assert from "assert";
import { EditorSelection } from "@codemirror/state";
import { moveVerticallyUnstuck } from "../vertical";

let passed = 0;
function check(name: string, fn: () => void) {
	fn();
	passed++;
	console.log(`ok - ${name}`);
}

// Fake wrapped line: visual lines start at 0, 75, 148. Position 75 with assoc -1 is
// drawn on visual line 0 (end), so "down" from it with goal column 0 lands on 75 again
// (the stuck case seen in Obsidian); with assoc 1 it is on visual line 1, so down -> 148.
const starts = [0, 75, 148];
const fakeView = {
	calls: 0,
	moveVertically(start: any, forward: boolean) {
		this.calls++;
		const line = starts.findIndex((s, i) => start.head >= s && (i === starts.length - 1 || start.head < starts[i + 1]));
		const visual = start.head === 75 && start.assoc === -1 ? 0 : line;
		const next = Math.min(Math.max(visual + (forward ? 1 : -1), 0), starts.length - 1);
		return EditorSelection.cursor(starts[next], forward ? -1 : 1, undefined, start.goalColumn);
	},
};

check("escapes the wrap-boundary stall when extending a region downward", () => {
	const sel = EditorSelection.range(0, 75, 0); // head 75, assoc -1, goal 0
	assert.strictEqual(sel.assoc, -1);
	const r = moveVerticallyUnstuck(fakeView, sel, true);
	assert.strictEqual(r.head, 148);
});

check("does not retry when the first move already progressed", () => {
	fakeView.calls = 0;
	const r = moveVerticallyUnstuck(fakeView, EditorSelection.cursor(0), true);
	assert.strictEqual(r.head, 75);
	assert.strictEqual(fakeView.calls, 1);
});

check("returns the original result when both attempts stay put (document edge)", () => {
	const r = moveVerticallyUnstuck(fakeView, EditorSelection.cursor(148, 1), true);
	assert.strictEqual(r.head, 148);
});

console.log(`\n${passed} tests passed`);
