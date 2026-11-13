/**
 * @import { View } from "./view.js"
 * @import { Queue } from "./screen.js"
 */
import { search } from "./pull-request.js";
import { isYou } from "./github.js";
import { showTime } from "./time.js";
import { matches } from "./authors.js";

let strip = document.querySelector("#summary");

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

/**
 * Fill the strip above the table with what a view tells: where, for whom, and what its counts mean. {@link showCounts} fills them in.
 * @param {View} view
 * @param {string | null} user - Whose queue it is, or none until the sign-in ends
 */
export function showSummary (view, user) {
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

/**
 * Fill in the counts of the strip from a queue’s rows: how many, and since when or whose turn.
 * @param {Queue} queue
 * @param {string[]} authors - Whose PRs show, see {@link matches}
 */
export function showCounts ({ view, rows }, authors) {
	let shows = row => matches(row.summary, authors);
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

/** Empty the counts of the strip, e.g. while bars stand in for the rows. */
export function clearCounts () {
	// Unknown until the search ends. Without a link, it is no empty stop for the keyboard
	let count = strip.querySelector(".count");
	count.textContent = "";
	count.removeAttribute("href");
	showTime(strip.querySelector(".latest"));
	strip.querySelector(".turns").textContent = "";
}
