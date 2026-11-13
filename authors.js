/**
 * @import { Summary } from "./pull-request.js"
 * @import { Row } from "./row.js"
 *
 * @typedef {object} Person - An author of PRs in the queue, named as in a {@link Summary}
 * @property {string} author - The login
 * @property {string} avatar
 * @property {string} [association] - GitHub’s `authorAssociation`, unknown for a picked author with no PRs left
 * @property {number} count - How many PRs in the queue are theirs
 */
import { isLogin } from "./pull-request.js";
import { plural } from "./plural.js";
import { highlight } from "./highlight.js";
import { applyOnClose } from "./menu.js";

/** The roles GitHub gives people added to the repo, or to the organization that owns it */
const roles = ["OWNER", "MEMBER", "COLLABORATOR"];

/** The repo’s collaborators among the picked authors, e.g. `?authors=@collaborators,foo`. No login has an `@`, as in GitHub’s `@me` */
export const collaborators = "@collaborators";

/** The most avatars the button shows. Its text says how many authors there are */
const limit = 3;

let form = document.querySelector("#authors");
let button = document.querySelector("#author-button");
let search = form.querySelector("input[type=search]");
let all = form.querySelector(".all input");
let insiders = form.querySelector(".collaborators");
let others = form.querySelector(".others");
let none = form.querySelector(".none");
let template = document.querySelector("#author");

/** @type {Map<string, Person>} By lowercase login */
let people = new Map();
/** How many PRs the queue has, which show when no one is picked */
let total = 0;
/** What the list shows once it closes, e.g. the rows of a refresh that ended while it was open */
let latest = { rows: [], authors: [] };
/** Whether “All collaborators” was picked, so later collaborators show too, rather than each of today’s */
let everyone = false;

/**
 * Whether a PR is by one of the authors, e.g. `["@collaborators", "foo"]` for the repo’s collaborators and foo. No authors means anyone.
 * @param {Pick<Summary, "author" | "association">} summary - Or a {@link Person}
 * @param {string[]} authors
 */
export function matches (summary, authors) {
	return (
		authors.length === 0 ||
		authors.some(author =>
			author === collaborators
				? roles.includes(summary.association)
				: isLogin(author, summary.author))
	);
}

/**
 * List the authors of the rows to pick from, the repo’s collaborators first, and check the picked ones.
 * The button says who is picked, e.g. “2 authors” after their faces.
 * @param {Row[]} rows
 * @param {string[]} authors - The picked ones, see {@link matches}
 */
export function showAuthors (rows, authors) {
	latest = { rows, authors };
	/** @type {Map<string, Person>} */
	let found = new Map();
	for (let { summary } of rows) {
		let { author, avatar, association } = summary;
		let key = author.toLowerCase();
		let person = found.get(key) ?? { author, avatar, association, count: 0 };
		person.count++;
		found.set(key, person);
	}
	// A picked author with no PRs left, e.g. all merged, stays in the list to unpick
	for (let author of authors) {
		if (author !== collaborators && !found.has(author.toLowerCase())) {
			found.set(author.toLowerCase(), {
				author,
				avatar: `https://github.com/${author}.png?size=40`,
				count: 0,
			});
		}
	}

	// No authors match anyone, but pick no one
	let picked =
		authors.length > 0 ? [...found.values()].filter(person => matches(person, authors)) : [];
	let text = button.querySelector(".text");
	text.textContent =
		authors.length === 0
			? "Author"
			: authors.length === 1 && authors[0] === collaborators
				? "Collaborators"
				: picked.length === 1
					? picked[0].author
					: `${picked.length} ${plural("author", picked.length)}`;
	button.ariaLabel = authors.length === 0 ? null : `Author: ${text.textContent}`;
	// The same faces stay, so they don’t flash while new images load, e.g. each time the list closes
	let faces = button.querySelector(".faces").cloneNode();
	faces.append(...picked.slice(0, limit).map(avatar));
	if (!faces.isEqualNode(button.querySelector(".faces"))) {
		button.querySelector(".faces").replaceWith(faces);
	}

	// Changes made in the open list stay, e.g. while a refresh ends, and so do the counts its checkboxes add up
	if (form.matches(":popover-open")) {
		return;
	}
	people = found;
	total = rows.length;
	everyone = authors.includes(collaborators);

	let sorted = [...people.values()].sort(
		(a, b) => b.count - a.count || a.author.localeCompare(b.author),
	);
	for (let [group, inside] of [
		[insiders, true],
		[others, false],
	]) {
		group.replaceChildren(
			group.querySelector("legend"),
			...sorted
				.filter(person => roles.includes(person.association) === inside)
				.map(person => option(person, picked.includes(person))),
		);
	}

	let members = sorted.filter(person => roles.includes(person.association));
	// A heading names a difference, so one group alone has none, e.g. a queue of outside contributors only
	for (let group of [insiders, others]) {
		group.querySelector("legend").hidden =
			members.length === 0 || members.length === sorted.length;
	}
	let prs = members.reduce((sum, person) => sum + person.count, 0);
	// Shown, not hidden, when the queue has no collaborators, so the filter stays where it was and says why it can’t pick anyone
	form.querySelector(".all small").textContent =
		members.length > 0
			? `${members.length} ${plural("person", members.length)} · ${prs} ${plural("PR", prs)}`
			: "None in this queue";
	narrow();
	update();
}

/** An author’s avatar, e.g. in the button. */
function avatar ({ avatar }) {
	let img = document.createElement("img");
	img.alt = "";
	img.src = avatar;
	return img;
}

/** A checkbox for an author, with how many PRs are theirs. The group says their role in the repo. */
function option (person, checked) {
	let label = template.content.firstElementChild.cloneNode(true);
	let box = label.querySelector("input");
	box.value = person.author;
	// As a default, so Esc goes back to it
	box.defaultChecked = checked;
	label.querySelector("img").src = person.avatar;
	label.querySelector(".login span").textContent = person.author;
	label.querySelector(".prs").textContent = person.count;
	return label;
}

/** The authors’ checkboxes, of one group or of all. */
function boxes (group = form) {
	return [...group.querySelectorAll("fieldset input")];
}

/** Show the authors whose login has what is typed, with it in bold, e.g. **ba**z for `ba`. */
function narrow () {
	let typed = search.value.trim();
	for (let label of form.querySelectorAll("fieldset label")) {
		let login = label.querySelector("input").value;
		label.hidden = !login.toLowerCase().includes(typed.toLowerCase());
		label.querySelector(".login span").replaceChildren(...highlight(login, typed));
	}

	for (let group of [insiders, others]) {
		group.hidden = !group.querySelector("label:not([hidden])");
	}
	// Picks every collaborator, not just those that match
	form.querySelector(".all").hidden = Boolean(typed);
	none.hidden = !insiders.hidden || !others.hidden;
	none.textContent = `No authors match “${typed}”`;
}

/** Check “All collaborators” when all are, and say how many PRs the picked authors have. */
function update () {
	let inside = boxes(insiders);
	let on = inside.filter(box => box.checked).length;
	// With no collaborators to check, it shows the pick itself, e.g. `@collaborators` kept after theirs were merged
	all.checked = inside.length > 0 ? on === inside.length : everyone;
	all.indeterminate = on > 0 && on < inside.length;
	all.disabled = inside.length === 0 && !everyone;

	let picked = boxes().filter(box => box.checked);
	let prs = picked.reduce((sum, box) => sum + people.get(box.value.toLowerCase()).count, 0);
	// Every PR when no one is picked
	let count = picked.length > 0 ? prs : total;
	form.querySelector(".show").textContent = `Show ${count} ${plural("PR", count)}`;
	form.querySelector(".clear").hidden = picked.length === 0 && !everyone;
}

form.addEventListener("change", event => {
	if (event.target === all) {
		everyone = all.checked;
		for (let box of boxes(insiders)) {
			box.checked = all.checked;
		}
	}
	// One collaborator picked by name, e.g. the queue’s only one, is just that person
	else if (insiders.contains(event.target)) {
		everyone = false;
	}
	update();
});

search.addEventListener("input", narrow);

form.querySelector(".clear").addEventListener("click", event => {
	everyone = false;
	for (let box of boxes()) {
		box.checked = false;
	}
	// Pressed from the keyboard, it hides itself and would drop the focus to the page, so the search field takes it
	if (event.currentTarget.matches(":focus-visible")) {
		search.focus();
	}
	update();
});

/** Whether the picks differ from the URL’s. */
function changed () {
	return (
		everyone !== latest.authors.includes(collaborators) ||
		boxes().some(box => box.checked !== box.defaultChecked)
	);
}

// “All collaborators” is the keyword, so a new collaborator’s PRs show too.
// No one picked means anyone, so the URL has no `authors`
form.addEventListener("formdata", ({ formData }) => {
	let inside = boxes(insiders);
	let every = everyone && inside.every(box => box.checked);
	let logins = boxes()
		.filter(box => box.checked && !(every && inside.includes(box)))
		.map(box => box.value);
	let authors = [...(every ? [collaborators] : []), ...logins].join(",");
	if (authors) {
		formData.set("authors", authors);
	}
	else {
		formData.delete("authors");
	}
});

// Built anew from the URL’s picks and the latest rows when nothing is applied, e.g. after Esc or a refresh that ended while the list was open
applyOnClose(form, {
	changed,
	open () {
		search.value = "";
		narrow();
	},
	discard: () => showAuthors(latest.rows, latest.authors),
});
