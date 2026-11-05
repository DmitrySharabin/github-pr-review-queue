/** @import { Row } from "./row.js" */
import { size } from "./pull-request.js";

let table = document.querySelector("#queue");

/** Sort value of each column. `null` and `undefined` (still loading) sort last in both directions. */
const sortKeys = {
	diff: summary => summary.diff && size(summary.diff),
	diffSinceReview: summary => summary.diffSinceReview && size(summary.diffSinceReview),
	iterations: summary => summary.iterations,
	waitingSince: summary => summary.waitingSince && -summary.waitingSince,
};

// The last sort survives a reload, e.g. { column: "diff", direction: "ascending" }
let saved = JSON.parse(localStorage.getItem("review-queue:sort"));
if (saved) {
	markSort(saved);
}

/**
 * Sort the rows by a column, the other way round when they already are, and keep it for the next visit.
 * @param {Row[]} rows
 * @param {string} column - A key of {@link sortKeys}, e.g. `diff`
 */
export function sortBy (rows, column) {
	let th = table.tHead.querySelector(`[value="${column}"]`).closest("th");
	let sorted = { column, direction: th.ariaSort === "descending" ? "ascending" : "descending" };
	markSort(sorted);
	localStorage.setItem("review-queue:sort", JSON.stringify(sorted));
	// No transition: its capture holds the new order back up to 300 ms on 100 rows, and when every row moves no one follows one.
	// Bars wait for the search, which sorts what it finds: sorting now would put the rows of the last queue, or none, in their place
	if (!table.tBodies[0].querySelector(".skeleton")) {
		sort(rows);
	}
}

/** Mark the column the table sorts by. */
function markSort ({ column, direction }) {
	let th = table.tHead.querySelector(`[value="${column}"]`)?.closest("th");

	// A saved column the table no longer has
	if (!th) {
		return;
	}

	table.tHead.querySelector("[aria-sort]").ariaSort = null;
	th.ariaSort = direction;
}

/**
 * Sort the rows on screen by the sorted column.
 * @param {Row[]} rows - Sorted in place, then put on screen in that order
 * @param {{ animate?: boolean }} [options] - Whether moved rows slide to their new places
 */
export function sort (rows, { animate } = {}) {
	let th = table.tHead.querySelector("[aria-sort]");
	let key = sortKeys[th.querySelector("button").value];
	let sign = th.ariaSort === "ascending" ? 1 : -1;

	rows.sort((a, b) => {
		let [x, y] = [key(a.summary), key(b.summary)];

		if (x == null || y == null) {
			return (x == null) - (y == null);
		}

		return sign * (x - y);
	});

	let body = table.tBodies[0];
	let place = () => {
		// A row already at its place stays, e.g. every row on a refresh that changes no order.
		// moveBefore() keeps a moved row’s focus and selected text, which insertBefore() drops. A new row isn’t on the page yet
		rows.forEach(({ tr }, i) => {
			let next = body.rows[i] ?? null;
			if (tr === next) {
				return;
			}

			if (tr.isConnected && body.moveBefore) {
				body.moveBefore(tr, next);
			}
			else {
				body.insertBefore(tr, next);
			}
		});

		// Left after the sorted rows: those of PRs the search no longer finds
		while (body.rows.length > rows.length) {
			body.rows[rows.length].remove();
		}
	};

	// A transition styles 4 pseudo-elements per row, e.g. 400 for 100 rows, and blocks clicks while it runs,
	// so it runs only when a row moves where someone sees it: a hidden tab, e.g. switched away from during a load, skips it with an error.
	// Firefox before 144 has no view transitions: the rows then sort without moving
	let moves = body.rows.length !== rows.length || rows.some(({ tr }, i) => tr !== body.rows[i]);
	if (animate && moves && !document.hidden && document.startViewTransition) {
		document.startViewTransition(place);
	}
	else {
		place();
	}
}
