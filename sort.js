/**
 * @import { Role } from "./pull-request.js"
 * @import { Row } from "./row.js"
 */
import { size } from "./pull-request.js";

let table = document.querySelector("#queue");

/** Whose turn sorts first: the author’s, then the others’, then no one’s, e.g. a draft’s */
const turns = { author: 2, others: 1, nobody: 0 };

/** Sort value of each column. `null` and `undefined` (still loading) sort last in both directions. */
const sortKeys = {
	// Within a turn, the longest wait first. A step that waits for nothing, e.g. a conflict, counts as asked in 2255, after every real wait
	step: summary =>
		summary.step && turns[summary.step.whose] * 1e13 - (summary.waitingSince ?? 9e12),
	diff: summary => summary.diff && size(summary.diff),
	diffSinceReview: summary => summary.diffSinceReview && size(summary.diffSinceReview),
	iterations: summary => summary.iterations,
	waitingSince: summary => summary.waitingSince && -summary.waitingSince,
};

/** Where each role’s last sort is saved, and what it sorts by until then. The reviewer’s key predates the author’s columns.
 * Each keeps its `sort` in this tab once read, which another tab may save over */
const roles = {
	reviewer: { key: "review-queue:sort", column: "waitingSince" },
	author: { key: "review-queue:sort:author", column: "step" },
};

/** The role whose sort shows, see {@link showSort} */
let shown;
/** @type {Row[]} The rows the table shows, in order. A transition places them once it starts, by when another sort may have come */
let listed = [];

/**
 * Mark the sort a role last chose, which survives a reload, e.g. { column: "diff", direction: "ascending" }.
 * @param {Role | null} [role]
 */
export function showSort (role) {
	shown = role === "author" ? roles.author : roles.reviewer;
	shown.sort ??= JSON.parse(localStorage.getItem(shown.key)) ?? {
		column: shown.column,
		direction: "descending",
	};
	markSort(shown.sort);
}

/**
 * Choose the column to sort by, or reverse it when the sort is by that column already, and save the choice for the next visit. {@link sort} applies it.
 * @param {string} column - A key of {@link sortKeys}, e.g. `diff`
 */
export function chooseSort (column) {
	let th = table.tHead.querySelector(`[value="${column}"]`).closest("th");
	let sorted = { column, direction: th.ariaSort === "descending" ? "ascending" : "descending" };
	markSort(sorted);
	shown.sort = sorted;

	try {
		localStorage.setItem(shown.key, JSON.stringify(sorted));
	}
	catch (error) {
		// A full storage, e.g. of stored queues, loses only the sort on the next visit
		console.warn("Couldn’t store the sort.", error);
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
 * @param {{ animate?: boolean, shows?: (row: Row) => boolean }} [options] - Whether moved rows slide to their new places,
 * and which rows the table shows, e.g. those of the picked authors. All are sorted, so a tie keeps its order when the picks change
 */
export function sort (rows, { animate, shows = () => true } = {}) {
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

	listed = rows.filter(shows);
	let body = table.tBodies[0];
	let place = () => {
		// A row already at its place stays, e.g. every row on a refresh that changes no order.
		// moveBefore() keeps a moved row’s focus and selected text, which insertBefore() drops. A new row isn’t on the page yet
		listed.forEach(({ tr }, i) => {
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

		// Rows left after the listed ones belong to PRs the search no longer finds, or to authors not picked
		while (body.rows.length > listed.length) {
			body.rows[listed.length].remove();
		}
	};

	// A transition styles 4 pseudo-elements per row, e.g. 400 for 100 rows, and blocks clicks while it runs.
	// So it runs only when someone can see a row move. A hidden tab, e.g. switched away from during a load, skips it with an error.
	// Firefox before 144 has no view transitions, so the rows sort there without moving
	let moves =
		body.rows.length !== listed.length || listed.some(({ tr }, i) => tr !== body.rows[i]);
	if (animate && moves && !document.hidden && document.startViewTransition) {
		document.startViewTransition(place);
	}
	else {
		place();
	}
}
