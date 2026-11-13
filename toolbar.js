let filters = document.querySelector("#filters");
let applied = filters.querySelector(".applied");
let controls = filters.querySelector(".controls");
let fold = filters.querySelector(".fold");
let authorButton = document.querySelector("#author-button");

/** @type {boolean | undefined} Unknown until the first {@link showApplied}, which reads the first view */
let folded;

// A click on a value unfolds the controls with the focus on its own, e.g. on Author for “Author foo”
applied.addEventListener("click", event => {
	let control = document.getElementById(
		event.target.closest("[data-for]")?.dataset.for ?? "filter",
	);
	setFolded(false);
	control.focus();
});

fold.addEventListener("click", () => setFolded(!folded));

/**
 * Say on the folded line what the controls apply, e.g. “Filter label:foo · Author bar · Exclude test”, or just “Filter”.
 * The first call folds the controls when they apply nothing, and unfolds them when something hides rows, to change it
 */
export function showApplied () {
	let filter = document.querySelector("#filter").defaultValue;
	let exclude = document.querySelector("#exclude").defaultValue;
	let author = authorButton.classList.contains("set");

	let values = [];
	if (filter) {
		values.push(value("filter", "Filter", code(filter)));
	}
	if (author) {
		let text = authorButton.querySelector(".text").textContent;
		// The key agrees with the button’s text, e.g. “Authors Collaborators”. “3 authors” names itself
		let key = /^\d+ authors?$/.test(text)
			? ""
			: text === "Collaborators"
				? "Authors"
				: "Author";
		let name = Object.assign(document.createElement("span"), {
			className: "name",
			textContent: text,
		});
		values.push(
			value("author-button", key, authorButton.querySelector(".faces").cloneNode(true), name),
		);
	}
	if (exclude) {
		values.push(value("display-button", "Exclude", code(exclude)));
	}
	if (values.length === 0) {
		values.push(
			Object.assign(document.createElement("span"), {
				className: "none",
				textContent: "Filter",
			}),
		);
	}
	// Spaces between, so a screen reader reads “label:foo Author bar”, not “label:fooAuthor bar”
	applied.replaceChildren(...values.flatMap((span, i) => (i > 0 ? [" ", span] : [span])));

	folded ??=
		!filter && !author && !exclude && !new URLSearchParams(location.search).get("authors");
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

/** One applied value with its key, e.g. “Filter label:foo”, which unfolds to the control with this id. */
function value (id, key, ...content) {
	let span = document.createElement("span");
	span.dataset.for = id;
	if (key) {
		span.append(
			Object.assign(document.createElement("span"), { className: "key", textContent: key }),
			" ",
		);
	}
	span.append(...content);
	return span;
}

function code (text) {
	return Object.assign(document.createElement("code"), { textContent: text });
}
