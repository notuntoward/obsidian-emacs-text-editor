import { EditorSelection, SelectionRange } from "@codemirror/state";

export interface VerticalMover {
	moveVertically(start: SelectionRange, forward: boolean, distance?: number): SelectionRange;
}

/**
 * Moves the head of `selection` one visual line up or down.
 *
 * CM6's moveVertically can return the starting position unchanged when the head
 * sits on a soft-wrap boundary with assoc -1 (drawn at the end of the upper
 * visual line) and the goal column is the left edge: the "next line" start IS
 * that same document position. Repeated next-line then never leaves it, e.g.
 * set-mark followed by next-line from column 0 of a wrapped paragraph. When the
 * first attempt does not move, retry from the other side of the boundary
 * (opposite assoc), which resolves to the following visual line.
 */
export function moveVerticallyUnstuck(
	view: VerticalMover,
	selection: SelectionRange,
	forward: boolean,
): SelectionRange {
	const head = selection.head;
	const first = view.moveVertically(
		EditorSelection.cursor(head, selection.assoc, undefined, selection.goalColumn),
		forward,
	);
	if (first.head !== head) return first;

	const retryAssoc = selection.assoc === 1 ? -1 : 1;
	const retry = view.moveVertically(
		EditorSelection.cursor(head, retryAssoc, undefined, selection.goalColumn),
		forward,
	);
	const movedRightWay = forward ? retry.head > head : retry.head < head;
	return movedRightWay ? retry : first;
}