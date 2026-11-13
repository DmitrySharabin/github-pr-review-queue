import { pattern } from "./pull-request.js";
import { describe, github } from "./github.js";
import { forget, storedQueues } from "./queues.js";
import { unmark } from "./row.js";
import { offerRecent } from "./recent.js";
import { applyOnClose } from "./menu.js";
import { href, normalizeParams, paramNames, viewKey, viewOf } from "./view.js";
import { showNotice } from "./status.js";
import { onScreen, pickAuthors, showQueue } from "./screen.js";
import { load, loading } from "./load.js";

let table = document.querySelector("#queue");
let status = document.querySelector("#status");
let progress = document.querySelector("progress");
let signIn = document.querySelector("#sign-in");
let refresh = document.querySelector("#refresh");
let signOut = document.querySelector("#sign-out");
let controls = document.querySelector("#controls");
let tokenForm = document.querySelector("#token-form");
let repoForm = document.querySelector("#repo-form");
let strip = document.querySelector("#summary");
let filterForm = document.querySelector("#narrow");
let authorForm = document.querySelector("#authors");
let displayButton = document.querySelector("#display-button");
let displayForm = document.querySelector("#display");
let forms = [repoForm, filterForm, authorForm, displayForm, ...strip.querySelectorAll("form")];

// Opening a link in a marked row, e.g. its PR, is seeing what changed in it. A middle click opens a link too. A right click opens a menu instead
for (let type of ["click", "auxclick"]) {
	table.tBodies[0].addEventListener(type, event => {
		let tr = event.target.closest("a")?.closest("tr");
		if (tr && event.button < 2) {
			unmark(tr);
		}
	});
}

signIn
	.querySelector(":scope > button")
	.addEventListener("click", () =>
		github.login().catch(error => showNotice(signIn, "Couldn’t sign in", describe(error))));

tokenForm.addEventListener("submit", event => {
	event.preventDefault();
	// Madata stores and validates the token as it does after the popup, then fires mv-login, which login() waits for
	github
		.login({ accessToken: tokenForm.elements.token.value })
		.catch(error => showNotice(signIn, "Couldn’t sign in", describe(error)));
});

// A token that works but can’t read the repo keeps the sign-in hidden, so signing out is the way to replace it
signOut.addEventListener("click", async () => {
	await github.logout();
	// A load that ends before the reload would store its queue again
	loading?.abort();
	forget();
	location.reload();
});

// The forms submit their fields as URL parameters, so the URL they open can be copied and reused.
// A form has fields only for what it changes, and keeps the rest of the URL, e.g. the filter form its `repo`.
// Capturing, this runs before a form’s own listener, e.g. the author list’s, which then replaces the URL’s `authors`
for (let form of forms) {
	form.addEventListener(
		"formdata",
		({ formData }) => {
			let params = new URLSearchParams(location.search);
			for (let name of paramNames) {
				if (!formData.has(name) && params.has(name)) {
					formData.set(name, params.get(name));
				}
			}

			normalizeParams(formData);
			// An empty field means its default, e.g. the signed-in user: ?repo=foo/bar, not ?repo=foo/bar&user=
			for (let [name, value] of [...formData]) {
				if (!value) {
					formData.delete(name);
				}
			}
		},
		{ capture: true },
	);
}

// The repos and users of the stored queues, e.g. those opened yesterday. Forgetting one forgets its queues
// NOTE: The same repo in another case, e.g. `Foo/Bar`, shows twice.
// Clearing the repos forgets every queue, but the user field shows its chevron until it is opened
for (let name of ["repo", "user"]) {
	offerRecent(repoForm.elements[name], {
		values: () => [
			...new Set(
				storedQueues()
					.map(({ view }) => view[name])
					.filter(Boolean),
			),
		],
		remove: value => forget(view => view[name] === value),
	});
}

// A pattern that isn’t a regular expression, e.g. `test(`, stops Apply with the browser’s message
displayForm.elements.exclude.addEventListener("input", checkPattern);

// An empty filter field submits no `filter`. An empty pattern waits for Apply, as the author list’s Clear does
for (let [clear, field, then] of [
	[
		filterForm.querySelector(".cancel"),
		filterForm.elements.filter,
		() => filterForm.requestSubmit(),
	],
	[displayForm.querySelector(".clear"), displayForm.elements.exclude, checkPattern],
]) {
	clear.addEventListener("click", () => {
		field.value = "";
		// Pressed from the keyboard, it hides itself and would drop the focus to the page, so the emptied field takes it.
		// Not after a tap, since a focused field opens the on-screen keyboard
		if (clear.matches(":focus-visible")) {
			field.focus();
		}
		then();
	});
}

applyOnClose(displayForm, {
	changed: () => displayForm.elements.exclude.value !== displayForm.elements.exclude.defaultValue,
	discard () {
		displayForm.reset();
		checkPattern();
	},
});

refresh.addEventListener("click", () => {
	if (!loading) {
		load();
	}
});

// A typed or shared URL can repeat the view’s qualifiers in its filter, e.g. `?role=author&filter=author:foo`.
// The rewrite runs before the navigate listener, which would load the URL a second time
let current = new URLSearchParams(location.search);
let normalized = new URLSearchParams(current);
normalizeParams(normalized);
// A repo or user that its field would reject, e.g. `foo/bar/issues`, names none, so it reaches neither GitHub’s URLs nor the page
for (let field of [repoForm.elements.repo, repoForm.elements.user]) {
	field.value = normalized.get(field.name) ?? "";
	if (field.validity.patternMismatch) {
		normalized.delete(field.name);
	}
}
if (`${normalized}` !== `${current}`) {
	history.replaceState(null, "", `?${normalized}${location.hash}`);
}

// A filter, a role switch or another repo loads in place, so what it doesn’t change stays put, e.g. the focus in the filter field.
// Without the Navigation API, or to or from the page that asks for a repo, the page reloads:
// going back to that page shows it, not just its URL, and leaving it brings back the controls it hides
window.navigation?.addEventListener("navigate", event => {
	let next = new URL(event.destination.url).searchParams;
	let current = new URLSearchParams(location.search);
	if (
		!event.canIntercept ||
		event.hashChange ||
		event.navigationType === "reload" ||
		!current.get("repo") ||
		!next.get("repo")
	) {
		return;
	}

	// The same view submitted again, e.g. Enter with the same terms, loads it again
	let onlyAuthors =
		viewKey(viewOf(next)) === viewKey(viewOf(current)) &&
		next.get("authors") !== current.get("authors");
	// The handler runs once the URL has changed. Focus and scroll stay where they were, e.g. in the filter field
	event.intercept({
		focusReset: "manual",
		scroll: "manual",
		handler: () => showView({ onlyAuthors }),
	});
});

showView();

/**
 * Show what the URL asks for, e.g. `?repo=foo/bar&filter=label:baz`.
 * @param {{ onlyAuthors?: boolean }} [options] - Whether the URL changed only its `authors`, e.g. after a pick in the list
 */
function showView ({ onlyAuthors } = {}) {
	let params = new URLSearchParams(location.search);
	let view = viewOf(params);
	let { role, filter, exclude } = view;
	pickAuthors(role === "author" ? [] : (params.get("authors")?.split(",").filter(Boolean) ?? []));

	// As defaults, so a reset, e.g. Esc in a summary form, goes back to what the URL says
	for (let form of forms) {
		for (let field of form.elements) {
			if (field.name) {
				field.defaultValue = params.get(field.name) ?? "";
			}
		}
		// An open menu keeps what is changed in it, e.g. on a step back, as it does while a refresh ends
		if (!form.matches(":popover-open")) {
			form.reset();
		}
	}
	// A reset fires no input event, e.g. after Clear, so the last message would stay
	checkPattern();

	// Each role opens the same queue, filter and all, from the other side
	// The other role’s qualifier in the filter, e.g. `author:foo`, names its user
	for (let link of strip.querySelectorAll(".roles a")) {
		link.href = href({ role: link.dataset.role });
		link.ariaCurrent = (link.dataset.role === "author") === (role === "author") ? "page" : null;
	}

	filterForm.querySelector(".cancel").hidden = !filter;
	// Closed, the menu says that a setting in it differs from its default
	displayButton.querySelector(".badge").hidden = !exclude;
	displayButton.ariaLabel = exclude ? "Display, 1 setting changed" : null;
	displayButton.classList.toggle("set", Boolean(exclude));

	if (view.repo) {
		// Other authors of the view on screen need no load. Their rows are on screen already
		if (onlyAuthors && onScreen(view)) {
			return showQueue();
		}
		// The load of this view in flight shows the picked authors once its search ends
		if (onlyAuthors && loading) {
			return;
		}
		return load();
	}

	// The page’s first script hides the controls before the first paint, but it still sees a repo that the URL drops, e.g. `foo/bar/issues`
	controls.hidden = true;
	// The form’s heading says what to do
	status.hidden = true;
	progress.hidden = true;
	repoForm.hidden = false;
}

/** Mark the pattern field invalid while it holds no regular expression, and offer Clear while it holds anything. */
function checkPattern () {
	let field = displayForm.elements.exclude;
	field.setCustomValidity(
		field.value && !pattern(field.value) ? "Enter a valid regular expression." : "",
	);
	displayForm.querySelector(".clear").hidden = !field.value;
}
