import { plural } from "./plural.js";

let form = document.querySelector("#drafts");
let button = form.querySelector("button");
let badge = button.querySelector(".badge");
let said = form.querySelector(".spoken");
/** Whether the toggle was pressed since the last render, which then says what the press did */
let pressed = false;

form.addEventListener("submit", () => {
	pressed = true;
});

/**
 * Say on the toggle whether drafts hide, and how many, e.g. “Hide drafts 2”. A press submits the other state.
 * @param {boolean} hides - Whether the view hides its drafts
 * @param {number} [count] - How many drafts hide, unknown while bars stand in for the rows
 */
export function showDrafts (hides, count) {
	button.ariaPressed = `${hides}`;
	button.value = hides ? "show" : "hide";
	// Under bars, a press would wait for their load, which shows the pick only once it ends, as the Author button does
	button.disabled = count === undefined;
	badge.textContent = count;
	badge.hidden = !count;
	// The pill is hidden from a screen reader, which hears the count in the name instead
	button.ariaLabel = count > 0 ? `Hide drafts, ${count} hidden` : null;

	let text = !hides
		? "Drafts shown"
		: count > 0
			? `${count} ${plural("draft", count)} hidden`
			: "Drafts hidden";
	said.textContent = pressed ? text : "";
	pressed = false;
}
