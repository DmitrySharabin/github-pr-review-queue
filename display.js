import { pattern } from "./pull-request.js";
import { applyOnClose, passFocus } from "./menu.js";

let form = document.querySelector("#display");
let button = document.querySelector("#display-button");
let field = form.elements.exclude;
let clear = form.querySelector(".clear");

// A pattern that isn’t a regular expression, e.g. `test(`, stops Apply with the browser’s message
field.addEventListener("input", check);

// An empty pattern waits for Apply, as the author list’s Clear does
clear.addEventListener("click", () => {
	field.value = "";
	passFocus(clear, field);
	check();
});

applyOnClose(form, {
	changed: () => field.value !== field.defaultValue,
	discard () {
		form.reset();
		check();
	},
});

/**
 * Say on the Display button whether a setting in its menu differs from its default, which the closed menu doesn’t show.
 * @param {string | null} [exclude] - The view’s, which the menu’s field shows by now
 */
export function showDisplay (exclude) {
	button.querySelector(".badge").hidden = !exclude;
	button.ariaLabel = exclude ? "Display, 1 setting changed" : null;
	button.classList.toggle("set", Boolean(exclude));
	// A reset fires no input event, e.g. after Clear, so the last message would stay
	check();
}

/** Mark the pattern field invalid while it holds no regular expression, and offer Clear while it holds anything. */
function check () {
	field.setCustomValidity(
		field.value && !pattern(field.value) ? "Enter a valid regular expression." : "",
	);
	clear.hidden = !field.value;
}
