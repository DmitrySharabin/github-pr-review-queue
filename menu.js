/** Whether Esc closed the menu, which drops the changes made in it */
let cancelled = false;

// On the document, since Safari doesn’t focus a checkbox on a click, so Esc after one goes to the page.
// Esc in a filled search field only clears it, so the next key or click decides how the menu closes
for (let type of ["keydown", "pointerdown"]) {
	document.addEventListener(type, event => {
		cancelled = event.key === "Escape";
	});
}

/**
 * Move the focus from a button that is about to hide to a field, e.g. from Clear to the field it emptied, or the focus would drop to the page.
 * Only after a press from the keyboard, since a focused field opens the on-screen keyboard after a tap.
 * @param {HTMLButtonElement} button
 * @param {HTMLInputElement} field
 */
export function passFocus (button, field) {
	if (button.matches(":focus-visible")) {
		field.focus();
	}
}

/** @type {Map<HTMLFormElement, () => void>} How to close each menu without applying it */
let dismissals = new Map();

/** Close the open menus without applying them, e.g. when the queue they change goes, as after a failed load. */
export function dismissMenus () {
	for (let [form, dismiss] of dismissals) {
		if (form.matches(":popover-open")) {
			dismiss();
		}
	}
}

/**
 * Make a popover form a menu that applies its changes once it closes, as GitHub’s filter menus do. Esc drops them instead.
 * The form submits its fields as URL parameters, so the same values submitted again would load the same rows.
 * @param {HTMLFormElement} form
 * @param {{ changed: () => boolean, open?: () => void, discard: () => void }} menu -
 *   Whether its fields differ from the URL’s, what to do as it opens, and how to show the URL’s values again
 */
export function applyOnClose (form, { changed, open, discard }) {
	/** Whether the menu closes because it was submitted, which needs no second submit, or dismissed */
	let submitted = false;

	dismissals.set(form, () => {
		submitted = true;
		form.hidePopover();
		discard();
	});

	// Focus moved out from the keyboard, e.g. by Tab past the last button, closes the menu as a click outside does, which applies it.
	// A click needs no check. Outside the menu, light dismiss closes it. On the menu’s own button, the click toggles it
	document.addEventListener("focusin", event => {
		if (
			form.matches(":popover-open") &&
			!form.contains(event.target) &&
			event.target.matches(":focus-visible")
		) {
			form.hidePopover();
		}
	});

	form.addEventListener("submit", event => {
		if (!changed()) {
			event.preventDefault();
		}
		submitted = true;
		if (form.matches(":popover-open")) {
			form.hidePopover();
		}
	});

	form.addEventListener("toggle", event => {
		if (event.newState === "open") {
			cancelled = false;
			submitted = false;
			open?.();
			// A focused field opens the on-screen keyboard over the menu on a phone
			if (matchMedia("(pointer: fine)").matches) {
				form.querySelector("input").focus();
			}
			return;
		}

		// A value the field rejects, e.g. a pattern that isn’t a regular expression, is dropped rather than applied
		if (!cancelled && !submitted && changed() && form.checkValidity()) {
			form.requestSubmit();
		}
		else if (!submitted) {
			discard();
		}
	});
}
