import { plural } from "./plural.js";

let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let counter = document.querySelector("#counter");
let refresh = document.querySelector("#refresh");
let repoForm = document.querySelector("#repo-form");
let header = document.querySelector("header");
let failure = document.querySelector("#failure");
let updated = document.querySelector("#updated time");
let changes = document.querySelector("#updated .changes");
let strip = document.querySelector("#summary");
let delta = strip.querySelector(".delta");

// A toggle, not a one-way reveal, so the focus stays on it
for (let button of document.querySelectorAll(":is(.notice, #failure) > button")) {
	button.addEventListener("click", () => {
		let expanded = button.parentElement.classList.toggle("expanded");
		button.textContent = expanded ? "Show less" : "Show all";
	});
}

/**
 * Say that a load runs. Refresh waits, the last delta and failure dim, and the progress bar shows.
 * @param {{ comparing?: boolean }} [options] - Whether the load compares with the rows on screen.
 * A screen reader then hears that a refresh started and how it ended, e.g. “Updated at 5:44 PM, No changes”, even within one minute
 */
export function showLoading ({ comparing } = {}) {
	if (comparing) {
		changes.textContent = "Refreshing…";
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
}

/** Undo {@link showLoading} when the load ends, however it ends. */
export function showLoaded () {
	progress.hidden = true;
	counter.hidden = true;
	refresh.ariaDisabled = null;
	delta.classList.remove("stale");
	failure.classList.remove("stale");
}

/**
 * Count the PRs whose details arrived, on the progress bar and next to the buttons, e.g. “3 of 7 pull requests rechecked” on a refresh.
 * @param {"loaded" | "rechecked"} task
 * @param {number} done
 * @param {number} total
 */
export function showProgress (task, done, total) {
	progress.max = total;
	progress.value = done;
	progress.ariaValueText = `${done} of ${total}`;

	let count = document.createElement("b");
	count.textContent = done;
	counter.replaceChildren(count, ` of ${total} ${plural("pull request", total)} ${task}`);
	counter.hidden = false;
}

/**
 * Say when the queue on screen was updated, or nothing without a time.
 * @param {number} [at] - In epoch ms
 */
export function showUpdated (at) {
	if (!at) {
		updated.dateTime = "";
		updated.textContent = "";
		return;
	}

	let date = new Date(at);
	updated.dateTime = date.toISOString();
	// A stored queue may be days old, e.g. “Nov 1, 6:05 PM”
	let today = date.toDateString() === new Date().toDateString();
	let text = date.toLocaleString(
		"en",
		today
			? { timeStyle: "short" }
			: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
	);
	// The same time written again makes a screen reader say it again, as if a refresh ended, e.g. after a pick of authors
	if (updated.textContent !== text) {
		updated.textContent = text;
	}
}

/**
 * Show next to the count how many PRs the last load added and how many are gone, e.g. “+3” over “−2”.
 * Say it after the update time too.
 * Both or neither, so each keeps its place, e.g. “+3” over a muted “−0”. Without a delta, it clears both.
 * @param {{ added: number, left: number }} [delta]
 */
export function showDelta (delta) {
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
 * Show a card that says what went wrong, e.g. the form after a failed load, with a title and then the reason.
 * Focus moves to it, so a screen reader reads it even when the card was hidden until now.
 * Focus then doesn’t drop to the page either, e.g. from Refresh, which hides.
 * @param {HTMLElement} card - It holds a `.notice`
 * @param {string} title
 * @param {string} reason
 */
export function showNotice (card, title, reason) {
	let notice = card.querySelector(".notice");
	notice.querySelector("strong").textContent = title;
	notice.hidden = false;
	card.hidden = false;
	showReason(notice, reason);
	notice.focus();
	// The card says what went wrong. The status, hidden while a card shows, says nothing stale, e.g. “Loading”
	status.textContent = "";
}

/**
 * Say next to Refresh that a load failed and why, e.g. “Couldn’t refresh · Last updated at 4:09 PM” over “You’re offline. …”.
 * The rows stay as the last finished load left them, and focus stays where it was, e.g. on Refresh to try again.
 * A screen reader hears the reason after the update time, e.g. “Couldn’t refresh, Last updated at 4:09 PM, You’re offline. …”
 * @param {string} reason
 */
export function showFailure (reason) {
	header.classList.add("failed");
	showReason(failure, reason);
	// After what the search found, e.g. “1 new”, when the details of some PRs failed
	changes.textContent = [changes.textContent, reason].filter(Boolean).join(". ");
	// The header says why the load failed. The form of an earlier failure has nothing left to fix, and the status says nothing stale, e.g. “Loading”
	repoForm.hidden = true;
	status.textContent = "";
}

/** Hide the failure next to Refresh, e.g. after a load that didn’t fail. */
export function hideFailure () {
	header.classList.remove("failed");
}

/**
 * Put why a load failed in an element on screen, e.g. a notice. A long reason, e.g. GitHub’s whole answer with a link in it,
 * shows its first lines and a button for the rest, so the page keeps its layout. The text is measured while CSS clamps it. A reason that fits needs no button.
 */
function showReason (element, reason) {
	let text = element.querySelector("span");
	text.textContent = reason;
	let all = element.querySelector("button");
	element.classList.remove("expanded");
	all.textContent = "Show all";
	all.hidden = text.scrollHeight <= text.clientHeight;
}
