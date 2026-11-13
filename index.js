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
	isLogin,
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
	listFiles,
	nodes,
	notFound,
	signedIn,
	signedInUser,
} from "./github.js";
import { forget, restore, store, storedQueues } from "./queues.js";
import { fill, mark, relink, unmark } from "./row.js";
import { showSort, sort, sortBy } from "./sort.js";
import { showTime } from "./time.js";
import { offerRecent } from "./recent.js";
import { plural } from "./plural.js";
import { collaborators, matches, showAuthors } from "./authors.js";
import { applyOnClose, dismissMenus } from "./menu.js";
import { href, normalizeParams, viewKey, viewNames, viewOf } from "./view.js";

let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let counter = document.querySelector("#counter");
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
let header = document.querySelector("header");
let failure = document.querySelector("#failure");
let updated = document.querySelector("#updated time");
let changes = document.querySelector("#updated .changes");
let delta = strip.querySelector(".delta");
let filterForm = document.querySelector("#narrow");
let authorButton = document.querySelector("#author-button");
let authorForm = document.querySelector("#authors");
let displayButton = document.querySelector("#display-button");
let displayForm = document.querySelector("#display");
let forms = [repoForm, filterForm, authorForm, displayForm, ...strip.querySelectorAll("form")];

/** @type {Row[]} */
let rows = [];
/** The URL parameters of the load the rows show, e.g. `{ repo: "foo/bar", filter: "label:baz", exclude: "test" }` */
let shown;
/** Whose queue the rows show, e.g. the signed-in user’s when the URL names no `user` */
let shownUser;
/** Whose PRs show, e.g. `["@collaborators", "foo"]`, see {@link matches}. An author’s PRs are all theirs */
let authors = [];
/** @type {AbortController | undefined} Aborts the load in flight */
let loading;
/** @type {Map<string, Summary> | undefined} What the last finished load of this view showed, by PR id, for the next to mark what changed */
let seen;

table.addEventListener("command", event => sortBy(rows, event.source.value, { shows }));

// Opening a link in a marked row, e.g. its PR, is seeing what changed in it. A middle click opens a link too. A right click opens a menu instead
for (let type of ["click", "auxclick"]) {
	table.tBodies[0].addEventListener(type, event => {
		let tr = event.target.closest("a")?.closest("tr");
		if (tr && event.button < 2) {
			unmark(tr);
		}
	});
}

// A toggle, not a one-way reveal, so the focus stays on it
for (let button of document.querySelectorAll(":is(.notice, #failure) > button")) {
	button.addEventListener("click", () => {
		let expanded = button.parentElement.classList.toggle("expanded");
		button.textContent = expanded ? "Show less" : "Show all";
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
			for (let name of [...viewNames, "authors"]) {
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
	if (refresh.ariaDisabled !== "true") {
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
	let role = params.get("role");
	let filter = params.get("filter");
	let exclude = params.get("exclude");
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

	if (params.get("repo")) {
		// Other authors of the view on screen show the same rows, so nothing loads, e.g. not the details of every PR.
		// The last URL’s view may have failed instead, e.g. before a step back to other authors
		let view = viewOf(params);
		if (onlyAuthors && shown && viewKey(view) === viewKey(shown)) {
			return showQueue({ ...view, user: shownUser });
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

	// A missing parameter means its default, e.g. no `user` is the signed-in user. A repeated one counts once, as in the forms
	let params = new URLSearchParams(location.search);
	let view = viewOf(params);
	let { repo, role, filter } = view;
	// Another pattern counts every PR’s lines anew, so its rows are another queue’s
	let sameQueue =
		shown && viewKey({ ...view, filter: null }) === viewKey({ ...shown, filter: null });
	let sameView = sameQueue && filter === shown.filter;

	// Without the marks, a row with nothing new equals its next render, so it stays and keeps focus
	for (let { tr } of rows) {
		unmark(tr);
	}

	// A label added to the filter, e.g. by a click on it, keeps the rows on screen that have it. The search would find just those.
	// A search that found its maximum of 100 PRs may have missed others with the label, so then the rows wait for the search
	let label =
		sameQueue && rows.length < searchLimit ? addedLabel(shown.filter, filter) : undefined;
	if (label !== undefined) {
		rows = rows.filter(({ pr }) => hasLabel(pr, label));
		// The load marks what changed against the last finished load’s rows that stay on screen. Before the first load finishes there are none
		// NOTE: A PR that a refresh in flight already dropped isn’t among them, so it doesn’t count as left
		seen &&= new Map([...seen].filter(([id]) => rows.some(row => row.pr.id === id)));
	}
	// A load of another view, e.g. a new filter, finds PRs that aren’t new, so it compares with nothing
	else if (!sameView) {
		seen = undefined;
	}

	// Another view shows at once what it showed last, e.g. on the last visit, while it loads again.
	// Its rows then count as the last load’s, so the load marks what changed since
	let stored;
	try {
		stored = sameView || label !== undefined ? undefined : restore(view);
		if (stored) {
			// A row on screen of the same PR stays while it shows the same, e.g. with focus on the label just clicked
			let previous = new Map(rows.map(row => [row.pr.id, row]));
			rows = stored.rows.map(({ pr, summary }) => {
				let row = previous.get(pr.id) ?? {};
				row.pr = pr;
				// A row stored without details, e.g. of a PR deleted during its load, asks for them again
				row.detailed = summary.reviewers && pr;
				fill(row, summary);
				return row;
			});
			shownUser = stored.user;
			showUpdated(stored.at);
			seen = new Map(rows.map(row => [row.pr.id, row.summary]));
		}
	}
	catch (error) {
		// A queue this version can’t show, e.g. stored by an older one with a step since renamed, waits for the load, which stores it anew
		console.warn("Couldn’t show the stored queue.", error);
		stored = undefined;
	}

	if (stored || label !== undefined) {
		shown = view;
		showQueue({ ...view, user: shownUser });
	}

	// A refresh keeps the last delta, dimmed, until it ends. Another view has another count, e.g. one narrowed by a label
	if (!sameView) {
		showDelta();
	}
	// A screen reader hears that a refresh started and how it ended, e.g. “Updated at 5:44 PM, No changes”, even within one minute
	if (seen) {
		changes.textContent = "Refreshing…";
	}

	// A retry keeps the last failure in place until it ends, so the queue under it doesn’t move. Another view’s rows didn’t fail
	if (!sameView) {
		header.classList.remove("failed");
	}
	// aria-disabled, unlike disabled, keeps focus on the button while it waits
	refresh.ariaDisabled = "true";
	delta.classList.add("stale");
	failure.classList.add("stale");
	status.textContent = "Loading pull requests…";
	// Indeterminate until the search tells how many PRs need details
	progress.removeAttribute("value");
	progress.ariaValueText = null;
	counter.hidden = true;
	progress.hidden = false;

	// Nothing on screen yet, e.g. on a first visit or after a failed load. A stored token signs in without a card,
	// so bars stand in for the rows during the sign-in. Without one, they would flash before the sign-in card
	// NOTE: An expired token still shows them before the card
	if (strip.hidden && github.isAuthenticated()) {
		showSkeleton(view);
	}

	try {
		await login(repo, signal);
		signal.throwIfAborted();
		controls.inert = false;

		let user = view.user || signedInUser();

		// A queue stored without a `user` parameter is that of whoever was signed in then
		if (stored && stored.user !== user) {
			stored = undefined;
			// The rows on screen then show no view, so a failed search hides them
			shown = undefined;
			rows = [];
			seen = undefined;
			showDelta();
		}

		// Nothing on screen yet, e.g. after the sign-in card, or bars that wait for the user’s name
		if (strip.hidden || table.tBodies[0].querySelector(".skeleton")) {
			showSkeleton({ ...view, user });
		}

		// Unless values on screen are being checked, e.g. on a refresh
		let task = "loaded";

		// Rows of another queue, e.g. before a role switch, stay on screen until the search replaces them, but don’t update
		let kept = sameQueue || stored ? rows : [];

		let { repository, search: found } = await graphql(query({ ...view, user }), signal);
		signal.throwIfAborted();
		shown = view;
		shownUser = user;

		let previous = new Map(kept.map(row => [row.pr.id, row]));
		let stale = [];
		rows = found.nodes.map(pr => {
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
					task = "rechecked";
				}
			}
			return row;
		});
		showQueue({ ...view, user });
		if (stale.length > 0) {
			showProgress(task, 0, stale.length);
		}

		let failed = await fillDetails(stale, task, { ...view, user }, signal);
		signal.throwIfAborted();
		sort(rows, { animate: true, shows });
		showSummary({ ...view, user });

		let now = Date.now();
		showUpdated(now);
		// Rows whose details didn’t arrive, e.g. failed or of a deleted PR, show what they had, undimmed.
		// The next load asks for them again
		// Rows of other authors are off the page, so not in the table
		for (let { tr } of rows) {
			if (tr.classList.contains("stale")) {
				unmark(tr);
			}
		}

		// The user has seen what the search found, even when details failed
		let last = seen;
		seen = new Map(rows.map(row => [row.pr.id, row.summary]));
		if (last) {
			// NOTE: Counts the PRs of authors not picked too, e.g. “+1” for a new PR that doesn’t show
			showDelta(mark(rows, last));
		}

		// The search did refresh the queue, so a failure shows beside Refresh, never with the form
		if (failed) {
			showFailure(describe(failed.reason));
		}
		else {
			header.classList.remove("failed");
			store(view, { user, at: now, rows: rows.map(({ pr, summary }) => ({ pr, summary })) });
		}
	}
	catch (error) {
		// The newer load shows its own outcome
		if (signal.aborted) {
			return;
		}

		// Rows of another view would sit under labels they don’t match, e.g. after a failed role switch, so they go,
		// with the filter of that view and the time they were updated at. So do bars that stand in for rows, e.g. on a first visit
		if ((!sameView && shown !== view) || table.tBodies[0].querySelector(".skeleton")) {
			hideQueue();
			updated.textContent = "";
		}

		showDelta();
		// A repo or user that GitHub can’t find needs the form to fix them.
		// So does a failure with no finished load on screen, e.g. on a first visit, where most failures come from the repo or the user
		if (updated.textContent && !notFound.test(error?.message)) {
			showFailure(describe(error));
		}
		else {
			header.classList.remove("failed");
			showNotice(
				repoForm,
				`Couldn’t load the pull requests in ${repo}`,
				describe(error, "Check the repository and the user, then try again."),
			);
		}
	}

	progress.hidden = true;
	counter.hidden = true;
	refresh.ariaDisabled = null;
	delta.classList.remove("stale");
	failure.classList.remove("stale");
}

/**
 * Fill in the slow fields of these rows, a few PRs per query, and count them on the progress bar.
 * A failed query leaves its rows as they were, and the others fill in still.
 * @param {Row[]} stale
 * @param {string} task - What the progress bar counts, e.g. “rechecked” on a refresh
 * @param {View} view - The load’s, with the user it is for
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<PromiseRejectedResult | undefined>} The first failure, if any
 */
async function fillDetails (stale, task, { repo, user, role, exclude }, signal) {
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

/** Show the rows, sorted, with what goes around them: the strip above them, or why there are none. */
function showQueue ({ repo, user, role, filter }) {
	let shownRows = rows.filter(shows);
	showRole(role);
	sort(rows, { shows });
	showSummary({ repo, user, role, filter });

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
		showEmpty({ repo, user, role, filter });
	}
	status.hidden = shownRows.length > 0;
}

/**
 * Stand in for a queue that nothing shows yet, e.g. on a first visit, while its search runs.
 * The strip shows what the view tells, and rows of bars stand for the PRs.
 */
function showSkeleton ({ repo, user, role, filter }) {
	showRole(role);
	table.tBodies[0].replaceChildren(
		...Array.from({ length: 6 }, () =>
			skeletonTemplate.content.firstElementChild.cloneNode(true)),
	);
	showSummary({ repo, user, role, filter });
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

/** Count the PRs whose details arrived, on the progress bar and next to the buttons, e.g. “3 of 7 pull requests rechecked” on a refresh. */
function showProgress (task, done, total) {
	progress.max = total;
	progress.value = done;
	progress.ariaValueText = `${done} of ${total}`;

	let count = document.createElement("b");
	count.textContent = done;
	counter.replaceChildren(count, ` of ${total} ${plural("pull request", total)} ${task}`);
	counter.hidden = false;
}

/** Say why the queue is empty, e.g. “Nothing to review”, in the card and in the status, which a screen reader hears. */
function showEmpty ({ repo, user, role, filter }) {
	let author = role === "author";
	let you = isYou();
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

/** Say when the queue on screen was updated, from epoch ms. */
function showUpdated (at) {
	let date = new Date(at);
	updated.dateTime = date.toISOString();
	// A stored queue may be days old, e.g. “Nov 1, 6:05 PM”
	let today = date.toDateString() === new Date().toDateString();
	updated.textContent = date.toLocaleString(
		"en",
		today
			? { timeStyle: "short" }
			: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
	);
}

/**
 * Whether the queue is the signed-in user’s, so the page says “you” to them.
 * A URL with no user is the signed-in one’s, who may be unknown yet, e.g. during the sign-in
 */
function isYou () {
	let named = new URLSearchParams(location.search).get("user");
	return !named || isLogin(named, github.user?.username ?? "");
}

/** Fill the strip above the table: where, for whom, how many, since when. */
function showSummary ({ repo, user, role, filter }) {
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

	let count = strip.querySelector(".count");
	count.href = `https://github.com/pulls?q=${encodeURIComponent(search({ repo, user, role, filter }))}`;
	// Of all the search found, e.g. “3 of 12” for the picked authors
	count.textContent =
		authors.length > 0 ? `${rows.filter(shows).length} of ${rows.length}` : rows.length;

	// A reviewer sees when the last request came. An author sees how many PRs wait for them, or for the user they look at.
	let author = role === "author";
	let you = isYou();
	let time = strip.querySelector(".latest");
	let turns = strip.querySelector(".turns");
	strip.querySelector(".tally").textContent = !author
		? "Latest request"
		: you
			? "Your turn"
			: "Author’s turn";
	time.hidden = author;
	turns.hidden = !author;

	// Unknown until every row has its details, e.g. of a queue stored before PRs had steps
	if (author) {
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
		showTime(time, dates.includes(undefined) ? undefined : latest);
	}
	strip.hidden = false;
}

/**
 * Show next to the count how many PRs the last load added and how many are gone, e.g. “+3” over “−2”.
 * Say it after the update time too.
 * Both or neither, so each keeps its place, e.g. “+3” over a gray “−0”. Without a delta, it clears both.
 * @param {{ added: number, left: number }} [delta]
 */
function showDelta (delta) {
	let { added = 0, left = 0 } = delta ?? {};
	let changed = added + left > 0;
	for (let [name, text, count] of [
		["up", "+", added],
		["down", "−", left],
	]) {
		let line = strip.querySelector(`.delta .${name}`);
		line.textContent = changed ? text + count : "";
		line.classList.toggle("zero", count === 0);
	}

	changes.textContent = delta
		? [added && `${added} new`, left && `${left} gone`].filter(Boolean).join(", ") ||
			"No changes"
		: "";
}

async function login (repo, signal) {
	if (await signedIn(signal)) {
		return;
	}

	// No stored token. The sign-in popup needs a click, or the browser blocks it.
	// Whoever signs in may be someone else, e.g. after a token expired, so the queues of the last one go
	forget();
	hideQueue();
	showDelta();
	header.classList.remove("failed");
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

/**
 * Show a card that says what went wrong, e.g. the form after a failed load, with a bold line and then the reason.
 * Focus moves to it, so a screen reader reads it even when the card was hidden until now.
 * Focus then doesn’t drop to the page either, e.g. from Refresh, which hides.
 */
function showNotice (card, title, reason) {
	let notice = card.querySelector(".notice");
	notice.querySelector("strong").textContent = title;
	notice.hidden = false;
	card.hidden = false;
	showReason(notice, reason);
	notice.focus();
	// The card says it instead, and the status, hidden while a card shows, says nothing stale, e.g. “Loading”
	status.textContent = "";
}

/**
 * Say next to Refresh that a load failed and why, e.g. “Couldn’t refresh · Last updated at 4:09 PM” over “You’re offline. …”.
 * The rows stay as the last finished load left them, and focus stays where it was, e.g. on Refresh to try again.
 * A screen reader hears the reason after the update time, e.g. “Couldn’t refresh, Last updated at 4:09 PM, You’re offline. …”
 */
function showFailure (reason) {
	header.classList.add("failed");
	showReason(failure, reason);
	// After what the search found, e.g. “1 new”, when the details of some PRs failed
	changes.textContent = [changes.textContent, reason].filter(Boolean).join(". ");
	// The header says it instead. The form of an earlier failure has nothing left to fix, and the status says nothing stale, e.g. “Loading”
	repoForm.hidden = true;
	status.textContent = "";
}

/**
 * Put why a load failed in an element on screen, e.g. a notice. A long reason, e.g. GitHub’s whole answer with a link in it,
 * shows its first lines and a button for the rest, so the page keeps its layout. Measured clamped: a reason that fits needs no button.
 */
function showReason (element, reason) {
	let text = element.querySelector("span");
	text.textContent = reason;
	let all = element.querySelector("button");
	element.classList.remove("expanded");
	all.textContent = "Show all";
	all.hidden = text.scrollHeight <= text.clientHeight;
}
