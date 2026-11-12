/**
 * The text with the typed part in a `<mark>`, in any case, e.g. `foo/<mark>ba</mark>r` for `BA`. The text alone when it doesn’t have it.
 * @param {string} text
 * @param {string} typed
 * @returns {(string | HTMLElement)[]} To append, e.g. with `replaceChildren()`
 */
export function highlight (text, typed) {
	let at = text.toLowerCase().indexOf(typed.toLowerCase());
	if (!typed || at < 0) {
		return [text];
	}

	let mark = document.createElement("mark");
	mark.textContent = text.slice(at, at + typed.length);
	return [text.slice(0, at), mark, text.slice(at + typed.length)];
}
