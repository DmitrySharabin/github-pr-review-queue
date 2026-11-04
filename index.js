/** @import { Summary } from "./pull-request.js" */
import GithubAPI from "https://cdn.jsdelivr.net/gh/madatajs/madata@063fc247b1a03924c836d74ea2f3d8fdc86ded2c/backends/github/api/github-api.js";
import { details, query, search, summarize, sum } from "./pull-request.js";

let github = new GithubAPI("https://api.github.com/graphql");
let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let signOut = document.querySelector("#sign-out");
let controls = document.querySelector("#controls");
let tokenForm = document.querySelector("#token-form");
let rowTemplate = document.querySelector("#row");
let reviewerTemplate = document.querySelector("#reviewer");
let repoForm = document.querySelector("#repo-form");
let narrow = document.querySelector("#narrow");

/** Sort value of each column. `null` and `undefined` (still loading) sort last in both directions. */
const sortKeys = {
	diff: summary => size(summary.diff),
	diffSinceReview: summary => summary.diffSinceReview && size(summary.diffSinceReview),
	iterations: summary => summary.iterations,
	waitingSince: summary => summary.waitingSince && -summary.waitingSince,
};

/** Why “Changes since last review” counts the whole PR, keyed by the diff’s `whole` */
const wholeTitles = {
	"unreviewed": "Not reviewed yet, so this counts the whole pull request",
	"force-pushed": "A force push removed the reviewed commit, so this counts the whole pull request",
};

/** What each other reviewer did, keyed by their `state` */
const reviewerPhrases = {
	"awaiting": "has yet to review",
	"approved": "approved",
	"changes-requested": "requested changes",
	"commented": "commented",
};

const units = [["day", 864e5], ["hour", 36e5], ["minute", 6e4]];
// Short units, e.g. “11 min. ago”, keep the latest request on one line in the summary
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

/** @type {{ pr: object, summary: Summary, tr: HTMLTableRowElement }[]} */
let rows = [];
/** What the rows show: the URL parameters of their load, e.g. `{ repo: "foo/bar", filter: "label:baz" }` */
let shown;
/** @type {AbortController | undefined} Aborts the load in flight */
let loading;

// The last sort survives a reload, e.g. { column: "diff", direction: "ascending" }
let saved = JSON.parse(localStorage.getItem("review-queue:sort"));
if (saved) {
	markSort(saved);
}

table.addEventListener("command", event => {
	if (event.command !== "--sort") {
		return;
	}

	let th = event.source.closest("th");
	let sorted = { column: event.source.value, direction: th.ariaSort === "descending" ? "ascending" : "descending" };
	markSort(sorted);
	localStorage.setItem("review-queue:sort", JSON.stringify(sorted));
	document.startViewTransition(sort);
});

signIn.querySelector("button").addEventListener("click", () => github.login().catch(error => status.textContent = describe(error)));

tokenForm.addEventListener("submit", event => {
	event.preventDefault();
	// Madata stores and validates the token as it does after the popup, then fires mv-login, which login() waits for
	github.login({ accessToken: tokenForm.elements.token.value }).catch(error => status.textContent = describe(error));
});

// A token that works but can’t read the repo keeps the sign-in hidden, so signing out is the way to replace it
signOut.addEventListener("click", async () => {
	await github.logout();
	location.reload();
});

// The forms submit their fields as URL parameters, so the URL they open can be copied and reused
for (let form of [repoForm, narrow.querySelector("form")]) {
	form.addEventListener("formdata", ({ formData }) => {
		// An empty field means its default, e.g. the signed-in user: ?repo=foo/bar, not ?repo=foo/bar&user=
		for (let [name, value] of [...formData]) {
			if (!value) {
				formData.delete(name);
			}
		}
	});
}

narrow.addEventListener("toggle", () => {
	if (narrow.open) {
		narrow.querySelector("[name=filter]").focus();
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
	if (!event.canIntercept || event.hashChange || event.navigationType === "reload" || !current.get("repo") || !next.get("repo")) {
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

	for (let form of [repoForm, narrow.querySelector("form")]) {
		for (let field of form.elements) {
			if (field.name) {
				field.value = params.get(field.name);
			}
		}
	}

	// Each role opens the same queue, filter and all, from the other side
	for (let link of document.querySelectorAll("#summary .roles a")) {
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

	status.textContent = "Choose a repository to see its review queue.";
	progress.hidden = true;
	repoForm.hidden = false;
}

/**
 * Load the queue the URL asks for, and drop the results of a load still in flight.
 * The rows on screen stay until the new ones arrive, and those of the same queue, e.g. on a refresh or a new filter, update in place.
 */
async function load () {
	loading?.abort();
	loading = new AbortController();
	let { signal } = loading;

	// A missing parameter means its default, e.g. no `user` is the signed-in user. A repeated one counts once, as in the forms
	let params = new URLSearchParams(location.search);
	let view = Object.fromEntries(["repo", "user", "role", "filter"].map(name => [name, params.get(name)]));
	let { repo, role, filter } = view;
	let sameQueue = ["repo", "user", "role"].every(name => view[name] === shown?.[name]);
	let sameView = sameQueue && filter === shown.filter;

	// aria-disabled, unlike disabled, keeps focus on the button while it waits
	refresh.ariaDisabled = "true";
	status.textContent = "Loading pull requests…";
	progress.hidden = false;

	try {
		await login(repo);
		signal.throwIfAborted();
		controls.inert = false;

		// Madata signs in without a user when GitHub fails to answer anything but a 401, e.g. offline
		let user = view.user || github.user?.username;
		if (!user) {
			throw new Error("GitHub didn’t say who is signed in.");
		}

		/** Fill in the slow fields of these PRs’ rows, a few PRs per query. */
		let update = ids => Promise.all(details({ user, role, ids }).map(async text => {
			// A batch retries once on its own: GitHub drops a slow query without a readable response, or answers that it timed out
			let { nodes } = await graphql(text).catch(() => graphql(text));
			await Promise.all(nodes.map(async pr => {
				let row = rows.find(row => row.pr.id === pr.id);

				// A PR the search no longer finds, e.g. merged meanwhile, or rows a newer load owns, e.g. after a role switch
				if (!row || signal.aborted) {
					return;
				}

				let summary = summarize({ ...row.pr, ...pr }, user, role);
				await compare(repo, summary.diffSinceReview);
				// A newer load may have started during the comparison
				if (signal.aborted) {
					return;
				}

				// The search may have refreshed the cheap fields during the comparison, e.g. a new title
				fill(row, { ...summary, ...summarize(row.pr, user, role) });
			}));
		}));

		// Rows of another queue, e.g. before a role switch, stay on screen until the search replaces them, but don’t update
		let kept = sameQueue ? rows : [];

		// A refresh updates the rows on screen while the search looks for new ones, so it doesn’t wait for the search first.
		// A new filter may drop some of them, so it waits for the search to know which to update
		let early = sameView ? kept.map(row => row.pr.id) : [];
		let updating = update(early);

		let { search: found } = await graphql(query({ ...view, user }));
		signal.throwIfAborted();
		shown = view;

		// An author sees their own PRs, so some names change with the rows, e.g. “Awaiting review” becomes “Open”
		for (let element of document.querySelectorAll("[data-author]")) {
			element.textContent = role === "author" ? element.dataset.author : element.dataset.reviewer;
		}

		let previous = new Map(kept.map(row => [row.pr.id, row]));
		rows = found.nodes.map(pr => {
			let row = previous.get(pr.id) ?? {};
			row.pr = pr;
			// Without details the summary has no slow fields, so a refreshed row keeps its old ones until they arrive
			fill(row, { ...row.summary, ...summarize(pr, user, role) });
			return row;
		});
		sort();
		showSummary({ ...view, user });

		table.parentElement.hidden = rows.length === 0;
		repoForm.hidden = true;
		narrow.hidden = false;
		// The status names the progress bar, so it says “Loading” until there is nothing left to load
		if (rows.length === 0) {
			let matching = filter ? ` matching “${filter}”` : "";
			status.textContent = role === "author"
				? `${user} has no open pull requests${matching} in ${repo}.`
				: `Nothing${matching} awaits ${user}’s review in ${repo}.`;
		}
		status.hidden = rows.length > 0;

		await Promise.all([updating, update(rows.map(row => row.pr.id).filter(id => !early.includes(id)))]);
		signal.throwIfAborted();
		document.startViewTransition(sort);
		showSummary({ ...view, user });

		let time = document.querySelector("#updated time");
		let now = new Date();
		time.dateTime = now.toISOString();
		time.textContent = now.toLocaleTimeString("en", { timeStyle: "short" });
	}
	catch (error) {
		// The newer load shows its own outcome
		if (signal.aborted) {
			return;
		}

		// Rows of another view would sit under labels they don’t match, e.g. after a failed role switch, so they go,
		// with the filter of that view and the time they were updated at
		if (!sameView && shown !== view) {
			document.querySelector("#summary").hidden = true;
			table.parentElement.hidden = true;
			narrow.hidden = true;
			document.querySelector("#updated time").textContent = "";
		}

		status.textContent = `Couldn’t load pull requests. ${describe(error)}`;
		status.hidden = false;
		// Most failures come from the repo or the user, so the form lets the user check and fix them
		repoForm.hidden = false;
	}

	progress.hidden = true;
	refresh.ariaDisabled = null;
}

/** Fill the strip above the table: where, for whom, how many, since when. */
function showSummary ({ repo, user, role, filter }) {
	let strip = document.querySelector("#summary");

	let link = strip.querySelector(".repo");
	link.href = `https://github.com/${repo}`;
	link.textContent = repo;

	let person = strip.querySelector(".user");
	person.href = `https://github.com/${user}`;
	person.querySelector("img").src = `https://github.com/${user}.png?size=48`;
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

function graphql (text) {
	return github.load("https://api.github.com/graphql#" + text);
}

/** Replace a diff’s estimate with GitHub’s exact count, when it has a range to compare. */
async function compare (repo, diff) {
	if (!diff?.range) {
		return;
	}

	try {
		// NOTE: GitHub lists at most 300 files in a comparison
		let { files } = await github.load(`https://api.github.com/repos/${repo}/compare/${diff.range}`);
		Object.assign(diff, sum(files));
	}
	catch (error) {
		// One failed comparison should not hide the queue: the estimate stays
		console.warn(`Couldn’t compare ${diff.range}, showing the estimate.`, error);
	}
}

async function login (repo) {
	try {
		await github.login({ passive: true });
	}
	catch {
		// No stored token. The sign-in popup needs a click, or the browser blocks it
		status.textContent = `Sign in to see the pull requests in ${repo}.`;
		progress.hidden = true;
		signIn.hidden = false;
		// Waits for the sign-in, not the click: Madata’s login() never settles if the popup is closed, so the button stays to try again
		await new Promise(resolve => github.addEventListener("mv-login", resolve, { once: true }));
		signIn.hidden = true;
		progress.hidden = false;
		status.textContent = "Loading pull requests…";
	}
}

function describe (error) {
	// On an HTTP error, Madata throws GitHub’s response body, e.g. { message: "Bad credentials", status: "401" }
	if (!(error instanceof Error)) {
		return `GitHub answered: ${error.message ?? error}`;
	}

	// Madata drops the failed fetch’s error, so only its own message tells a network failure apart
	if (error.message === GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name)) {
		return navigator.onLine ? "GitHub’s API sent no readable response, which usually means it timed out." : "You’re offline.";
	}

	// A GraphQL error, e.g. a repo that does not exist
	return error.message;
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

function sort () {
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

	// A row already at its place stays, e.g. every row on a refresh that changes no order.
	// moveBefore() keeps a moved row’s focus and selected text, which insertBefore() drops. A new row isn’t on the page yet
	let body = table.tBodies[0];
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
}

/** Show a summary in its row, replacing the row only when it shows something new. */
function fill (row, summary) {
	let tr = render(summary);
	// An unchanged row stays, e.g. on a refresh, so a focused link or selected text in it stays too
	if (!row.tr?.isEqualNode(tr)) {
		row.tr?.replaceWith(tr);
		row.tr = tr;
	}

	row.summary = summary;
}

function render ({ number, title, url, author, avatar, diff, diffSinceReview, iterations, waitingSince, reviewers }) {
	let tr = rowTemplate.content.firstElementChild.cloneNode(true);

	let link = tr.querySelector(".title");
	link.href = url;
	link.textContent = title;
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

function showReviewers (cell, reviewers) {
	if (!reviewers?.length) {
		cell.textContent = reviewers ? "—" : "";
		return;
	}

	let list = document.createElement("ul");
	list.append(...reviewers.map(({ name, avatar, state, url }) => {
		let item = reviewerTemplate.content.firstElementChild.cloneNode(true);
		let link = item.querySelector("a");
		let image = item.querySelector("img");
		item.className = state;
		link.href = url;
		image.src = avatar;
		// On the link, so keyboard focus reaches it too
		image.alt = link.title = `${name} ${reviewerPhrases[state]}`;
		return item;
	}));
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
	cell.querySelector(".diffstat").style = `--additions: ${diff.additions}; --deletions: ${diff.deletions}`;

	if (diff.whole) {
		cell.classList.add("whole");
		// On the link, so keyboard focus reaches it too
		link.title = wholeTitles[diff.whole];
		cell.querySelector(".tag").hidden = diff.whole !== "force-pushed";
	}
}

function showTime (time, date) {
	time.dateTime = date?.toISOString() ?? "";
	time.title = date?.toLocaleString("en") ?? "";
	time.textContent = date ? ago(date) : date === null ? "—" : "";
}

function size (diff) {
	return diff.additions + diff.deletions;
}

function ago (date) {
	let elapsed = Date.now() - date;
	let [unit, length] = units.find(([, length]) => elapsed >= length) ?? units.at(-1);
	return relative.format(-Math.floor(elapsed / length), unit);
}
