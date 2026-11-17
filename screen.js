/**
 * @import { Summary } from "./pull-request.js"
 * @import { View } from "./view.js"
 * @import { Row } from "./row.js"
 */
import { isYou } from "./github.js";
import { hidesDrafts, isLogin } from "./pull-request.js";
import { relink } from "./row.js";
import { chooseSort, showSort, sort } from "./sort.js";
import { collaborators, matches, showAuthors } from "./authors.js";
import { dismissMenus, passFocus } from "./menu.js";
import { href, viewKey } from "./view.js";
import { showDelta, showUpdated } from "./status.js";
import { clearCounts, showCounts, showSummary } from "./strip.js";
import { showApplied } from "./filters.js";
import { showDrafts } from "./drafts.js";
import { plural } from "./plural.js";

let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let skeletonTemplate = document.querySelector("#skeleton");
let repoForm = document.querySelector("#repo-form");
let filters = document.querySelector("#filters");
let fold = filters.querySelector(".fold");
let empty = document.querySelector("#empty");
let strip = document.querySelector("#summary");
let authorButton = document.querySelector("#author-button");
let authorForm = document.querySelector("#authors");
let displayButton = document.querySelector("#display-button");
let displayForm = document.querySelector("#display");
let draftsForm = document.querySelector("#drafts");

/**
 * @typedef {object} Queue - What the table shows
 * @property {View} view - The view the rows are of, e.g. `{ repo: "foo/bar", filter: "label:baz", exclude: "test" }`
 * @property {string} user - Whose queue it is, e.g. the signed-in user’s when the view names no `user`
 * @property {Row[]} rows
 * @property {number} [at] - When its rows last finished loading, in epoch ms
 * @property {Map<string, Summary>} [seen] - What they showed then, by PR id, for the next load to mark what changed
 * @property {string[]} [assignable] - Its authors GitHub lets be assigned in the repo, which counts them among the collaborators. Unknown until GitHub answers
 */
/** @type {Queue | undefined} None while nothing or bars are on screen. Only {@link showQueue} sets it, and {@link showSkeleton} and {@link hideQueue} clear it */
export let queue;
/** Whose PRs show, e.g. `["@collaborators", "foo"]`, see {@link matches}. An author’s PRs are all theirs */
let authors = [];
/** The URL’s `drafts`, see {@link hidesDrafts} */
let drafts = null;

// Sorts without a view transition, whose snapshot delays the new order by up to 300 ms on 100 rows. When every row moves, the eye follows none of them.
// Bars wait for the search, which sorts what it finds
table.addEventListener("command", event => {
	chooseSort(event.source.value);
	if (queue) {
		sort(queue.rows, { shows });
	}
});

// The card goes once its link shows the rows, so the focus moves to the control that undoes the link, rather than drop to the page.
// Folded, the filters hide that control, so the button that shows them takes the focus
empty.querySelector(".clear").addEventListener("click", event => {
	let control = document.getElementById(event.currentTarget.dataset.for);
	passFocus(event.currentTarget, control.checkVisibility() ? control : fold);
});

/**
 * Pick which PRs the table shows, as the URL does. {@link showQueue} shows the pick.
 * @param {{ authors: string[], drafts: string | null }} picks - Whose, e.g. `["@collaborators", "foo"]`, or none for everyone’s, and whether drafts, e.g. `show`
 */
export function pick (picks) {
	({ authors, drafts } = picks);
}

/** Whether the view hides a row as a draft. */
function hidden ({ summary }) {
	return summary.draft && hidesDrafts({ ...queue.view, drafts });
}

/** Whether the table shows a row, that is, whether its PR isn’t a hidden draft and is by one of the picked authors. */
function shows (row) {
	return !hidden(row) && matches(row.summary, authors, queue);
}

/**
 * Show a queue’s rows, sorted, with the strip above them and the update time, or why there are none.
 * @param {Queue} [next] - The queue to show, or the one on screen again, e.g. for other authors
 * @param {{ animate?: boolean }} [options] - Whether rows move to their new places, e.g. when a load ends
 */
export function showQueue (next = queue, { animate } = {}) {
	queue = next;
	let {
		view: { role, filter },
		user,
		rows,
		at,
	} = queue;
	let ready = rows.filter(row => !hidden(row));
	let shownRows = rows.filter(shows);
	// Those a press would show, so not those of authors not picked
	let hiddenDrafts = rows.filter(
		row => hidden(row) && matches(row.summary, authors, queue),
	).length;
	// The drafts of the picked authors, hidden or shown. With none, a press would change nothing
	let draftCount = rows.filter(
		row => row.summary.draft && matches(row.summary, authors, queue),
	).length;
	showRole(role);
	sort(rows, { animate, shows });
	showUpdated(at);
	showSummary(queue.view, user);
	showCounts(queue, shownRows, authors.length > 0 || hiddenDrafts > 0);

	table.parentElement.hidden = shownRows.length === 0;
	empty.hidden = shownRows.length > 0;
	repoForm.hidden = true;
	// The list counts the PRs it can show, so a hidden draft isn’t among them
	let author = showAuthors({ ...queue, rows: ready }, authors, rows.filter(hidden));
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
	showDraftsToggle(queue.view, draftCount);
	// Nothing to hide when the search found nothing
	if (rows.length === 0) {
		draftsForm.hidden = true;
	}
	// The status names the progress bar, so it says “Loading” until there is nothing left to load
	if (shownRows.length === 0) {
		showEmpty();
	}
	status.hidden = shownRows.length > 0;
	// A value shows only while its control does, e.g. no Exclude in the author view
	showApplied({
		filter,
		author,
		exclude: displayButton.hidden ? null : queue.view.exclude,
		drafts: hiddenDrafts,
	});
}

/**
 * Show the drafts toggle as the view sets it, or hide it while the filter asks for drafts, e.g. `is:draft`, which shows them anyway.
 * @param {View} view
 * @param {number} [count] - How many drafts the picked authors have, unknown while bars stand in for the rows
 */
function showDraftsToggle (view, count) {
	draftsForm.hidden = !hidesDrafts({ ...view, drafts: "hide" });
	showDrafts(hidesDrafts({ ...view, drafts }), count);
}

/**
 * Stand in for a queue that nothing shows yet, e.g. on a first visit, while its search runs. The queue on screen, if any, goes.
 * The strip shows what the view tells, and rows of bars stand for the PRs.
 * @param {View} view
 * @param {string | null} [user] - None until the sign-in ends when the view names none
 */
export function showSkeleton (view, user = view.user) {
	queue = undefined;
	showUpdated();
	showDelta();
	let { role } = view;
	showRole(role);
	table.tBodies[0].replaceChildren(
		...Array.from({ length: 6 }, () =>
			skeletonTemplate.content.firstElementChild.cloneNode(true)),
	);
	showSummary(view, user);
	clearCounts();

	table.parentElement.hidden = false;
	empty.hidden = true;
	repoForm.hidden = true;
	authorButton.hidden = role === "author";
	// No authors to list until the search ends, but the button names the picked ones, not those of the view before.
	// NOTE: `@collaborators,foo` reads “foo” until the rows say who the collaborators are
	let author = showAuthors({ rows: [] }, authors);
	authorButton.disabled = true;
	filters.hidden = false;
	displayButton.hidden = role === "author";
	showDraftsToggle(view);
	showApplied({
		filter: view.filter,
		author,
		exclude: displayButton.hidden ? null : view.exclude,
	});
}

/** Hide the queue and what goes around it, e.g. for the sign-in card or the form after a failed load. */
export function hideQueue () {
	queue = undefined;
	showUpdated();
	showDelta();
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
	let names = new Intl.ListFormat("en", { type: "disjunction" }).format(
		authors.map(name => (name === collaborators ? "the repo’s collaborators" : name)),
	);
	// Of the picked authors, or of anyone. With none shown, all of them are hidden drafts
	let theirs = rows.filter(row => matches(row.summary, authors, queue)).length;
	// The search found PRs, but none by the picked authors, e.g. after theirs were merged. The card names them, and Clear shows the others’
	let picked = authors.length > 0 && rows.length > 0 && theirs === 0;
	// The rows are those the filter found, so a card that counts them says so
	let matching = filter ? ` that match “${filter}”` : "";
	if (theirs > 0) {
		let one = theirs === 1;
		let prs = `${one ? "The only" : `All ${theirs}`} ${plural("pull request", theirs)}`;
		if (author) {
			text = `${prs} ${you ? "you have" : `${user} has`} open in ${repo}`;
		}
		else {
			let by = authors.length > 0 ? ` by ${names}` : "";
			text = `${prs}${by} waiting for ${whose} review in ${repo}`;
		}
		text += matching;
		text += one
			? " is a draft. Show drafts to see it."
			: " are drafts. Show drafts to see them.";
		title = "Nothing ready for review";
	}
	else if (picked) {
		title = "No matching pull requests";
		text = `None of the pull requests waiting for ${whose} review in ${repo}${matching} are by ${names}. Clear the authors to see the others.`;
	}
	else if (filter) {
		title = "No matching pull requests";
		text = author
			? `None of ${whose} open pull requests in ${repo}`
			: `None of the pull requests waiting for ${whose} review in ${repo}`;
		text += ` match “${filter}”. Try other search terms, or clear the filter.`;
	}

	empty.classList.toggle("author", author);
	// A card that says why the rows it could show are away has a link that shows them
	let narrowed = Boolean(filter) || picked || theirs > 0;
	empty.classList.toggle("filtered", narrowed);
	empty.classList.toggle("drafts", theirs > 0);
	empty.querySelector("h2").textContent = title;
	empty.querySelector("p").textContent = text;
	empty.querySelector(".github").href = `https://github.com/${repo}/pulls`;
	// The card’s way out, and the control that undoes it, which takes the focus once the card goes
	let clear = empty.querySelector(".clear");
	[clear.href, clear.textContent, clear.dataset.for] =
		theirs > 0
			? [href({ drafts: "show" }), "Show drafts", "drafts-button"]
			: picked
				? [href({ authors: null }), "Clear authors", "author-button"]
				: [href({ filter: null }), "Clear filter", "filter"];
	clear.hidden = !narrowed;
	// The same text written again makes a screen reader say it again, e.g. when the load that found nothing ends
	if (status.textContent !== text) {
		status.textContent = text;
	}
}

/**
 * Whether the queue on screen counts its rows as this view does, so they can stay, e.g. those of another filter.
 * Another pattern counts every PR’s lines anew, so its rows count as another view’s
 * @param {View} view
 */
export function countsAs (view) {
	return (
		Boolean(queue) &&
		viewKey({ ...queue.view, filter: null }) === viewKey({ ...view, filter: null })
	);
}

/**
 * Whether the queue on screen is of this view’s repo, user and role, e.g. under another filter or pattern, so its rows are of the PRs this view searches.
 * Logins and repos match in any case, as on GitHub. A view that names no user is the signed-in one’s, e.g. `?user=foo` for foo signed in.
 * A queue shown before the sign-in ends, e.g. a stored one, counts as the signed-in user’s until the load checks whose it is
 * @param {View} view
 */
export function sameQueue (view) {
	if (!queue) {
		return false;
	}

	let { repo, role } = queue.view;
	return (
		repo.toLowerCase() === view.repo.toLowerCase() &&
		role === view.role &&
		(view.user ? isLogin(view.user, queue.user) : !queue.view.user || isYou(queue.user))
	);
}

/**
 * Whether the queue on screen is of this view, e.g. not of the one before a role switch.
 * @param {View} view
 */
export function onScreen (view) {
	return Boolean(queue) && viewKey(queue.view) === viewKey(view);
}
