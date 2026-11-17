import { plural } from "./plural.js";

let form = document.querySelector("#drafts");
let button = form.querySelector("button");
let label = button.querySelector(".text");
let badge = button.querySelector(".badge");
let said = form.querySelector(".spoken");
/** Whether the toggle was pressed since the last render, which then says what the press did */
let pressed = false;

form.addEventListener("submit", event => {
	if (button.ariaDisabled) {
		event.preventDefault();
		return;
	}

	pressed = true;
});

/**
 * Say on the toggle whether drafts hide, and how many, e.g. “Hide drafts 2”. A press submits the other state.
 * With no draft to hide or show, it says “No drafts” and a press would change nothing, so it is disabled.
 * @param {boolean} hides - Whether the view hides its drafts
 * @param {number} [count] - How many drafts the picked authors have, hidden or shown, unknown while bars stand in for the rows
 */
export function showDrafts (hides, count) {
	let none = count === 0;
	label.textContent = none ? "No drafts" : "Hide drafts";
	// A button that does nothing is neither pressed nor not pressed
	button.ariaPressed = none ? null : `${hides}`;
	button.value = hides ? "show" : "hide";
	// Under bars, a press would wait for their load, which shows the pick only once it ends, as the Author button does
	button.disabled = count === undefined;
	// aria-disabled, unlike disabled, keeps the focus on a toggle that loses its last draft, e.g. on a step back
	button.ariaDisabled = none ? "true" : null;
	let hidden = hides ? count : 0;
	badge.textContent = hidden || "";
	badge.hidden = !hidden;
	// The pill is hidden from a screen reader, which hears the count in the name instead
	button.ariaLabel = hidden > 0 ? `Hide drafts, ${hidden} hidden` : null;

	let text = !hides
		? "Drafts shown"
		: count > 0
			? `${count} ${plural("draft", count)} hidden`
			: "Drafts hidden";
	said.textContent = pressed ? text : "";
	pressed = false;
}
