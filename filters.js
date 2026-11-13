/** @import { Picked } from "./authors.js" */
let filters = document.querySelector("#filters");
let applied = filters.querySelector(".applied");
let controls = filters.querySelector(".controls");
let fold = filters.querySelector(".fold");

const foldKey = "review-queue:filters-folded";
/** Folded on the first visit, then as the user left them */
let folded = localStorage.getItem(foldKey) !== "false";
setFolded(folded);

// A value unfolds the controls with the focus on its own, e.g. on Author for “Author foo”. A tap beside the values opens the filter.
// Bars disable Author until the search ends, and a disabled button takes no focus
applied.addEventListener("click", event => {
	let control = document.getElementById(
		event.target.closest("[data-for]")?.dataset.for ?? "filter",
	);
	setFolded(false);
	(control.disabled ? fold : control).focus();
});

// No menu is open by then: a click on the fold button is a click outside it, and keyboard focus on the button is focus out of it, which both apply it
fold.addEventListener("click", () => setFolded(!folded));

/**
 * Say on the folded line what the controls apply, e.g. “Filter label:foo Author bar Exclude test”, or just “Filter”.
 * @param {{ filter?: string | null, author?: Picked, exclude?: string | null }} values - Only those whose control shows, e.g. no `exclude` in the author view
 */
export function showApplied ({ filter, author, exclude }) {
	let values = [
		filter && value("filter", "Filter", code(filter)),
		author &&
			value("author-button", author.key, author.faces.cloneNode(true), name(author.name)),
		exclude && value("display-button", "Exclude", code(exclude)),
	].filter(Boolean);

	// Nothing applied is the filter with nothing in it.
	// Spaces between, so a screen reader reads “label:foo Author bar”, not “label:fooAuthor bar”
	applied.replaceChildren(
		...(values.length > 0 ? values : [value("filter", "Filter")]).flatMap((button, i) =>
			i > 0 ? [" ", button] : [button]),
	);
}

/** Show the folded line or the controls, name what the fold button does next, and remember it for the next visit. */
function setFolded (value) {
	folded = value;
	applied.hidden = !folded;
	controls.hidden = folded;
	fold.ariaExpanded = `${!folded}`;
	fold.ariaLabel = fold.title = folded ? "Show filters" : "Hide filters";

	try {
		localStorage.setItem(foldKey, folded);
	}
	catch (error) {
		// A full storage, e.g. of stored queues, loses only the fold on the next visit
		console.warn("Couldn’t store the fold.", error);
	}
}

/** An applied value, e.g. “Filter label:foo”, which unfolds to the control with this id. */
function value (id, key, ...content) {
	let button = Object.assign(document.createElement("button"), { type: "button" });
	button.dataset.for = id;
	// Its name is what is applied, e.g. “Filter label:foo”, so a screen reader also hears what a press does, rather than guess it removes the value
	button.setAttribute("aria-description", "Edit");
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
