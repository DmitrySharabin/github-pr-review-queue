import GithubAPI from "https://cdn.jsdelivr.net/gh/madatajs/madata@063fc247b1a03924c836d74ea2f3d8fdc86ded2c/backends/github/api/github-api.js";
import { query, summarize } from "./pull-request.js";

let params = new URLSearchParams(location.search);
let repo = params.get("repo") ?? "DmitrySharabin/github-pr-review-queue";

let github = new GithubAPI("https://api.github.com/graphql");
let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let template = document.querySelector("#row");

/** Sort value of each column. `null` sorts last in both directions. */
const sortKeys = {
	diff: summary => size(summary.diff),
	diffSinceReview: summary => summary.diffSinceReview && size(summary.diffSinceReview),
	iterations: summary => summary.iterations,
	waitingSince: summary => summary.waitingSince && Date.now() - summary.waitingSince,
};

const units = [["day", 864e5], ["hour", 36e5], ["minute", 6e4]];
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** @type {{ summary: import("./pull-request.js").Summary, tr: HTMLTableRowElement }[]} */
let rows = [];

table.addEventListener("command", event => {
	if (event.command !== "--sort") {
		return;
	}

	let th = event.source.closest("th");
	let direction = th.ariaSort === "descending" ? "ascending" : "descending";

	for (let cell of table.tHead.querySelectorAll("[aria-sort]")) {
		cell.ariaSort = null;
	}

	th.ariaSort = direction;
	document.startViewTransition(sort);
});

refresh.addEventListener("click", load);
await load();

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

		let user = params.get("user") ?? github.user.username;
		let data = await github.load("https://api.github.com/graphql#" + query({ repo, user }));
		rows = data.search.nodes.map(pr => {
			let summary = summarize(pr, user);
			return { summary, tr: render(summary) };
		});

		if (rows.length > 0) {
			let oldest = Math.min(...rows.map(row => row.summary.waitingSince ?? Infinity));
			let count = rows.length === 1 ? "1 pull request awaits" : `${rows.length} pull requests await`;
			let updated = new Date().toLocaleTimeString("en", { timeStyle: "short" });
			table.caption.textContent = `${count} ${user}’s review in ${repo}. The oldest was requested ${ago(oldest)}. Updated at ${updated}.`;
			sort();
		}
		else {
			status.textContent = `Nothing awaits ${user}’s review in ${repo}.`;
		}

		table.hidden = rows.length === 0;
		status.hidden = rows.length > 0;
	}
	catch (error) {
		status.textContent = `Couldn’t load pull requests. ${describe(error)}`;
		status.hidden = false;
	}
	finally {
		progress.hidden = true;
		refresh.hidden = false;
		refresh.ariaDisabled = null;
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
		await new Promise(resolve => signIn.addEventListener("click", resolve, { once: true }));
		signIn.hidden = true;
		progress.hidden = false;
		status.textContent = "Loading pull requests…";
		await github.login();
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

function sort () {
	let th = table.querySelector("th[aria-sort]");
	let value = sortKeys[th.querySelector("button").value];
	let sign = th.ariaSort === "ascending" ? 1 : -1;

	rows.sort((a, b) => {
		let [x, y] = [value(a.summary), value(b.summary)];

		if (x === null || y === null) {
			return (x === null) - (y === null);
		}

		return sign * (x - y);
	});

	table.tBodies[0].replaceChildren(...rows.map(row => row.tr));
}

function render ({ number, title, url, author, avatar, diff, diffSinceReview, iterations, waitingSince }) {
	let tr = template.content.firstElementChild.cloneNode(true);

	tr.querySelector("img").src = avatar;
	let link = tr.querySelector("a");
	link.href = url;
	link.textContent = title;
	tr.querySelector("small").textContent = `#${number} by ${author}`;

	showDiff(tr.querySelector(".diff"), diff);
	showDiff(tr.querySelector(".since-review"), diffSinceReview);
	tr.querySelector(".iterations").textContent = iterations;

	let time = tr.querySelector("time");
	if (waitingSince) {
		time.dateTime = waitingSince.toISOString();
		time.title = waitingSince.toLocaleString("en");
		time.textContent = ago(waitingSince);
	}
	else {
		time.textContent = "—";
	}

	return tr;
}

function showDiff (cell, diff) {
	if (!diff) {
		cell.textContent = "—";
		return;
	}

	cell.querySelector("a").href = diff.url;
	cell.querySelector(".added").textContent = `+${diff.additions.toLocaleString("en")}`;
	cell.querySelector(".deleted").textContent = `−${diff.deletions.toLocaleString("en")}`;

	// Five squares, like GitHub’s: the share of added lines, then of deleted ones
	let added = Math.round(5 * diff.additions / (size(diff) || 1));
	let deleted = diff.deletions > 0 ? 5 - added : 0;
	cell.querySelector(".diffstat").append(...Array.from({ length: 5 }, (_, i) => {
		let square = document.createElement("span");
		square.className = i < added ? "added" : i < added + deleted ? "deleted" : "";
		return square;
	}));
}

function size (diff) {
	return diff.additions + diff.deletions;
}

function ago (date) {
	let elapsed = Date.now() - date;
	let [unit, length] = units.find(([, length]) => elapsed >= length) ?? units.at(-1);
	return relative.format(-Math.floor(elapsed / length), unit);
}
