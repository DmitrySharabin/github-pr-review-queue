/**
 * @import { Summary } from "./pull-request.js"
 * @import { View } from "./view.js"
 * @import { Row } from "./row.js"
 */
import {
	addedLabel,
	details,
	hasLabel,
	incomplete,
	outdated,
	pattern,
	query,
	search,
	searchLimit,
	summarize,
} from "./pull-request.js";
import {
	count,
	describe,
	github,
	graphql,
	isYou,
	listFiles,
	nodes,
	notFound,
	signedIn,
	signedInUser,
} from "./github.js";
import { forget, restore, store, storedQueues } from "./queues.js";
import { fill, mark, relink, summaries, unmark } from "./row.js";
import { chooseSort, showSort, sort } from "./sort.js";
import { showTime } from "./time.js";
import { offerRecent } from "./recent.js";
import { collaborators, matches, showAuthors } from "./authors.js";
import { applyOnClose, dismissMenus } from "./menu.js";
import { href, normalizeParams, paramNames, viewKey, viewOf } from "./view.js";
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

let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let signOut = document.querySelector("#sign-out");
let controls = document.querySelector("#controls");
let tokenForm = document.querySelector("#token-form");
let skeletonTemplate = document.querySelector("#skeleton");
let repoForm = document.querySelector("#repo-form");
let filters = document.querySelector("#filters");
let empty = document.querySelector("#empty");
let strip = document.querySelector("#summary");
let filterForm = document.querySelector("#narrow");
let authorButton = document.querySelector("#author-button");
let authorForm = document.querySelector("#authors");
let displayButton = document.querySelector("#display-button");
let displayForm = document.querySelector("#display");
let forms = [repoForm, filterForm, authorForm, displayForm, ...strip.querySelectorAll("form")];

/**
 * @typedef {object} Queue - What the table shows
 * @property {View} view - The view the rows are of, e.g. `{ repo: "foo/bar", filter: "label:baz", exclude: "test" }`
 * @property {string} user - Whose queue it is, e.g. the signed-in user’s when the view names no `user`
 * @property {Row[]} rows
 * @property {number} [at] - When its rows last finished loading, in epoch ms
 * @property {Map<string, Summary>} [seen] - What they showed then, by PR id, for the next load to mark what changed
 */
/** @type {Queue | undefined} None while nothing or bars are on screen. Set by {@link showQueue}, cleared by {@link showSkeleton} and {@link hideQueue} */
let queue;
/** Whose PRs show, e.g. `["@collaborators", "foo"]`, see {@link matches}. An author’s PRs are all theirs */
let authors = [];
/** @type {AbortController | undefined} Aborts the load in flight, if any */
let loading;

// Sorts without a view transition: its capture holds the new order back up to 300 ms on 100 rows, and when every row moves, no one follows one.
// Bars wait for the search, which sorts what it finds
table.addEventListener("command", event => {
	chooseSort(event.source.value);
	if (queue) {
		sort(queue.rows, { shows });
	}
});

// Opening a link in a marked row, e.g. its PR, is seeing what changed in it. A middle click opens a link too. A right click opens a menu instead
for (let type of ["click", "auxclick"]) {
	table.tBodies[0].addEventListener(type, event => {
		let tr = event.target.closest("a")?.closest("tr");
		if (tr && event.button < 2) {
			unmark(tr);
		}
	});
}

signIn
	.querySelector(":scope > button")
	.addEventListener("click", () =>
		github.login().catch(error => showNotice(signIn, "Couldn’t sign in", describe(error))));

tokenForm.addEventListener("submit", event => {
	event.preventDefault();
	// Madata stores and validates the token as it does after the popup, then fires mv-login, which login() waits for
	github
		.login({ accessToken: tokenForm.elements.token.value })
		.catch(error => showNotice(signIn, "Couldn’t sign in", describe(error)));
});

// A token that works but can’t read the repo keeps the sign-in hidden, so signing out is the way to replace it
signOut.addEventListener("click", async () => {
	await github.logout();
	// A load that ends before the reload would store its queue again
	loading?.abort();
	forget();
	location.reload();
});

// The forms submit their fields as URL parameters, so the URL they open can be copied and reused.
// A form has fields only for what it changes, and keeps the rest of the URL, e.g. the filter form its `repo`.
// Capturing, this runs before a form’s own listener, e.g. the author list’s, which then replaces the URL’s `authors`
for (let form of forms) {
	form.addEventListener(
		"formdata",
		({ formData }) => {
			let params = new URLSearchParams(location.search);
			for (let name of paramNames) {
				if (!formData.has(name) && params.has(name)) {
					formData.set(name, params.get(name));
				}
			}

			normalizeParams(formData);
			// An empty field means its default, e.g. the signed-in user: ?repo=foo/bar, not ?repo=foo/bar&user=
			for (let [name, value] of [...formData]) {
				if (!value) {
					formData.delete(name);
				}
			}
		},
		{ capture: true },
	);
}

// The repos and users of the stored queues, e.g. those opened yesterday. Forgetting one forgets its queues
// NOTE: The same repo in another case, e.g. `Foo/Bar`, shows twice.
// Clearing the repos forgets every queue, but the user field shows its chevron until it is opened
for (let name of ["repo", "user"]) {
	offerRecent(repoForm.elements[name], {
		values: () => [
			...new Set(
				storedQueues()
					.map(({ view }) => view[name])
					.filter(Boolean),
			),
		],
		remove: value => forget(view => view[name] === value),
	});
}

// A value in the summary turns into its form in place. Enter or ✓ opens the queue it names. Esc, ✕ or the pencil again goes back
for (let form of strip.querySelectorAll("form")) {
	let value = form.previousElementSibling;
	let button = strip.querySelector(`[commandfor="${form.id}"]`);

	form.addEventListener("command", () => {
		if (!form.hidden) {
			form.reset();
			return;
		}

		form.hidden = false;
		value.hidden = true;
		button.ariaExpanded = "true";
		form.elements[0].focus();
		form.elements[0].select();
	});

	form.addEventListener("keydown", event => {
		if (event.key === "Escape") {
			form.reset();
		}
	});

	// showView() resets every form to the URL, which closes this one on a new view
	form.addEventListener("reset", () => {
		// Hiding the form would drop focus to the page
		if (form.contains(document.activeElement)) {
			button.focus();
		}

		form.hidden = true;
		value.hidden = false;
		button.ariaExpanded = "false";
	});
}

// A pattern that isn’t a regular expression, e.g. `test(`, stops Apply with the browser’s message
displayForm.elements.exclude.addEventListener("input", checkPattern);

// An empty filter field submits no `filter`. An empty pattern waits for Apply, as the author list’s Clear does
for (let [clear, field, then] of [
	[
		filterForm.querySelector(".cancel"),
		filterForm.elements.filter,
		() => filterForm.requestSubmit(),
	],
	[displayForm.querySelector(".clear"), displayForm.elements.exclude, checkPattern],
]) {
	clear.addEventListener("click", () => {
		field.value = "";
		// Pressed from the keyboard, it hides itself and would drop the focus to the page, so the emptied field takes it.
		// Not after a tap, since a focused field opens the on-screen keyboard
		if (clear.matches(":focus-visible")) {
			field.focus();
		}
		then();
	});
}

applyOnClose(displayForm, {
	changed: () => displayForm.elements.exclude.value !== displayForm.elements.exclude.defaultValue,
	discard () {
		displayForm.reset();
		checkPattern();
	},
});

refresh.addEventListener("click", () => {
	if (!loading) {
		load();
	}
});

// A typed or shared URL can repeat the view’s qualifiers in its filter, e.g. `?role=author&filter=author:foo`.
// The rewrite runs before the navigate listener, which would load the URL a second time
let current = new URLSearchParams(location.search);
let normalized = new URLSearchParams(current);
normalizeParams(normalized);
// A repo or user that its field would reject, e.g. `foo/bar/issues`, names none, so it reaches neither GitHub’s URLs nor the page
for (let field of [repoForm.elements.repo, repoForm.elements.user]) {
	field.value = normalized.get(field.name) ?? "";
	if (field.validity.patternMismatch) {
		normalized.delete(field.name);
	}
}
if (`${normalized}` !== `${current}`) {
	history.replaceState(null, "", `?${normalized}${location.hash}`);
}

// A filter, a role switch or another repo loads in place, so what it doesn’t change stays put, e.g. the focus in the filter field.
// Without the Navigation API, or to or from the page that asks for a repo, the page reloads:
// going back to that page shows it, not just its URL, and leaving it brings back the controls it hides
window.navigation?.addEventListener("navigate", event => {
	let next = new URL(event.destination.url).searchParams;
	let current = new URLSearchParams(location.search);
	if (
		!event.canIntercept ||
		event.hashChange ||
		event.navigationType === "reload" ||
		!current.get("repo") ||
		!next.get("repo")
	) {
		return;
	}

	// The same view submitted again, e.g. Enter with the same terms, loads it again
	let onlyAuthors =
		viewKey(viewOf(next)) === viewKey(viewOf(current)) &&
		next.get("authors") !== current.get("authors");
	// The handler runs once the URL has changed. Focus and scroll stay where they were, e.g. in the filter field
	event.intercept({
		focusReset: "manual",
		scroll: "manual",
		handler: () => showView({ onlyAuthors }),
	});
});

showView();

/**
 * Show what the URL asks for, e.g. `?repo=foo/bar&filter=label:baz`.
 * @param {{ onlyAuthors?: boolean }} [options] - Whether the URL changed only its `authors`, e.g. after a pick in the list
 */
function showView ({ onlyAuthors } = {}) {
	let params = new URLSearchParams(location.search);
	let view = viewOf(params);
	let { role, filter, exclude } = view;
	authors = role === "author" ? [] : (params.get("authors")?.split(",").filter(Boolean) ?? []);

	// As defaults, so a reset, e.g. Esc in a summary form, goes back to what the URL says
	for (let form of forms) {
		for (let field of form.elements) {
			if (field.name) {
				field.defaultValue = params.get(field.name) ?? "";
			}
		}
		// An open menu keeps what is changed in it, e.g. on a step back, as it does while a refresh ends
		if (!form.matches(":popover-open")) {
			form.reset();
		}
	}
	// A reset fires no input event, e.g. after Clear, so the last message would stay
	checkPattern();

	// Each role opens the same queue, filter and all, from the other side
	// The other role’s qualifier in the filter, e.g. `author:foo`, names its user
	for (let link of strip.querySelectorAll(".roles a")) {
		link.href = href({ role: link.dataset.role });
		link.ariaCurrent = (link.dataset.role === "author") === (role === "author") ? "page" : null;
	}

	filterForm.querySelector(".cancel").hidden = !filter;
	// Closed, the menu says that a setting in it differs from its default
	displayButton.querySelector(".badge").hidden = !exclude;
	displayButton.ariaLabel = exclude ? "Display, 1 setting changed" : null;
	displayButton.classList.toggle("set", Boolean(exclude));

	if (view.repo) {
		// Other authors of the view on screen need no load: their rows are on screen already
		if (onlyAuthors && onScreen(view)) {
			return showQueue();
		}
		// The load of this view in flight shows the picked authors once its search ends
		if (onlyAuthors && loading) {
			return;
		}
		return load();
	}

	// The page’s first script hides the controls before the first paint, but it still sees a repo that the URL drops, e.g. `foo/bar/issues`
	controls.hidden = true;
	// The form’s heading says what to do
	status.hidden = true;
	progress.hidden = true;
	repoForm.hidden = false;
}

/** Mark the pattern field invalid while it holds no regular expression, and offer Clear while it holds anything. */
function checkPattern () {
	let field = displayForm.elements.exclude;
	field.setCustomValidity(
		field.value && !pattern(field.value) ? "Enter a valid regular expression." : "",
	);
	displayForm.querySelector(".clear").hidden = !field.value;
}

/**
 * Load the queue the URL asks for, and stop a load still in flight.
 * The rows on screen stay until the new ones arrive.
 * Rows of the same queue, e.g. on a refresh or a new filter, update in place.
 */
async function load () {
	loading?.abort();
	loading = new AbortController();
	let { signal } = loading;

	let view = viewOf();
	let { repo, role, filter } = view;
	let refreshing = onScreen(view);

	// Without the marks, a row with nothing new equals its next render, so it stays and keeps focus
	for (let { tr } of queue?.rows ?? []) {
		unmark(tr);
	}

	// A label added to the filter, e.g. by a click on it, keeps the rows on screen that have it. The search would find just those.
	// A search that found its maximum of 100 PRs may have missed others with the label, so then the rows wait for the search
	let label =
		countsAs(view) && queue.rows.length < searchLimit
			? addedLabel(queue.view.filter, filter)
			: undefined;
	let next;
	if (label !== undefined) {
		let rows = queue.rows.filter(({ pr }) => hasLabel(pr, label));
		// The load marks what changed against the last finished load’s rows that stay on screen. Before the first load finishes there are none
		// NOTE: A PR that a refresh in flight already dropped isn’t among them, so it doesn’t count as left
		let seen =
			queue.seen &&
			new Map([...queue.seen].filter(([id]) => rows.some(row => row.pr.id === id)));
		next = { ...queue, view, rows, seen };
	}

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
		await login(repo, signal);
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

		let failed = await fillDetails(stale, queue, signal);
		signal.throwIfAborted();
		sort(rows, { animate: true, shows });
		showCounts();

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
	catch (error) {
		// The newer load shows its own outcome
		if (signal.aborted) {
			return;
		}

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
				`Couldn’t load the pull requests in ${repo}`,
				describe(error, "Check the repository and the user, then try again."),
			);
		}
	}

	loading = undefined;
	showLoaded();
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

/** Whether the table shows a row: whether its PR is by one of the picked authors. */
function shows (row) {
	return matches(row.summary, authors);
}

/**
 * Show a queue’s rows, sorted, with what goes around them: the strip above them, or why there are none.
 * @param {Queue} [next] - The queue to show, or the one on screen again, e.g. for other authors
 */
function showQueue (next = queue) {
	queue = next;
	let {
		view: { role, filter },
		user,
		rows,
	} = queue;
	let shownRows = rows.filter(shows);
	showRole(role);
	sort(rows, { shows });
	showSummary(queue.view, user);
	showCounts();

	table.parentElement.hidden = shownRows.length === 0;
	empty.hidden = shownRows.length > 0;
	repoForm.hidden = true;
	showAuthors(rows, authors);
	relink(rows);
	authorButton.disabled = false;
	// Open, a menu stays by its button, e.g. while a refresh that empties the queue ends
	authorButton.hidden =
		role === "author" ||
		(rows.length === 0 && authors.length === 0 && !authorForm.matches(":popover-open"));
	// Nothing to narrow down, unless a filter or picked authors are why nothing is left.
	// In use, the row stays, e.g. a field focused after its terms were cleared, or a menu open while a refresh ends
	filters.hidden =
		rows.length === 0 &&
		!filter &&
		authors.length === 0 &&
		!filters.matches(":focus-within, :has(:popover-open)");
	// An author’s view counts no lines
	displayButton.hidden =
		role === "author" || (rows.length === 0 && !displayForm.matches(":popover-open"));
	// The status names the progress bar, so it says “Loading” until there is nothing left to load
	if (shownRows.length === 0) {
		showEmpty();
	}
	status.hidden = shownRows.length > 0;
}

/**
 * Stand in for a queue that nothing shows yet, e.g. on a first visit, while its search runs. The queue on screen, if any, goes.
 * The strip shows what the view tells, and rows of bars stand for the PRs.
 * @param {View} view
 * @param {string | null} [user] - None until the sign-in ends when the view names none
 */
function showSkeleton (view, user = view.user) {
	queue = undefined;
	showUpdated();
	let { role } = view;
	showRole(role);
	table.tBodies[0].replaceChildren(
		...Array.from({ length: 6 }, () =>
			skeletonTemplate.content.firstElementChild.cloneNode(true)),
	);
	showSummary(view, user);
	// Unknown until the search ends. Without a link, it is no empty stop for the keyboard
	let count = strip.querySelector(".count");
	count.textContent = "";
	count.removeAttribute("href");
	showTime(strip.querySelector(".latest"));
	strip.querySelector(".turns").textContent = "";

	table.parentElement.hidden = false;
	empty.hidden = true;
	repoForm.hidden = true;
	authorButton.hidden = role === "author";
	// No authors to list until the search ends
	authorButton.disabled = true;
	filters.hidden = false;
	displayButton.hidden = role === "author";
}

/** Hide the queue and what goes around it, e.g. for the sign-in card or the form after a failed load. */
function hideQueue () {
	queue = undefined;
	showUpdated();
	strip.hidden = true;
	table.parentElement.hidden = true;
	empty.hidden = true;
	filters.hidden = true;
	dismissMenus();
}

/** Name things after the role, since an author sees their own PRs, e.g. “Awaiting review” becomes “Open”, and show the role’s columns. */
function showRole (role) {
	let author = role === "author";
	for (let element of document.querySelectorAll("[data-author]")) {
		element.textContent = author ? element.dataset.author : element.dataset.reviewer;
	}

	table.classList.toggle("author", author);
	showSort(role);
}

/** Say why the queue is empty, e.g. “Nothing to review”, in the card and in the status, which a screen reader hears. */
function showEmpty () {
	let {
		view: { repo, role, filter },
		user,
		rows,
	} = queue;
	let author = role === "author";
	let you = isYou(queue.view.user);
	let whose = you ? "your" : `${user}’s`;
	let title = author ? "No open pull requests" : "Nothing to review";
	let text = author
		? `${you ? "You have" : `${user} has`} no open pull requests in ${repo}.`
		: `No pull requests in ${repo} are waiting for ${whose} review.`;
	// The search found PRs, but none by the picked authors, e.g. after theirs were merged. The card names them, and Clear shows the others’
	let picked = authors.length > 0 && rows.length > 0;
	if (picked) {
		let names = authors.map(name =>
			name === collaborators ? "the repo’s collaborators" : name);
		title = "No matching pull requests";
		text = `None of the pull requests waiting for ${whose} review in ${repo} are by ${new Intl.ListFormat("en", { type: "disjunction" }).format(names)}.`;
	}
	else if (filter) {
		title = "No matching pull requests";
		text = author
			? `None of ${whose} open pull requests in ${repo}`
			: `None of the pull requests waiting for ${whose} review in ${repo}`;
		text += ` match “${filter}”. Try other search terms, or clear the filter.`;
	}

	empty.classList.toggle("author", author);
	empty.classList.toggle("filtered", Boolean(filter) || picked);
	empty.querySelector("h2").textContent = title;
	empty.querySelector("p").textContent = text;
	empty.querySelector(".github").href = `https://github.com/${repo}/pulls`;
	let clear = empty.querySelector(".clear");
	clear.href = href({ authors: null });
	clear.hidden = !picked;
	status.textContent = text;
}

/**
 * Whether the queue on screen counts its rows as this view does, so they can stay, e.g. those of another filter.
 * Another pattern counts every PR’s lines anew, so its rows are another queue’s
 * @param {View} view
 */
function countsAs (view) {
	return (
		Boolean(queue) &&
		viewKey({ ...queue.view, filter: null }) === viewKey({ ...view, filter: null })
	);
}

/**
 * Whether the queue on screen is of this view, e.g. not of the one before a role switch.
 * @param {View} view
 */
function onScreen (view) {
	return Boolean(queue) && viewKey(queue.view) === viewKey(view);
}

/**
 * Fill the strip above the table with what a view tells: where, for whom, and what its counts mean. {@link showCounts} fills them in.
 * @param {View} view
 * @param {string | null} user - Whose queue it is, or none until the sign-in ends
 */
function showSummary (view, user) {
	let { repo, role, filter } = view;
	let link = strip.querySelector(".repo");
	link.href = `https://github.com/${repo}`;
	link.textContent = repo;

	let person = strip.querySelector(".user");
	if (user) {
		person.href = `https://github.com/${user}`;
		let avatar = person.querySelector("img");
		let src = `https://github.com/${user}.png?size=48`;
		// An image keeps drawing its last source until the new one loads, e.g. the last user’s face.
		// Without a source first, the image shows its background, a disc, until then
		if (avatar.src !== src) {
			avatar.removeAttribute("src");
			avatar.src = src;
		}
	}
	// Unknown during the sign-in when the URL names no user. Without a link, bars stand in for the avatar and the name
	else {
		person.removeAttribute("href");
	}
	person.querySelector("span").textContent = user;

	strip.querySelector(".count").href =
		`https://github.com/pulls?q=${encodeURIComponent(search({ repo, user, role, filter }))}`;

	// A reviewer sees when the last request came. An author sees how many PRs wait for them, or for the user they look at.
	let author = role === "author";
	strip.querySelector(".tally").textContent = !author
		? "Latest request"
		: isYou(view.user)
			? "Your turn"
			: "Author’s turn";
	strip.querySelector(".latest").hidden = author;
	strip.querySelector(".turns").hidden = !author;
	strip.hidden = false;
}

/** Fill in the counts of the strip from the queue’s rows: how many, and since when or whose turn. */
function showCounts () {
	let { view, rows } = queue;
	// Of all the search found, e.g. “3 of 12” for the picked authors
	strip.querySelector(".count").textContent =
		authors.length > 0 ? `${rows.filter(shows).length} of ${rows.length}` : rows.length;

	// Unknown until every row has its details, e.g. of a queue stored before PRs had steps
	if (view.role === "author") {
		let turns = strip.querySelector(".turns");
		let steps = rows.filter(shows).map(row => row.summary.step);
		turns.textContent = steps.includes(undefined)
			? ""
			: steps.filter(step => step.whose === "author").length;
	}
	else {
		// Requests to a team have no date for the user
		let dates = rows.filter(shows).map(row => row.summary.waitingSince);
		let known = dates.filter(Boolean);
		let latest = known.length > 0 ? Math.max(...known) : null;
		showTime(strip.querySelector(".latest"), dates.includes(undefined) ? undefined : latest);
	}
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
