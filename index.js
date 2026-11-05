/** @import { Summary, View } from "./pull-request.js" */
// The commit is also in index.html, which preloads the modules this one imports
import GithubAPI from "https://cdn.jsdelivr.net/gh/madatajs/madata@063fc247b1a03924c836d74ea2f3d8fdc86ded2c/backends/github/api/github-api.js";
import {
	addedLabel,
	details,
	hasLabel,
	outdated,
	query,
	search,
	sizes,
	summarize,
	sum,
	withLabel,
} from "./pull-request.js";
import { offerRecent } from "./recent.js";

let github = new GithubAPI("https://api.github.com/graphql");
let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let counter = document.querySelector("#counter");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let signOut = document.querySelector("#sign-out");
let controls = document.querySelector("#controls");
let tokenForm = document.querySelector("#token-form");
let rowTemplate = document.querySelector("#row");
let skeletonTemplate = document.querySelector("#skeleton");
let reviewerTemplate = document.querySelector("#reviewer");
let labelTemplate = document.querySelector("#label");
let repoForm = document.querySelector("#repo-form");
let narrow = document.querySelector("#narrow");
let empty = document.querySelector("#empty");
let strip = document.querySelector("#summary");
let header = document.querySelector("header");
let failure = document.querySelector("#failure");
let updated = document.querySelector("#updated time");
let changes = document.querySelector("#updated .changes");
let delta = strip.querySelector(".delta");
let filterForm = narrow.querySelector("form");
let forms = [repoForm, filterForm, ...strip.querySelectorAll("form")];

/** Sort value of each column. `null` and `undefined` (still loading) sort last in both directions. */
const sortKeys = {
	diff: summary => summary.diff && size(summary.diff),
	diffSinceReview: summary => summary.diffSinceReview && size(summary.diffSinceReview),
	iterations: summary => summary.iterations,
	waitingSince: summary => summary.waitingSince && -summary.waitingSince,
};

/** Why “Changes since last review” counts the whole PR, keyed by the diff’s `whole` */
const wholeTitles = {
	unreviewed: "Not reviewed yet, so this counts the whole pull request",
	"force-pushed":
		"A force push removed the reviewed commit, so this counts the whole pull request",
};

/** What each other reviewer did, keyed by their `state` */
const reviewerPhrases = {
	awaiting: "has yet to review",
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "commented",
};

const queuePrefix = "review-queue:queue:";

/** GitHub’s answer for a repo or user it can’t find, e.g. “Could not resolve to a Repository with the name 'foo/bar'.” */
const notFound = /Could not resolve to a (Repository|User)/;

/** How many labels a row shows before a button for the rest */
const labelLimit = 5;

const day = 864e5;
// The average month, since a wait spans no particular one
// NOTE: Temporal.Duration#round() with `relativeTo` counts calendar months. Not in Safari yet (November 2026)
const month = 30.44 * day;
// Units grow with the wait, e.g. “3 yr. ago”, not “1,036 days ago”
const units = [
	["year", 12 * month],
	["month", month],
	["day", day],
	["hour", 36e5],
	["minute", 6e4],
];
// Short units, e.g. “11 min. ago”, keep the latest request on one line in the summary
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
const days = new Intl.NumberFormat("en", { style: "unit", unit: "day", unitDisplay: "long" });

/** @type {{ pr: object, detailed?: object, summary: Summary, tr: HTMLTableRowElement }[]} `detailed` is the copy of `pr` the summary’s details were asked for */
let rows = [];
/** What the rows show: the URL parameters of their load, e.g. `{ repo: "foo/bar", filter: "label:baz" }` */
let shown;
/** Whose queue the rows show, e.g. the signed-in user’s when the URL names no `user` */
let shownUser;
/** @type {AbortController | undefined} Aborts the load in flight */
let loading;
/** @type {Map<string, HTMLTableRowElement> | undefined} The rows the last finished load of this view showed, by PR id, for the next to mark what changed */
let seen;

// The last sort survives a reload, e.g. { column: "diff", direction: "ascending" }
let saved = JSON.parse(localStorage.getItem("review-queue:sort"));
if (saved) {
	markSort(saved);
}

table.addEventListener("command", event => {
	let th = event.source.closest("th");
	let sorted = {
		column: event.source.value,
		direction: th.ariaSort === "descending" ? "ascending" : "descending",
	};
	markSort(sorted);
	localStorage.setItem("review-queue:sort", JSON.stringify(sorted));
	// No transition: its capture holds the new order back up to 300 ms on 100 rows, and when every row moves no one follows one.
	// Bars wait for the search, which sorts what it finds: sorting now would put the rows of the last queue, or none, in their place
	if (!table.tBodies[0].querySelector(".skeleton")) {
		sort();
	}
});

// Opening a link in a marked row, e.g. its PR, is seeing what changed in it. A middle click opens it too, a right click opens a menu
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
	forget();
	location.reload();
});

// The forms submit their fields as URL parameters, so the URL they open can be copied and reused
for (let form of forms) {
	form.addEventListener("formdata", ({ formData }) => {
		// An empty field means its default, e.g. the signed-in user: ?repo=foo/bar, not ?repo=foo/bar&user=
		for (let [name, value] of [...formData]) {
			if (!value) {
				formData.delete(name);
			}
		}
	});
}

// The repos and users of the stored queues, e.g. those opened yesterday. Forgetting one forgets its queues
// NOTE: The same repo in another case, e.g. `Foo/Bar`, shows twice.
// Clearing the repos forgets every queue, but the user field shows its chevron until it is opened
for (let name of ["repo", "user"]) {
	offerRecent(repoForm.elements[name], {
		values: () => [
			...new Set(
				storedQueues()
					.map(({ view }) => view.get(name))
					.filter(Boolean),
			),
		],
		remove: value => forget(view => view.get(name) === value),
	});
}

// A value in the summary turns into its form in place. Enter or ✓ opens the queue it names, Esc, ✕ or the pencil again goes back
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

narrow.addEventListener("toggle", () => {
	if (narrow.open) {
		filterForm.elements.filter.focus();
	}
});

refresh.addEventListener("click", () => {
	if (refresh.ariaDisabled !== "true") {
		load();
	}
});

// A filter, a role switch or another repo loads in place, so what it doesn’t change stays put, e.g. the open filter form.
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

	// The handler runs once the URL has changed. Focus and scroll stay where they were, e.g. on the Apply button
	event.intercept({ focusReset: "manual", scroll: "manual", handler: showView });
});

showView();

/** Show what the URL asks for, e.g. `?repo=foo/bar&filter=label:baz`. */
function showView () {
	let params = new URLSearchParams(location.search);
	let role = params.get("role");
	let filter = params.get("filter");

	// As defaults, so a reset, e.g. Esc in a summary form, goes back to what the URL says
	for (let form of forms) {
		for (let field of form.elements) {
			if (field.name) {
				field.defaultValue = params.get(field.name) ?? "";
			}
		}
		form.reset();
	}

	// Each role opens the same queue, filter and all, from the other side
	for (let link of strip.querySelectorAll(".roles a")) {
		let switched = new URLSearchParams(params);
		if (link.dataset.role) {
			switched.set("role", link.dataset.role);
		}
		else {
			switched.delete("role");
		}

		link.href = `?${switched}`;
		link.ariaCurrent = (link.dataset.role === "author") === (role === "author") ? "page" : null;
	}

	// The folded filter still shows what it filters by
	narrow.querySelector("summary code").textContent = filter;

	let unfiltered = new URLSearchParams(params);
	unfiltered.delete("filter");
	let clear = narrow.querySelector(".clear");
	clear.href = `?${unfiltered}`;
	clear.hidden = !filter;

	if (params.get("repo")) {
		return load();
	}

	// The form’s heading says what to do
	status.hidden = true;
	progress.hidden = true;
	repoForm.hidden = false;
}

/**
 * Load the queue the URL asks for, and stop a load still in flight.
 * The rows on screen stay until the new ones arrive, and those of the same queue, e.g. on a refresh or a new filter, update in place.
 */
async function load () {
	loading?.abort();
	loading = new AbortController();
	let { signal } = loading;

	// A missing parameter means its default, e.g. no `user` is the signed-in user. A repeated one counts once, as in the forms
	let params = new URLSearchParams(location.search);
	let view = Object.fromEntries(
		["repo", "user", "role", "filter"].map(name => [name, params.get(name)]),
	);
	let { repo, role, filter } = view;
	let sameQueue = ["repo", "user", "role"].every(name => view[name] === shown?.[name]);
	let sameView = sameQueue && filter === shown.filter;

	// Without the marks, a row with nothing new equals its next render, so it stays and keeps focus
	for (let { tr } of rows) {
		unmark(tr);
	}

	// A label added to the filter, e.g. by a click on it, keeps the rows on screen that have it: the search would find just those.
	// Unless the search found its maximum of 100 PRs: then others with the label may be past them
	let label = sameQueue && rows.length < 100 ? addedLabel(shown.filter, filter) : undefined;
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
	let stored = sameView || label !== undefined ? undefined : restore(view);
	if (stored) {
		// A row on screen of the same PR stays while it shows the same, e.g. with focus on the label just clicked
		let previous = new Map(rows.map(row => [row.pr.id, row]));
		rows = stored.rows.map(({ pr, summary }) => {
			let row = previous.get(pr.id) ?? {};
			row.pr = pr;
			// A row stored without details, e.g. of a PR deleted during its load, asks for them again
			row.detailed = summary.diffSinceReview && pr;
			fill(row, summary);
			return row;
		});
		shownUser = stored.user;
		showUpdated(new Date(stored.at));
		seen = new Map(rows.map(row => [row.pr.id, row.tr.cloneNode(true)]));
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
		await login(repo);
		signal.throwIfAborted();
		controls.inert = false;

		// Madata signs in without a user when GitHub fails to answer anything but a 401, e.g. offline, so this is a failure to connect too
		let user = view.user || github.user?.username;
		if (!user) {
			throw new Error(
				GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name),
			);
		}

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
		let done = 0;

		/** Fill in the slow fields of these PRs’ rows, a few PRs per query. */
		let update = ids =>
			Promise.all(
				details({ user, role, ids }).map(async text => {
					// A batch retries once on its own: GitHub drops a slow query without a readable response, or answers that it timed out
					let { nodes } = await graphql(text, signal).catch(() => graphql(text, signal));
					await Promise.all(
						nodes.map(async pr => {
							// Rows a newer load owns, e.g. after a role switch
							if (signal.aborted) {
								return;
							}

							// A PR deleted since the search, which GitHub answers with null: nothing to fill, and the next search drops its row
							if (!pr) {
								showProgress(task, ++done, ids.length);
								return;
							}

							let row = rows.find(row => row.pr.id === pr.id);

							let summary = summarize({ ...row.pr, ...pr }, user, role);
							await count(repo, summary.diffSinceReview, signal);
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
							showProgress(task, ++done, ids.length);
						}),
					);
				}),
			);

		// Rows of another queue, e.g. before a role switch, stay on screen until the search replaces them, but don’t update
		let kept = sameQueue || stored ? rows : [];

		let { search: found } = await graphql(query({ ...view, user }), signal);
		signal.throwIfAborted();
		shown = view;
		shownUser = user;

		let previous = new Map(kept.map(row => [row.pr.id, row]));
		let stale = [];
		rows = found.nodes.map(pr => {
			let row = previous.get(pr.id) ?? {};
			row.pr = pr;
			// Without details the summary has no slow fields, so a refreshed row keeps its old ones, dimmed, until they arrive
			fill(row, { ...row.summary, ...summarize(pr, user, role) });

			// A range left means its comparison failed, so the next load tries again.
			// The details are checked against their own copy: a load stopped before they came, e.g. by a label click, already replaced `pr`
			if (!row.detailed || row.summary.diffSinceReview.range || outdated(row.detailed, pr)) {
				stale.push(pr.id);
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

		await update(stale);
		signal.throwIfAborted();
		sort({ animate: true });
		showSummary({ ...view, user });

		let now = new Date();
		showUpdated(now);
		header.classList.remove("failed");
		store(view, { user, at: now, rows: rows.map(({ pr, summary }) => ({ pr, summary })) });

		let last = seen;
		seen = new Map(rows.map(row => [row.pr.id, row.tr.cloneNode(true)]));
		if (last) {
			showDelta(mark(last));
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
			strip.hidden = true;
			table.parentElement.hidden = true;
			empty.hidden = true;
			narrow.hidden = true;
			updated.textContent = "";
		}

		// Rows the load didn’t update show their old values as they are
		for (let tr of table.querySelectorAll("tr.stale")) {
			unmark(tr);
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

/** Show the rows, sorted, with what goes around them: the strip above them, or why there are none. */
function showQueue ({ repo, user, role, filter }) {
	showRole(role);
	sort();
	showSummary({ repo, user, role, filter });

	table.parentElement.hidden = rows.length === 0;
	empty.hidden = rows.length > 0;
	repoForm.hidden = true;
	// Nothing to narrow down, unless a filter is why nothing is left. Open, it may hold focus, e.g. on Apply after the terms were cleared
	narrow.hidden = rows.length === 0 && !filter && !narrow.open;
	// The status names the progress bar, so it says “Loading” until there is nothing left to load
	if (rows.length === 0) {
		showEmpty({ repo, user, role, filter });
	}
	status.hidden = rows.length > 0;
}

/** Stand in for a queue that nothing shows yet, e.g. on a first visit, while its search runs: the strip with what the view tells, and rows of bars. */
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

	table.parentElement.hidden = false;
	empty.hidden = true;
	repoForm.hidden = true;
	narrow.hidden = false;
}

/** Name things after the role, since an author sees their own PRs, e.g. “Awaiting review” becomes “Open”. */
function showRole (role) {
	for (let element of document.querySelectorAll("[data-author]")) {
		element.textContent = role === "author" ? element.dataset.author : element.dataset.reviewer;
	}
}

/** Count the PRs whose details arrived, on the progress bar and next to the buttons, e.g. “3 of 7 pull requests rechecked” on a refresh. */
function showProgress (task, done, total) {
	progress.max = total;
	progress.value = done;
	progress.ariaValueText = `${done} of ${total}`;

	let count = document.createElement("b");
	count.textContent = done;
	counter.replaceChildren(count, ` of ${total} pull requests ${task}`);
	counter.hidden = false;
}

/** Say why the queue is empty, e.g. “Nothing to review”, in the card and in the status, which a screen reader hears. */
function showEmpty ({ repo, user, role, filter }) {
	let author = role === "author";
	let title = author ? "No open pull requests" : "Nothing to review";
	let text = author
		? `${user} has no open pull requests in ${repo}.`
		: `No pull requests in ${repo} are waiting for ${user}’s review.`;
	if (filter) {
		title = "No matching pull requests";
		text = author
			? `None of ${user}’s open pull requests in ${repo}`
			: `None of the pull requests waiting for ${user}’s review in ${repo}`;
		text += ` match “${filter}”. Try other search terms, or clear the filter.`;
	}

	empty.classList.toggle("author", author);
	empty.classList.toggle("filtered", Boolean(filter));
	empty.querySelector("h2").textContent = title;
	empty.querySelector("p").textContent = text;
	empty.querySelector("a").href = `https://github.com/${repo}/pulls`;
	status.textContent = text;
}

function showUpdated (date) {
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
 * The key a view’s queue is stored under, e.g. `review-queue:queue:repo=foo%2Fbar&role=author`.
 * @param {View} view
 */
function queueKey (view) {
	return `${queuePrefix}${new URLSearchParams(Object.entries(view).filter(([, value]) => value))}`;
}

/**
 * What a view showed after its last full load, with when and for which user.
 * @param {View} view
 * @returns {{ user: string, at: string, rows: { pr: object, summary: Summary }[] } | undefined}
 */
function restore (view) {
	// JSON has no dates
	let revive = (key, value) => (key === "waitingSince" && value ? new Date(value) : value);
	return JSON.parse(localStorage.getItem(queueKey(view)), revive) ?? undefined;
}

/**
 * The keys of the stored queues, with the view each is of, e.g. `repo=foo%2Fbar` for `?repo=foo/bar`.
 * @returns {{ key: string, view: URLSearchParams }[]}
 */
function storedViews () {
	return Object.keys(localStorage)
		.filter(key => key.startsWith(queuePrefix))
		.map(key => ({ key, view: new URLSearchParams(key.slice(queuePrefix.length)) }));
}

/**
 * The stored queues, the latest first. Each read parses a whole queue, so it is slower than {@link storedViews}.
 * @returns {{ key: string, view: URLSearchParams, at: string }[]}
 */
function storedQueues () {
	return storedViews()
		.map(queue => ({ ...queue, at: JSON.parse(localStorage.getItem(queue.key)).at }))
		.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Remove the stored queues, e.g. the titles of private repos when the signed-in user may change, or those of one repo.
 * @param {(view: URLSearchParams) => boolean} [test] - Which ones, e.g. `view => view.get("repo") === "foo/bar"`
 */
function forget (test = () => true) {
	for (let { key, view } of storedViews()) {
		if (test(view)) {
			localStorage.removeItem(key);
		}
	}
}

function store (view, queue) {
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
	count.textContent = rows.length;

	// Requests to a team have no date for the user
	let dates = rows.map(row => row.summary.waitingSince);
	let known = dates.filter(Boolean);
	let latest = known.length > 0 ? new Date(Math.max(...known)) : null;
	// Unknown until every row has its details
	showTime(strip.querySelector(".latest"), dates.includes(undefined) ? undefined : latest);
	strip.hidden = false;
}

/**
 * Show next to the count how many PRs the last load added and how many are gone, e.g. “+3” over “−2”, and say it after the update time.
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

/**
 * GitHub’s answer to a GraphQL query, through Madata’s request() rather than load(): for a PR deleted since the search,
 * GitHub answers null and an error, and load() throws the whole answer away for it, the other PRs included.
 */
async function graphql (text, signal) {
	let { data, errors = [] } = await github.request(
		"https://api.github.com/graphql",
		{ query: text },
		"POST",
		{ signal: inTime(signal) },
	);
	errors = errors.filter(error => error.type !== "NOT_FOUND" || error.path?.[0] !== "nodes");

	// Joined as load() joins them, which describe() matches, e.g. “Could not resolve to a Repository”
	if (errors.length > 0) {
		throw new Error(errors.map(error => error.message).join("\n"));
	}

	return data;
}

/**
 * The signal for a request: it aborts with the load’s, or after 20 s, which describe() reads as “took too long”. That is twice the time GitHub gives a query.
 * A dropped connection, e.g. after the laptop slept, never answers otherwise.
 * @param {AbortSignal} signal - The load’s
 */
function inTime (signal) {
	return AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
}

/** Count a diff that summarize() left uncounted: exactly, when it has a range to compare, or else by the sizes of its commits. */
async function count (repo, diff, signal) {
	if (diff.range) {
		try {
			// NOTE: GitHub lists at most 300 files in a comparison
			let { files } = await github.request(
				`https://api.github.com/repos/${repo}/compare/${diff.range}`,
				{},
				"GET",
				{ signal: inTime(signal) },
			);
			Object.assign(diff, sum(files));
			// Exact now, so a later load of the unchanged PR needn’t compare again
			delete diff.range;
			delete diff.commits;
			return;
		}
		catch (error) {
			signal.throwIfAborted();
			// One failed comparison should not hide the queue: the commits’ sizes estimate the count instead
			// NOTE: A refresh whose comparison fails, or succeeds after one that failed, marks the cell as changed
			console.warn(`Couldn’t compare ${diff.range}, adding up its commits instead.`, error);
		}
	}

	if (diff.commits) {
		let text = sizes(diff.commits);
		// Retries once, as the details do. NOTE: A commit GitHub can’t resolve answers null, which fails the load
		let { nodes } = await graphql(text, signal).catch(() => graphql(text, signal));
		Object.assign(diff, sum(nodes));
		delete diff.commits;
	}
}

async function login (repo) {
	try {
		// NOTE: Can hang on a dropped connection as inTime() describes, e.g. when it fetches the user, and then Refresh stays disabled
		await github.login({ passive: true });
	}
	catch {
		// No stored token. The sign-in popup needs a click, or the browser blocks it.
		// Whoever signs in may be someone else, e.g. after a token expired, so the queues of the last one go
		forget();
		strip.hidden = true;
		table.parentElement.hidden = true;
		empty.hidden = true;
		narrow.hidden = true;
		showDelta();
		header.classList.remove("failed");
		status.hidden = false;
		status.textContent = `Sign in to see the pull requests in ${repo}.`;
		signIn.querySelector(".repo").textContent = repo;
		progress.hidden = true;
		signIn.hidden = false;
		// Waits for the sign-in, not the click: Madata’s login() never settles if the popup is closed, so the button stays to try again
		await new Promise(resolve => github.addEventListener("mv-login", resolve, { once: true }));
		signIn.hidden = true;
		progress.hidden = false;
		status.textContent = "Loading pull requests…";
	}
}

/**
 * Show a card that says what went wrong, e.g. the form after a failed load: a bold line, then the reason.
 * Focus moves to it, so a screen reader reads it even when the card was hidden until now, and focus doesn’t drop to the page, e.g. from Refresh, which hides.
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
	changes.textContent = reason;
	// The header says it instead: the form of an earlier failure has nothing left to fix, and the status says nothing stale, e.g. “Loading”
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

/**
 * Say in the user’s words what went wrong and what to do, e.g. “You’re offline. Check your connection, then try again.”
 * @param {unknown} error - What Madata threw
 * @param {string} [advice] - What to do about an error not known here, which shows GitHub’s own words
 */
function describe (error, advice = "Try again.") {
	// On an HTTP error, Madata throws GitHub’s response body: JSON, e.g. { message: "Bad credentials" }, or text, e.g. a 502’s HTML page.
	// Its own errors and GitHub’s GraphQL errors, e.g. a repo that doesn’t exist, are told apart by their messages
	let message = error?.message;
	let slow = "GitHub took too long to respond. Try again in a minute.";

	// Madata drops the failed fetch’s error, so only its own message tells a network failure apart, e.g. a request inTime() stopped
	if (message === GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name)) {
		return navigator.onLine ? slow : "You’re offline. Check your connection, then try again.";
	}

	// A text body, e.g. a 502’s HTML page
	if (message === undefined) {
		return slow;
	}

	// Madata joins GraphQL errors with line breaks, and the fields of one query may each fail with the same one
	message = [...new Set(message.split("\n"))].join("\n");

	let [, missing] = message.match(notFound) ?? [];

	// GitHub answers the same for a private repo the user can’t access, e.g. with a token for other repos
	if (missing === "Repository") {
		return "GitHub can’t find this repository, or your account or token can’t access it. Check the name, then try again.";
	}

	if (missing === "User") {
		return "GitHub can’t find this user. Check the name, or leave User empty to see your own queue.";
	}

	// The primary limit, e.g. “API rate limit exceeded for user ID 1”, and the secondary one, for too many requests at once
	if (/rate limit/i.test(message)) {
		return "GitHub is getting too many requests from this page. Wait a few minutes, then try again.";
	}

	if (message === "Bad credentials") {
		return "Your GitHub session has expired. Sign out, then sign in again.";
	}

	if (message === GithubAPI.phrase("invalid_access_token")) {
		return "GitHub didn’t accept this token. Check that you copied all of it and that it hasn’t expired.";
	}

	if (message === GithubAPI.phrase("popup_blocked")) {
		return "Your browser blocked the GitHub sign-in window. Allow pop-ups for this page, then try again.";
	}

	return `GitHub answered: “${message}”. ${advice}`;
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
 * @param {{ animate?: boolean }} [options] - Whether moved rows slide to their new places
 */
function sort ({ animate } = {}) {
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

/** Show a summary in its row, replacing the row only when it shows something new. */
function fill (row, summary) {
	let tr = render(summary);
	// Labels the user showed stay shown, so the row only changes when they do
	if (row.tr?.querySelector(`.labels > :nth-child(${labelLimit + 1}):not([hidden])`)) {
		showAllLabels(tr);
	}

	// An unchanged row stays, e.g. on a refresh, so a focused link or selected text in it stays too
	if (!row.tr?.isEqualNode(tr)) {
		row.tr?.replaceWith(tr);
		row.tr = tr;
	}

	row.summary = summary;
}

/**
 * Mark what changed since the last load: the PRs it didn’t show, and the cells that differ from it.
 * @param {Map<string, HTMLTableRowElement>} last - The rows it showed, by PR id
 * @returns {{ added: number, left: number }} How many PRs it didn’t show, and how many it showed that are gone, e.g. merged or reviewed
 */
function mark (last) {
	let added = 0;

	for (let { pr, tr } of rows) {
		let old = last.get(pr.id);
		let cells = old ? [...tr.cells].filter(cell => !same(cell, old.cells[cell.cellIndex])) : [];
		if (old && cells.length === 0) {
			continue;
		}

		let label = tr.querySelector("mark");
		label.textContent = old ? "changed" : "new";
		label.hidden = false;
		if (!old) {
			tr.classList.add("new");
			added++;
		}
		for (let cell of cells) {
			cell.classList.add("changed");
		}
	}

	let left = [...last.keys()].filter(id => !rows.some(row => row.pr.id === id)).length;
	return { added, left };
}

/** Remove the marks, leaving the row as {@link render} makes it, e.g. no `class=""`, so that it equals its next render. */
function unmark (tr) {
	let label = tr.querySelector("mark");
	label.hidden = true;
	label.textContent = "";

	for (let element of [tr, ...tr.cells]) {
		element.classList.remove("new", "changed", "stale");
		if (element.classList.length === 0) {
			element.removeAttribute("class");
		}
	}
}

/**
 * Whether two cells show the same thing. A time compares by its date alone, since its text, tooltip and class change as time passes,
 * e.g. “5 min. ago”, or “· 1,036 days” in the tooltip.
 * Labels compare all of them, shown or not, since the user may have shown them after the last load.
 */
function same (cell, other) {
	let [x, y] = [cell, other].map(element => {
		let clone = element.cloneNode(true);
		for (let time of clone.querySelectorAll("time")) {
			time.replaceWith(time.dateTime);
		}
		showAllLabels(clone);
		return clone;
	});

	return x.isEqualNode(y);
}

function render ({
	number,
	title,
	url,
	author,
	avatar,
	labels,
	diff,
	diffSinceReview,
	iterations,
	waitingSince,
	reviewers,
}) {
	let tr = rowTemplate.content.firstElementChild.cloneNode(true);

	let link = tr.querySelector(".title");
	link.href = url;
	link.textContent = title;
	showLabels(tr.querySelector(".headline"), labels);
	tr.querySelector(".number").textContent = `#${number}`;
	tr.querySelector(".author").textContent = author;
	tr.querySelector(".avatar img").src = avatar;
	for (let profile of tr.querySelectorAll(".avatar, .author")) {
		profile.href = `https://github.com/${author}`;
	}

	showDiff(tr.querySelector(".diff"), diff);
	showDiff(tr.querySelector(".since-review"), diffSinceReview);
	tr.querySelector(".iterations").textContent = iterations ?? "";

	showTime(tr.querySelector("time"), waitingSince);
	showReviewers(tr.querySelector(".reviewers"), reviewers);

	return tr;
}

/** Links to the queue of each label, e.g. `?repo=foo/bar&filter=label:"bug"`, the ones past {@link labelLimit} behind a button */
function showLabels (headline, labels) {
	if (!labels.length) {
		return;
	}

	let list = document.createElement("ul");
	list.className = "labels";
	list.ariaLabel = "Labels";
	list.append(
		...labels.map(({ name, color, description }, i) => {
			let item = labelTemplate.content.firstElementChild.cloneNode(true);
			let link = item.querySelector("a");
			let params = new URLSearchParams(location.search);
			params.set("filter", withLabel(params.get("filter"), name));
			link.href = `?${params}`;
			link.textContent = name;
			link.ariaLabel = `Filter by label ${name}`;
			link.title = description ?? "";
			item.style.setProperty("--color", `#${color}`);
			item.hidden = i >= labelLimit;
			return item;
		}),
	);

	let rest = labels.length - labelLimit;
	if (rest > 0) {
		let item = document.createElement("li");
		let button = document.createElement("button");
		button.className = "more";
		button.textContent = `+${rest}`;
		button.ariaLabel = `+${rest} more labels`;
		button.addEventListener("click", () => {
			let first = list.querySelector("li[hidden] a");
			showAllLabels(list);
			first.focus();
		});
		item.append(button);
		list.append(item);
	}

	headline.append(" ", list);
}

function showAllLabels (element) {
	for (let item of element.querySelectorAll(".labels li[hidden]")) {
		item.hidden = false;
	}

	element.querySelector(".labels .more")?.parentElement.remove();
}

function showReviewers (cell, reviewers) {
	if (!reviewers?.length) {
		cell.textContent = reviewers ? "—" : "";
		return;
	}

	let list = document.createElement("ul");
	list.append(
		...reviewers.map(({ name, avatar, state, url }) => {
			let item = reviewerTemplate.content.firstElementChild.cloneNode(true);
			let link = item.querySelector("a");
			let image = item.querySelector("img");
			item.className = state;
			link.href = url;
			image.src = avatar;
			// On the link, so keyboard focus reaches it too
			image.alt = link.title = `${name} ${reviewerPhrases[state]}`;
			return item;
		}),
	);
	cell.append(list);
}

function showDiff (cell, diff) {
	if (!diff) {
		cell.textContent = "";
		return;
	}

	// Re-requested with no new commits, or a PR with no changed lines at all
	if (size(diff) === 0) {
		cell.textContent = "No changes";
		return;
	}

	let link = cell.querySelector("a");
	link.href = diff.url;
	cell.querySelector(".added").textContent = `+${diff.additions.toLocaleString("en")}`;
	cell.querySelector(".deleted").textContent = `−${diff.deletions.toLocaleString("en")}`;
	cell.querySelector(".diffstat").style =
		`--additions: ${diff.additions}; --deletions: ${diff.deletions}`;

	if (diff.whole) {
		cell.classList.add("whole");
		// On the link, so keyboard focus reaches it too
		link.title = wholeTitles[diff.whole];
		cell.querySelector(".force-pushed").hidden = diff.whole !== "force-pushed";
	}
}

function showTime (time, date) {
	let elapsed = Date.now() - date;
	// The largest unit the wait rounds to at least one of, so 23.8 hours read “yesterday”, not “24 hr. ago”
	let [unit, length] =
		units.find(([, length], i) => elapsed >= length - (units[i + 1]?.[1] ?? 0) / 2) ??
		units.at(-1);
	// Months and years round off days, so the tooltip adds them, e.g. “Jan 4, 2024, 11:05 AM · 1,036 days”
	let rounded = Boolean(date) && length >= month;

	time.dateTime = date?.toISOString() ?? "";
	// To the minute, as GitHub’s own tooltips
	time.title = date?.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) ?? "";
	if (rounded) {
		time.title += ` · ${days.format(Math.round(elapsed / day))}`;
	}
	time.classList.toggle("rounded", rounded);
	// To the nearest, so the count agrees with the days, e.g. 1,036 days are “3 yr. ago”, not 2
	time.textContent = date
		? relative.format(-Math.round(elapsed / length), unit)
		: date === null
			? "—"
			: "";
}

function size (diff) {
	return diff.additions + diff.deletions;
}
