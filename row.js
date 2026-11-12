/**
 * @import { Summary } from "./pull-request.js"
 *
 * @typedef {object} Row - A PR in the queue and the row that shows it
 * @property {object} pr - The PR as the search found it
 * @property {object} [detailed] - The copy of `pr` the summary’s details were asked for
 * @property {Summary} summary
 * @property {HTMLTableRowElement} tr
 */
import { size, sum, withLabel } from "./pull-request.js";
import { showTime } from "./time.js";
import { plural } from "./plural.js";

let rowTemplate = document.querySelector("#row");
let reviewerTemplate = document.querySelector("#reviewer");
let labelTemplate = document.querySelector("#label");

/** Why a count with a pattern of ignored files counts every file, keyed by a diff’s `unsplit` */
const unsplitTitles = {
	"too-many-files":
		"GitHub lists at most 3,000 files of a pull request, so this counts excluded files too",
	unlisted: "GitHub didn’t send the list of files, so this counts excluded files too",
	commits:
		"This adds up the sizes of the commits since the review, so it counts excluded files too",
};

/** Why “Changes since last review” counts the whole PR, keyed by the diff’s `whole` */
const wholeTitles = {
	unreviewed: "Not reviewed yet, so this counts the whole pull request",
	"force-pushed":
		"A force push removed the reviewed commit, so this counts the whole pull request",
	older: "The reviewed commit isn’t among the last 100 commits, so this counts the whole pull request",
};

/** What each other reviewer did, keyed by their `state` */
const reviewerPhrases = {
	awaiting: "has yet to review",
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "commented",
};

/** What each step of an author’s PR says, keyed by its `name`. The author’s steps say what GitHub’s own buttons do, e.g. “Ready for review” */
const stepPhrases = {
	draft: () => "Ready for review",
	"request-review": () => "Request a review",
	"await-review": () => "Waiting for a review",
	"resolve-conflicts": () => "Resolve conflicts",
	"fix-checks": () => "Fix failing checks",
	"make-changes": () => "Make changes",
	"re-request": ({ logins }) => (logins.length > 1 ? "Re-request reviews" : "Re-request review"),
	reply: ({ count }) => `Reply to ${count} ${plural("conversation", count)}`,
	// A request to a team names no one
	waiting: ({ logins, count }) =>
		count > 1
			? `Waiting for ${count} reviews`
			: logins.length > 0
				? `Waiting for @${logins[0]}`
				: "Waiting for a team review",
	queued: () => "Queued to merge",
	"auto-merge": () => "Auto-merge enabled",
	"checks-running": () => "Checks are running",
	approved: () => "Merge pull request",
	"await-merge": () => "Waiting for a maintainer to merge",
};

/** How many labels a row shows before a button for the rest */
const labelLimit = 5;

/**
 * Show a summary in its row, replacing the row only when it shows something new.
 * @param {Partial<Row>} row - A new row has no `tr` yet
 * @param {Summary} summary
 */
export function fill (row, summary) {
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
 * The rows as they show now, by PR id, for a later {@link mark} to compare with.
 * @param {Row[]} rows
 * @returns {Map<string, HTMLTableRowElement>}
 */
export function snapshot (rows) {
	return new Map(rows.map(row => [row.pr.id, row.tr.cloneNode(true)]));
}

/**
 * Mark what changed since the last load: the PRs it didn’t show, and the cells that differ from it.
 * @param {Row[]} rows - The rows on screen
 * @param {Map<string, HTMLTableRowElement>} last - The rows it showed, by PR id
 * @returns {{ added: number, left: number }} How many PRs it didn’t show, and how many it showed that are gone, e.g. merged or reviewed
 */
export function mark (rows, last) {
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
export function unmark (tr) {
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
 * A cell that was empty, e.g. of a PR whose details failed, showed nothing to change from. Avatars alone are not empty.
 */
function same (cell, other) {
	if (!other.textContent.trim() && !other.querySelector("img")) {
		return true;
	}

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
	opened,
	draft,
	step,
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
	tr.querySelector(".author span").textContent = author;
	// An author’s PRs are all theirs, so the byline says when, not by whom
	tr.querySelector(opened ? ".by" : ".opened").remove();
	if (opened) {
		showTime(tr.querySelector(".opened time"), opened);
	}
	tr.querySelector(".avatar img").src = avatar;
	// As in GitHub’s list of pull requests, where a draft’s icon differs from an open PR’s
	if (draft) {
		let kind = tr.querySelector(".kind");
		kind.classList.add("draft");
		kind.role = "img";
		kind.ariaLabel = "Draft";
		kind.removeAttribute("aria-hidden");
	}
	for (let profile of tr.querySelectorAll(".avatar, .author")) {
		profile.href = `https://github.com/${author}`;
	}

	showStep(tr.querySelector(".step"), step, url);
	showDiff(tr.querySelector(".diff"), diff);
	showDiff(tr.querySelector(".since-review"), diffSinceReview);
	tr.classList.toggle("totals", Boolean(tr.querySelector(".total:not([hidden])")));
	tr.querySelector(".iterations").textContent = iterations === null ? "—" : (iterations ?? "");

	// An author’s step has waited for so long, a reviewer’s request was made so long ago
	showTime(tr.querySelector(".requested time"), waitingSince, { duration: Boolean(step) });
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
		button.ariaLabel = `+${rest} more ${plural("label", rest)}`;
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

/**
 * The step: text when others have the turn, else a button to where the author does it on GitHub, the PR’s page unless the step names another.
 * A draft’s button is quieter, since a draft waits for no one, e.g. “Ready for review”.
 */
function showStep (cell, step, url) {
	if (!step) {
		return;
	}

	let text = stepPhrases[step.name](step);
	if (step.whose === "others") {
		cell.append(text);
		return;
	}

	let link = Object.assign(document.createElement("a"), {
		href: step.url ?? url,
		target: "_blank",
		className: step.whose === "nobody" ? "action quiet" : "action",
		textContent: text,
	});
	cell.append(link);
}

function showReviewers (cell, reviewers) {
	if (!reviewers?.length) {
		cell.textContent = reviewers ? "—" : "";
		return;
	}

	let list = document.createElement("ul");
	list.append(
		...reviewers.map(({ name, avatar, state, url, earlier }) => {
			let item = reviewerTemplate.content.firstElementChild.cloneNode(true);
			let link = item.querySelector("a");
			let image = item.querySelector("img");
			item.className = state;
			item.classList.toggle("earlier", Boolean(earlier));
			link.href = url;
			image.src = avatar;
			// On the link, so keyboard focus reaches it too
			image.alt =
				link.title = `${name} ${earlier ? "approved an earlier version" : reviewerPhrases[state]}`;
			return item;
		}),
	);
	cell.append(list);
}

/** A diff’s figures, e.g. “+1,200 −30” */
function showFigures (figures, { additions, deletions }) {
	figures.querySelector(".added").textContent = `+${additions.toLocaleString("en")}`;
	figures.querySelector(".deleted").textContent = `−${deletions.toLocaleString("en")}`;
}

/** Text a screen reader hears, which the figures’ look says to sighted users */
function spoken (text) {
	return Object.assign(document.createElement("span"), {
		className: "spoken",
		textContent: text,
	});
}

function showDiff (cell, diff) {
	if (!diff) {
		cell.textContent = "";
		return;
	}

	let total = diff.ignored && sum([diff, diff.ignored]);

	// Re-requested with no new commits, or a PR with no changed lines at all.
	// NOTE: In a row with a total, it stays centered, below the other size’s first line
	if (size(total ?? diff) === 0) {
		cell.textContent = "No changes";
		return;
	}

	let link = cell.querySelector("a");
	link.href = diff.url;
	showFigures(link, diff);
	cell.querySelector(".diffstat").style =
		`--additions: ${diff.additions}; --deletions: ${diff.deletions}`;

	// The lines of every file, ignored ones too, under those of the rest, e.g. “+650 −32 total”.
	// Without a split, e.g. in a sum of commits, the figures are the total already, gray as a stand-in
	if (diff.unsplit) {
		cell.classList.add("unsplit");
		link.title = unsplitTitles[diff.unsplit];
		link.append(spoken(" with excluded files"));
	}
	else if (total && size(diff.ignored) > 0) {
		let all = cell.querySelector(".total");
		showFigures(all, total);
		all.hidden = false;
		cell.querySelector("small").hidden = false;
		// Sighted users tell the two lines apart by the word “total” under the first,
		// so a screen reader hears the link as “+585 −2 without excluded files”, then “+650 −2 total”
		link.append(spoken(" without excluded files"));
	}

	if (diff.whole) {
		cell.classList.add("whole");
		// On the link, so keyboard focus reaches it too
		link.title = [wholeTitles[diff.whole], unsplitTitles[diff.unsplit]]
			.filter(Boolean)
			.join(". ");
		cell.querySelector(".force-pushed").hidden = diff.whole !== "force-pushed";
	}
}
