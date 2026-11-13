/**
 * @import { Summary } from "./pull-request.js"
 * @import { View } from "./view.js"
 */
import { parseKey, viewKey } from "./view.js";

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
 * What a view showed after its last full load, with when and for which user.
 * @param {View} view
 * @returns {{ user: string, at: number, rows: { pr: object, summary: Summary }[] } | undefined}
 */
export function restore (view) {
	return JSON.parse(localStorage.getItem(queueKey(view))) ?? undefined;
}

/**
 * The keys of the stored queues, with the view each is of.
 * @returns {{ key: string, view: View }[]}
 */
function storedViews () {
	return Object.keys(localStorage)
		.filter(key => key.startsWith(queuePrefix))
		.map(key => ({ key, view: parseKey(key.slice(queuePrefix.length)) }));
}

/**
 * The stored queues, the latest first. Each read parses a whole queue, so it is slower than {@link storedViews}.
 * @returns {{ key: string, view: View, at: number }[]}
 */
export function storedQueues () {
	return storedViews()
		.map(queue => ({ ...queue, at: JSON.parse(localStorage.getItem(queue.key)).at }))
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
 * @param {View} view
 * @param {{ user: string, at: number, rows: { pr: object, summary: Summary }[] }} queue
 */
export function store (view, queue) {
	let key = queueKey(view);
	let text = JSON.stringify(queue);
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
