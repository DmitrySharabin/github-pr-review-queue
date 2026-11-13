/** @import { Pick } from "./authors.js" */
import { dismissMenus } from "./menu.js";

let filters = document.querySelector("#filters");
let applied = filters.querySelector(".applied");
let controls = filters.querySelector(".controls");
let fold = filters.querySelector(".fold");

/** @type {boolean | undefined} Unknown until the first {@link showApplied}, which reads the first view */
let folded;

// A value unfolds the controls with the focus on its own, e.g. on Author for “Author foo”.
// Bars disable Author until the search ends, and a disabled button takes no focus
applied.addEventListener("click", event => {
	let control = document.getElementById(event.target.closest("[data-for]")?.dataset.for);
	if (!control) {
		return;
	}

	setFolded(false);
	(control.disabled ? fold : control).focus();
});

// An open menu closes unapplied, as on Esc. Folded away, it would stay open unseen, and the next click would apply it
fold.addEventListener("click", () => {
	dismissMenus();
	setFolded(!folded);
});

/**
 * Say on the folded line what the controls apply, e.g. “Filter label:foo Author bar Exclude test”, or just “Filter”.
 * The first call folds the controls when they apply nothing, and unfolds them when something does, to change it
 * @param {{ filter?: string | null, author?: Pick, exclude?: string | null }} values - Only those whose control shows, e.g. no `exclude` in the author view
 */
export function showApplied ({ filter, author, exclude }) {
	let values = [
		filter && value("filter", "Filter", code(filter)),
		author &&
			value("author-button", author.key, author.faces.cloneNode(true), name(author.name)),
		exclude && value("display-button", "Exclude", code(exclude)),
	].filter(Boolean);

	folded ??= values.length === 0;
	// Nothing applied is the filter with nothing in it.
	// Spaces between, so a screen reader reads “label:foo Author bar”, not “label:fooAuthor bar”
	applied.replaceChildren(
		...(values.length > 0 ? values : [value("filter", "Filter")]).flatMap((button, i) =>
			i > 0 ? [" ", button] : [button]),
	);
	setFolded(folded);
}

/** Show the folded line or the controls, and name what the fold button does next. */
function setFolded (value) {
	folded = value;
	applied.hidden = !folded;
	controls.hidden = folded;
	fold.ariaExpanded = `${!folded}`;
	fold.ariaLabel = fold.title = folded ? "Show filters" : "Hide filters";
}

/** An applied value, e.g. “Filter label:foo”, which unfolds to the control with this id. */
function value (id, key, ...content) {
	let button = Object.assign(document.createElement("button"), { type: "button" });
	button.dataset.for = id;
	if (key) {
		button.append(
			Object.assign(document.createElement("span"), { className: "key", textContent: key }),
			" ",
		);
	}
	button.append(...content);
	return button;
}

function code (text) {
	return Object.assign(document.createElement("code"), { textContent: text });
}

function name (text) {
	return Object.assign(document.createElement("span"), { className: "name", textContent: text });
}
