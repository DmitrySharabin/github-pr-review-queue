/** @import { Summary } from "./pull-request.js" */
import GithubAPI from "https://cdn.jsdelivr.net/gh/madatajs/madata@063fc247b1a03924c836d74ea2f3d8fdc86ded2c/backends/github/api/github-api.js";
import { details, query, search, summarize, sum } from "./pull-request.js";

let params = new URLSearchParams(location.search);
let repo = params.get("repo");
let filter = params.get("filter");

let github = new GithubAPI("https://api.github.com/graphql");
let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let signOut = document.querySelector("#sign-out");
let token = document.querySelector("#token");
let template = document.querySelector("#row");
let reviewerTemplate = document.querySelector("#reviewer");
let choose = document.querySelector("#choose");
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

// The last sort survives a reload, e.g. { column: "diff", direction: "ascending" }
let sorted = JSON.parse(localStorage.getItem("review-queue:sort"));
if (sorted) {
	sortBy(sorted);
}

table.addEventListener("command", event => {
	if (event.command !== "--sort") {
		return;
	}

	let th = event.source.closest("th");
	sorted = { column: event.source.value, direction: th.ariaSort === "descending" ? "ascending" : "descending" };
	sortBy(sorted);
	localStorage.setItem("review-queue:sort", JSON.stringify(sorted));
	document.startViewTransition(sort);
});

signIn.querySelector("button").addEventListener("click", () => github.login().catch(error => status.textContent = describe(error)));

token.addEventListener("submit", event => {
	event.preventDefault();
	// Madata stores and validates the token as it does after the popup, then fires mv-login, which login() waits for
	github.login({ accessToken: token.elements.token.value }).catch(error => status.textContent = describe(error));
});

// A token that works but can’t read the repo keeps the sign-in hidden, so signing out is the way to replace it
signOut.addEventListener("click", async () => {
	await github.logout();
	location.reload();
});

// The forms submit their fields as URL parameters, so the URL they open can be copied and reused
for (let form of [choose, narrow.querySelector("form")]) {
	for (let field of form.elements) {
		if (field.name) {
			field.value = params.get(field.name);
		}
	}

	form.addEventListener("formdata", ({ formData }) => {
		// An empty field means its default, e.g. the signed-in user: ?repo=foo/bar, not ?repo=foo/bar&user=
		for (let [name, value] of [...formData]) {
			if (!value) {
				formData.delete(name);
			}
		}
	});
}

// The folded filter still shows what it filters by
narrow.querySelector("summary code").textContent = filter;

let unfiltered = new URLSearchParams(params);
unfiltered.delete("filter");
let clear = narrow.querySelector(".clear");
clear.href = `?${unfiltered}`;
clear.hidden = !filter;
narrow.addEventListener("toggle", () => {
	if (narrow.open) {
		narrow.querySelector("[name=filter]").focus();
	}
});

if (repo) {
	refresh.addEventListener("click", load);
	load();
}
else {
	status.textContent = "Choose a repository to see its review queue.";
	progress.hidden = true;
	choose.hidden = false;
}

/** Load the queue. A refresh keeps the current rows on screen until the new ones arrive. */
async function load () {
	// aria-disabled, unlike disabled, keeps focus on the button while it waits
	if (refresh.ariaDisabled === "true") {
		return;
	}

	refresh.ariaDisabled = "true";
	status.textContent = "Loading pull requests…";
	progress.hidden = false;

	try {
		await login();
		signOut.hidden = false;

		// Madata signs in without a user when GitHub fails to answer anything but a 401, e.g. offline
		let user = params.get("user") || github.user?.username;
		if (!user) {
			throw new Error("GitHub didn’t say who is signed in.");
		}

		let { search: found } = await graphql(query({ repo, user, filter }));
		let previous = new Map(rows.map(row => [row.pr.id, row]));
		rows = found.nodes.map(pr => {
			let row = previous.get(pr.id) ?? {};
			row.pr = pr;
			// Without details the summary has no slow fields, so a refreshed row keeps its old ones until they arrive
			fill(row, { ...row.summary, ...summarize(pr, user) });
			return row;
		});
		sort();
		showSummary(user);

		table.parentElement.hidden = rows.length === 0;
		choose.hidden = true;
		// The status names the progress bar, so it says “Loading” until there is nothing left to load
		if (rows.length === 0) {
			status.textContent = `Nothing awaits ${user}’s review in ${repo}${filter ? ` that matches “${filter}”` : ""}.`;
		}
		status.hidden = rows.length > 0;

		await Promise.all(details({ user, ids: rows.map(row => row.pr.id) }).map(async text => {
			// A batch retries once on its own: GitHub drops a slow query without a readable response, or answers that it timed out
			let { nodes } = await graphql(text).catch(() => graphql(text));
			await Promise.all(nodes.map(async pr => {
				let row = rows.find(row => row.pr.id === pr.id);
				let summary = summarize({ ...row.pr, ...pr }, user);
				await compare(summary.diffSinceReview);
				fill(row, summary);
			}));
		}));
		document.startViewTransition(sort);
		showSummary(user);

		let updated = document.querySelector("#updated");
		let now = new Date();
		updated.querySelector("time").dateTime = now.toISOString();
		updated.querySelector("time").textContent = now.toLocaleTimeString("en", { timeStyle: "short" });
		updated.hidden = false;
	}
	catch (error) {
		status.textContent = `Couldn’t load pull requests. ${describe(error)}`;
		status.hidden = false;
		// Most failures come from the repo or the reviewer, so the form lets the user check and fix them
		choose.hidden = false;
	}
	finally {
		progress.hidden = true;
		refresh.hidden = false;
		refresh.ariaDisabled = null;
	}
}

/** Fill the strip above the table: where, for whom, how many, since when. */
function showSummary (user) {
	let summary = document.querySelector("#summary");

	let link = summary.querySelector(".repo");
	link.href = `https://github.com/${repo}`;
	link.textContent = repo;

	let reviewer = summary.querySelector(".reviewer");
	reviewer.href = `https://github.com/${user}`;
	reviewer.querySelector("img").src = `https://github.com/${user}.png?size=48`;
	reviewer.querySelector("span").textContent = user;

	let awaiting = summary.querySelector(".count");
	awaiting.href = `https://github.com/pulls?q=${encodeURIComponent(search({ repo, user, filter }))}`;
	awaiting.textContent = rows.length;

	// Requests to a team have no date for the user
	let dates = rows.map(row => row.summary.waitingSince);
	let known = dates.filter(Boolean);
	let latest = known.length > 0 ? new Date(Math.max(...known)) : null;
	// Unknown until every row has its details
	showTime(summary.querySelector(".latest"), dates.includes(undefined) ? undefined : latest);
	summary.hidden = false;
	narrow.hidden = false;
}

function graphql (text) {
	return github.load("https://api.github.com/graphql#" + text);
}

/** Replace a diff’s estimate with GitHub’s exact count, when it has a range to compare. */
async function compare (diff) {
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

async function login () {
	try {
		await github.login({ passive: true });
	}
	catch {
		// No stored token. The sign-in popup needs a click, or the browser blocks it
		status.textContent = `Sign in to see the pull requests awaiting review in ${repo}.`;
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
function sortBy ({ column, direction }) {
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

	table.tBodies[0].replaceChildren(...rows.map(row => row.tr));
}

/** Show a summary in its row, replacing what the row showed before. */
function fill (row, summary) {
	let tr = render(summary);
	row.tr?.replaceWith(tr);
	Object.assign(row, { summary, tr });
}

function render ({ number, title, url, author, avatar, diff, diffSinceReview, iterations, waitingSince, reviewers }) {
	let tr = template.content.firstElementChild.cloneNode(true);

	tr.querySelector("img").src = avatar;
	let link = tr.querySelector("a");
	link.href = url;
	link.textContent = title;
	tr.querySelector("small").textContent = `#${number} by ${author}`;

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
	list.append(...reviewers.map(({ name, avatar, state }) => {
		let item = reviewerTemplate.content.firstElementChild.cloneNode(true);
		let image = item.querySelector("img");
		item.className = state;
		image.src = avatar;
		image.alt = item.title = `${name} ${reviewerPhrases[state]}`;
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
