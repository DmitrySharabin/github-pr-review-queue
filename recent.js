import { highlight } from "./highlight.js";

/**
 * Offer the values a text field had before, as a combo box. A click or ↓ opens them, typing narrows them, and Enter or a click picks one.
 * The field’s `aria-controls` names a listbox inside a popover, and the button after the listbox clears them all.
 * The listbox needs `tabindex="-1"`, or a list long enough to scroll becomes a Tab stop between the field and that button.
 * @param {HTMLInputElement} input - A field with `role="combobox"`
 * @param {{ values: () => string[], remove: (value: string) => void }} recent - The values, the latest first, and how to forget one
 */
export function offerRecent (input, { values, remove }) {
	let list = document.getElementById(input.getAttribute("aria-controls"));
	let popup = list.parentElement;
	let field = input.parentElement;
	/** @type {string[]} */
	let all = [];
	/** @type {HTMLLIElement[]} The options that match what is typed */
	let options = [];
	let active = -1;
	/** What was typed since the list opened, lowercase. A filled field opens with every value, e.g. after an error */
	let typed = "";

	/** Read the values again. Not on every key, since reading them may be slow */
	function update () {
		all = values();
		// The chevron shows there is something to pick
		field.classList.toggle("offers", all.length > 0);
	}

	/** Fill the list with the values that contain what is typed, e.g. `foo/bar` for `bar`. */
	function render () {
		options = all
			.filter(value => value.toLowerCase().includes(typed))
			.map(value => {
				let text = document.createElement("span");
				text.append(...highlight(value, typed));

				// A screen reader user removes the active option with Shift+Delete instead
				let button = document.createElement("button");
				button.type = "button";
				button.tabIndex = -1;
				button.ariaHidden = "true";
				button.className = "cancel";
				button.title = "Remove from recent";
				button.addEventListener("click", () => {
					remove(value);
					update();
					show();
				});

				let option = document.createElement("li");
				option.role = "option";
				option.ariaKeyShortcuts = "Shift+Delete";
				option.dataset.value = value;
				option.append(text, button);
				option.addEventListener("click", event => {
					if (event.target !== button) {
						pick(option);
					}
				});
				return option;
			});

		list.replaceChildren(...options);
		select(-1);
	}

	/** Show every value, read again, e.g. on a click. */
	function open () {
		typed = "";
		update();
		show();
	}

	/** Show the values that match what is typed, or close when none does. */
	function show () {
		render();
		if (options.length === 0) {
			close();
			return;
		}

		// The field is the popover’s anchor, so the list sits under it, or above it when there is no room below
		popup.showPopover({ source: input });
		input.ariaExpanded = "true";
	}

	function close () {
		popup.hidePopover();
		input.ariaExpanded = "false";
		select(-1);
	}

	/** Make the option at `index` the active one, e.g. after ↓. -1 is none. */
	function select (index) {
		active = index;
		for (let [i, option] of options.entries()) {
			option.ariaSelected = String(i === active);
		}

		let option = options[active];
		option?.scrollIntoView({ block: "nearest" });
		input.ariaActiveDescendantElement = option ?? null;
	}

	function pick (option) {
		input.value = option.dataset.value;
		close();
	}

	input.addEventListener("click", () => {
		if (!popup.matches(":popover-open")) {
			open();
		}
	});

	input.addEventListener("input", () => {
		typed = input.value.trim().toLowerCase();
		show();
	});

	// Enter without an active option submits, and the form may stay, e.g. after an error
	input.form.addEventListener("submit", close);

	input.addEventListener("keydown", event => {
		let expanded = popup.matches(":popover-open");
		let step = { ArrowDown: 1, ArrowUp: -1 }[event.key];

		if (step) {
			event.preventDefault();
			if (!expanded) {
				open();
			}
			// From none, ↓ goes to the first and ↑ to the last, and both wrap around
			let count = options.length;
			select(
				count &&
					(active === -1 && step === -1 ? count - 1 : (active + step + count) % count),
			);
		}
		else if (expanded && event.key === "Escape") {
			event.preventDefault();
			close();
		}
		// Without an active option, Enter submits the form and Delete deletes text.
		// Removing takes Shift+Delete, as in the browsers’ own suggestions, so a slip doesn’t forget a value
		else if (expanded && options[active] && event.key === "Enter") {
			event.preventDefault();
			pick(options[active]);
		}
		else if (expanded && options[active] && event.key === "Delete" && event.shiftKey) {
			event.preventDefault();
			let index = active;
			remove(options[active].dataset.value);
			update();
			show();
			select(Math.min(index, options.length - 1));
		}
	});

	let clear = popup.querySelector(":scope > button");
	// Tab goes from the field to this button, the list’s one stop, and Escape on it goes back
	clear.addEventListener("keydown", event => {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			input.focus();
		}
	});

	clear.addEventListener("click", () => {
		for (let value of all) {
			remove(value);
		}
		update();
		close();
		input.focus();
	});

	// The list keeps focus in the field, so a click on it doesn’t close it
	popup.addEventListener("pointerdown", event => event.preventDefault());

	// Focus elsewhere, e.g. a click or a Tab past the clear button
	field.addEventListener("focusout", event => {
		if (!field.contains(event.relatedTarget)) {
			close();
		}
	});

	// Reading the values may be slow, so it waits until the field shows, e.g. after each error that shows the form
	new IntersectionObserver(([entry]) => {
		if (entry.isIntersecting) {
			update();
		}
	}).observe(input);
}
