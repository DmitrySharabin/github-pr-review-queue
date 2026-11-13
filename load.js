/**
 * @import { View } from "./view.js"
 * @import { Row } from "./row.js"
 * @import { Queue } from "./screen.js"
 */
import {
	addedLabel,
	details,
	hasLabel,
	incomplete,
	outdated,
	pattern,
	query,
	searchLimit,
	summarize,
} from "./pull-request.js";
import {
	count,
	describe,
	github,
	graphql,
	listFiles,
	nodes,
	notFound,
	signedIn,
	signedInUser,
} from "./github.js";
import { forget, restore, store } from "./queues.js";
import { fill, mark, summaries, unmark } from "./row.js";
import { sort } from "./sort.js";
import { showCounts } from "./strip.js";
import { viewOf } from "./view.js";
import {
	hideFailure,
	showDelta,
	showFailure,
	showLoaded,
	showLoading,
	showNotice,
	showProgress,
	showUpdated,
} from "./status.js";
import {
	authors,
	countsAs,
	hideQueue,
	onScreen,
	queue,
	shows,
	showQueue,
	showSkeleton,
} from "./screen.js";

let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let controls = document.querySelector("#controls");
let repoForm = document.querySelector("#repo-form");

/** @type {AbortController | undefined} Aborts the load in flight, if any */
export let loading;

/**
 * Load the queue the URL asks for, and stop a load still in flight.
 * The rows on screen stay until the new ones arrive.
 * Rows of the same queue, e.g. on a refresh or a new filter, update in place.
 */
export async function load () {
	loading?.abort();
	loading = new AbortController();
	let { signal } = loading;

	let view = viewOf();
	let refreshing = onScreen(view);

	// Without the marks, a row with nothing new equals its next render, so it stays and keeps focus
	for (let { tr } of queue?.rows ?? []) {
		unmark(tr);
	}

	let next = narrowed(view);
	// Another view shows at once what it showed last, e.g. on the last visit, while it loads again
	if (!next && !refreshing) {
		next = restore(view, queue?.rows);
		if (next) {
			showUpdated(next.at);
		}
	}

	if (next) {
		showQueue(next);
	}

	// A refresh keeps the last delta, dimmed, until it ends. Another view has another count, e.g. one narrowed by a label.
	// A retry keeps the last failure in place until it ends, so the queue under it doesn’t move. Another view’s rows didn’t fail
	if (!refreshing) {
		showDelta();
		hideFailure();
	}
	// A load of another view, e.g. a new filter, finds PRs that aren’t new, so it compares with nothing.
	// By now a narrowed or restored queue is of this view too
	showLoading(onScreen(view) && Boolean(queue.seen));

	// Nothing on screen yet, e.g. on a first visit or after a failed load. A stored token signs in without a card,
	// so bars stand in for the rows during the sign-in. Without one, they would flash before the sign-in card
	// NOTE: An expired token still shows them before the card
	if (!queue && github.isAuthenticated()) {
		showSkeleton(view);
	}

	try {
		await login(view.repo, signal);
		signal.throwIfAborted();
		controls.inert = false;

		let user = view.user || signedInUser();

		// Bars stand in for the rows while nothing is on screen yet, e.g. after the sign-in card, or while bars wait for the user’s name.
		// A queue without a `user` parameter is that of whoever was signed in then, e.g. a stored one. Bars replace it when that was someone else.
		// A failed search hides them
		if (!queue || (onScreen(view) && queue.user !== user)) {
			showSkeleton(view, user);
			showDelta();
		}

		let stale = await find(view, user, signal);
		let failed = await fillDetails(stale, queue, signal);
		signal.throwIfAborted();
		finish(failed);
	}
	catch (error) {
		// The newer load shows its own outcome
		if (signal.aborted) {
			return;
		}

		fail(view, error);
	}

	loading = undefined;
	showLoaded();
}

/**
 * The queue on screen narrowed to a label added to the filter, e.g. by a click on it, if any.
 * The rows on screen that have the label stay, since the search would find just those.
 * @param {View} view
 * @returns {Queue | undefined}
 */
function narrowed (view) {
	// A search that found its maximum of 100 PRs may have missed others with the label, so then the rows wait for the search
	let label =
		countsAs(view) && queue.rows.length < searchLimit
			? addedLabel(queue.view.filter, view.filter)
			: undefined;
	if (label === undefined) {
		return;
	}

	let rows = queue.rows.filter(({ pr }) => hasLabel(pr, label));
	// The load marks what changed against the last finished load’s rows that stay on screen. Before the first load finishes there are none
	// NOTE: A PR that a refresh in flight already dropped isn’t among them, so it doesn’t count as left
	let seen =
		queue.seen &&
		new Map([...queue.seen].filter(([id]) => rows.some(row => row.pr.id === id)));
	return { ...queue, view, rows, seen };
}

/**
 * Search for the PRs of a view, and show them with the fields the search returns.
 * Their slow fields wait for {@link fillDetails}.
 * @param {View} view
 * @param {string} user - The view’s, or the signed-in user when it names none
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<Row[]>} The rows whose details to load
 */
async function find (view, user, signal) {
	let { role } = view;
	// Rows of another queue, e.g. before a role switch, stay on screen until the search replaces them, but don’t update
	let kept = countsAs(view) ? queue.rows : [];

	let { repository, search: found } = await graphql(query({ ...view, user }), signal);
	signal.throwIfAborted();

	let previous = new Map(kept.map(row => [row.pr.id, row]));
	let stale = [];
	let rows = found.nodes.map(pr => {
		let row = previous.get(pr.id) ?? {};
		// The search asks for the repository once. turn() reads it on each PR, as `pr.repository` in GitHub’s model
		row.pr = { ...pr, repository };
		// Without details the summary has no slow fields, so a refreshed row keeps its old ones, dimmed, until they arrive
		fill(row, { ...row.summary, ...summarize(pr, user, role) });

		// The details are checked against their own copy. A load stopped before they came, e.g. by a label click, already replaced `pr`.
		// An author’s details are checked on every load, since a finished check run changes neither `updatedAt` nor the head commit
		if (
			!row.detailed ||
			role === "author" ||
			incomplete(row.summary) ||
			outdated(row.detailed, pr)
		) {
			stale.push(row);
			if (row.detailed) {
				row.tr.classList.add("stale");
			}
		}
		return row;
	});
	// What the last finished load showed, and when, holds only for its own view, e.g. not after a role switch
	let { at, seen } = onScreen(view) ? queue : {};
	showQueue({ view, user, rows, at, seen });
	return stale;
}

/**
 * Show the queue on screen as the load leaves it, with what changed since the last one, and store it.
 * A queue with failed details shows the failure beside Refresh instead, and isn’t stored
 * @param {PromiseRejectedResult} [failed] - The first failure of {@link fillDetails}, if any
 */
function finish (failed) {
	let { rows } = queue;
	sort(rows, { animate: true, shows });
	showCounts(queue, authors);

	queue.at = Date.now();
	showUpdated(queue.at);
	// Rows whose details didn’t arrive, e.g. failed or of a deleted PR, show what they had, undimmed.
	// The next load asks for them again
	// Rows of other authors are off the page, so not in the table
	for (let { tr } of rows) {
		if (tr.classList.contains("stale")) {
			unmark(tr);
		}
	}

	// The user has seen what the search found, even when details failed
	let last = queue.seen;
	queue.seen = summaries(rows);
	if (last) {
		// NOTE: Counts the PRs of authors not picked too, e.g. “+1” for a new PR that doesn’t show
		showDelta(mark(rows, last));
	}

	// The search did refresh the queue, so a failure shows beside Refresh, never with the form
	if (failed) {
		showFailure(describe(failed.reason));
	}
	else {
		hideFailure();
		store(queue);
	}
}

/**
 * Say why a load failed, beside Refresh or with the form.
 * @param {View} view
 * @param {unknown} error - What the load threw
 */
function fail (view, error) {
	// Rows of another view, or of no finished load, go: they would sit under this view’s labels, filter and time.
	// A step back then shows the stored queue, as a visit does
	if (!onScreen(view) || !queue.at) {
		hideQueue();
	}

	showDelta();
	// A repo or user that GitHub can’t find needs the form to fix them.
	// So does a failure with no finished load on screen, e.g. on a first visit, where most failures come from the repo or the user
	if (queue && !notFound.test(error?.message)) {
		showFailure(describe(error));
	}
	else {
		hideFailure();
		showNotice(
			repoForm,
			`Couldn’t load the pull requests in ${view.repo}`,
			describe(error, "Check the repository and the user, then try again."),
		);
	}
}

/**
 * Fill in the slow fields of these rows, a few PRs per query, and count them on the progress bar.
 * A failed query leaves its rows as they were, and the others fill in still.
 * @param {Row[]} stale
 * @param {Queue} queue - The load’s
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<PromiseRejectedResult | undefined>} The first failure, if any
 */
async function fillDetails (stale, { view: { repo, role, exclude }, user }, signal) {
	// Rows with details on screen already are rechecked, e.g. on a refresh
	let task = stale.some(row => row.detailed) ? "rechecked" : "loaded";
	if (stale.length > 0) {
		showProgress(task, 0, stale.length);
	}

	// An author’s view counts no lines.
	// NOTE: A pattern that isn’t a regular expression, e.g. typed into the URL, ignores nothing.
	// One that backtracks a lot, e.g. `(.+)+x$`, freezes the tab, as it runs on every path
	let ignore = role === "author" ? undefined : pattern(exclude);
	let done = 0;
	// GitHub stops a query that runs too long, so each asks for a few PRs
	let size = 10;
	let batches = Array.from({ length: Math.ceil(stale.length / size) }, (_, i) =>
		stale.slice(i * size, (i + 1) * size));

	let results = await Promise.allSettled(
		batches.map(async batch => {
			let prs = await nodes(
				ids => details({ user, role, exclude: ignore && exclude, ids }),
				batch.map(row => row.pr.id),
				signal,
			);
			return Promise.allSettled(
				prs.map(async pr => {
					// Rows a newer load owns, e.g. after a role switch
					if (signal.aborted) {
						return;
					}

					// GitHub answers null for a PR deleted since the search. Its row has nothing to fill, and the next search drops it
					if (!pr) {
						showProgress(task, ++done, stale.length);
						return;
					}

					let row = batch.find(row => row.pr.id === pr.id);

					pr = { ...row.pr, ...pr };
					await listFiles(repo, pr, signal);
					let summary = summarize(pr, user, role, ignore);
					await count(repo, summary.diffSinceReview, signal, ignore);
					// A newer load may have started during the count
					if (signal.aborted) {
						return;
					}

					// The search may have refreshed the cheap fields during the count, e.g. a new title.
					// Undimmed first, the row equals its render when nothing changed, and keeps focus
					if (row.tr.classList.contains("stale")) {
						unmark(row.tr);
					}
					fill(row, { ...summary, ...summarize(row.pr, user, role) });
					row.detailed = row.pr;
					showProgress(task, ++done, stale.length);
				}),
			);
		}),
	);
	// A batch that answered settles each of its PRs apart, e.g. one whose commit sizes failed
	return results
		.flatMap(result => result.value ?? result)
		.find(result => result.status === "rejected");
}

async function login (repo, signal) {
	if (await signedIn(signal)) {
		return;
	}

	// No stored token. The sign-in popup needs a click, or the browser blocks it.
	// Whoever signs in may be someone else, e.g. after a token expired, so the queues of the last one go, stored and on screen
	// NOTE: The same user signed in again loses the marks of the next load, and its details load anew
	forget();
	hideQueue();
	showDelta();
	hideFailure();
	status.hidden = false;
	status.textContent = `Sign in to see the pull requests in ${repo}.`;
	signIn.querySelector(".repo").textContent = repo;
	progress.hidden = true;
	signIn.hidden = false;
	// Waits for the sign-in, not the click. Madata’s login() never settles if the popup is closed, so the button stays for another try
	await new Promise(resolve => github.addEventListener("mv-login", resolve, { once: true }));
	signIn.hidden = true;
	progress.hidden = false;
	status.textContent = "Loading pull requests…";
}
