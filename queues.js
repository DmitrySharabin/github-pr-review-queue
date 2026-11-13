/**
 * @import { Summary } from "./pull-request.js"
 * @import { View } from "./view.js"
 * @import { Row } from "./row.js"
 * @import { Queue } from "./index.js"
 *
 * @typedef {object} Stored - What a view showed after its last full load
 * @property {string} user - Whose queue it is
 * @property {number} at - When the load finished, in epoch ms
 * @property {{ pr: object, summary: Summary }[]} rows
 */
import { viewKey, viewOf } from "./view.js";
import { fill, summaries } from "./row.js";

const prefix = "review-queue:queue:";
/** The format of the stored queues. A new one, e.g. after a step is renamed, leaves the queues stored before unread */
const version = 3;
const queuePrefix = `${prefix}${version}:`;

// A queue of another version is never read, so it goes, e.g. on the first visit after an update
for (let key of Object.keys(localStorage)) {
	if (key.startsWith(prefix) && !key.startsWith(queuePrefix)) {
		localStorage.removeItem(key);
	}
}

/**
 * The key a view’s queue is stored under, e.g. `review-queue:queue:3:repo=foo%2Fbar&role=author`.
 * @param {View} view
 */
function queueKey (view) {
	return queuePrefix + viewKey(view);
}

/**
 * The queue a view showed after its last full load, if any. Its rows count as the last load’s, so the next load marks what changed since.
 * @param {View} view
 * @param {Row[]} [rows] - The rows on screen. A row of the same PR stays while it shows the same, e.g. with focus on the label just clicked
 * @returns {Queue | undefined}
 */
export function restore (view, rows = []) {
	try {
		let stored = JSON.parse(localStorage.getItem(queueKey(view)));
		if (!stored) {
			return;
		}

		let previous = new Map(rows.map(row => [row.pr.id, row]));
		let restored = stored.rows.map(({ pr, summary }) => {
			let row = previous.get(pr.id) ?? {};
			row.pr = pr;
			// A row stored without details, e.g. of a PR deleted during its load, asks for them again
			row.detailed = summary.reviewers && pr;
			fill(row, summary);
			return row;
		});
		return { view, user: stored.user, rows: restored, at: stored.at, seen: summaries(restored) };
	}
	catch (error) {
		// A queue this version can’t show, e.g. stored by an older one with a step since renamed, waits for the load, which stores it anew
		console.warn("Couldn’t show the stored queue.", error);
	}
}

/**
 * The keys of the stored queues, with the view each is of.
 * @returns {{ key: string, view: View }[]}
 */
function storedViews () {
	return Object.keys(localStorage)
		.filter(key => key.startsWith(queuePrefix))
		.map(key => ({ key, view: viewOf(key.slice(queuePrefix.length)) }));
}

/**
 * The stored queues, the latest first. Each read parses a whole queue, so it is slower than {@link storedViews}.
 * @returns {{ key: string, view: View, at: number }[]}
 */
export function storedQueues () {
	return storedViews()
		.map(({ key, view }) => ({ key, view, at: JSON.parse(localStorage.getItem(key)).at }))
		.sort((a, b) => b.at - a.at);
}

/**
 * Remove the stored queues, e.g. the titles of private repos when the signed-in user may change, or those of one repo.
 * @param {(view: View) => boolean} [test] - Which ones, e.g. `view => view.repo === "foo/bar"`
 */
export function forget (test = () => true) {
	for (let { key, view } of storedViews()) {
		if (test(view)) {
			localStorage.removeItem(key);
		}
	}
}

/**
 * Store what a view shows, so the next visit shows it at once while it loads again.
 * @param {Stored & { view: View }} queue - Its rows may hold more, e.g. their `<tr>`, which isn’t stored
 */
export function store ({ view, user, at, rows }) {
	let key = queueKey(view);
	let text = JSON.stringify({ user, at, rows: rows.map(({ pr, summary }) => ({ pr, summary })) });
	let others;

	// A full storage drops the queues stored longest ago, e.g. of a label looked at once, until this one fits
	for (;;) {
		try {
			localStorage.setItem(key, text);
			return;
		}
		catch (error) {
			// Newest first, so the last one is the oldest
			// NOTE: Storage full of other data, e.g. of another app on the origin, loses every queue before this one gives up
			others ??=
				error.name === "QuotaExceededError"
					? storedQueues().filter(other => other.key !== key)
					: [];

			if (others.length === 0) {
				// Only the next visit’s head start is lost
				console.warn("Couldn’t store the queue.", error);
				return;
			}

			localStorage.removeItem(others.pop().key);
		}
	}
}
