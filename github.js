// The commit is also in index.html, which preloads the modules this one imports
import GithubAPI from "https://cdn.jsdelivr.net/gh/madatajs/madata@063fc247b1a03924c836d74ea2f3d8fdc86ded2c/backends/github/api/github-api.js";
import { isLogin } from "./pull-request.js";

export let github = new GithubAPI("https://api.github.com/graphql");

/** GitHub’s answer for a repo or user it can’t find, e.g. “Could not resolve to a Repository with the name 'foo/bar'.” */
export const notFound = /Could not resolve to a (Repository|User)/;

/**
 * Who is signed in, e.g. `DmitrySharabin`.
 * @returns {string}
 * @throws Madata’s connection error when Madata signed in without a user. It does that when GitHub fails to answer anything but a 401, e.g. offline
 */
export function signedInUser () {
	let user = github.user?.username;
	if (!user) {
		throw new Error(GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name));
	}

	return user;
}

/**
 * Whether a user is the signed-in one, so the page says “you” to them.
 * A missing user is the signed-in one, who may be unknown yet, e.g. during the sign-in
 * @param {string | null} user
 */
export function isYou (user) {
	return !user || isLogin(user, github.user?.username ?? "");
}

/**
 * Sign in with the stored token, if any.
 * Madata’s login() takes no signal, and the user it asks GitHub for can hang, e.g. after the laptop slept, so this stops waiting in time.
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<boolean>} Whether a token is stored that GitHub didn’t reject
 */
export function signedIn (signal) {
	signal = inTime(signal);
	return Promise.race([
		// A stored token that GitHub rejects, e.g. expired, doesn’t fail Madata’s login(). Madata deletes it instead
		github.login({ passive: true }).then(
			() => github.isAuthenticated(),
			() => false,
		),
		new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
	]);
}

/**
 * A request through Madata, which wraps a failed fetch in its connection error, but not an answer that fails as it arrives.
 * The browser throws a TypeError when the connection drops then, e.g. as the laptop sleeps, so this wraps it the same way.
 * @param {Parameters<typeof github.request>} args
 */
async function request (...args) {
	try {
		return await github.request(...args);
	}
	catch (error) {
		if (error instanceof TypeError) {
			let phrase = GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name);
			throw new Error(phrase, { cause: error });
		}

		throw error;
	}
}

/**
 * GitHub’s answer to a GraphQL query, through Madata’s request() rather than its load().
 * For a PR deleted since the search, GitHub answers null and an error, and Madata’s load() throws the whole answer away for it, the other PRs included.
 * @param {string} text
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<object>} The answer’s `data`
 */
export async function graphql (text, signal) {
	let { data, errors = [] } = await request(
		"https://api.github.com/graphql",
		{ query: text },
		"POST",
		{ signal: inTime(signal) },
	);
	errors = errors.filter(error => error.type !== "NOT_FOUND" || error.path?.[0] !== "nodes");

	// Joined as Madata’s load() joins them, which describe() matches, e.g. “Could not resolve to a Repository”
	if (errors.length > 0) {
		throw new Error(errors.map(error => error.message).join("\n"));
	}

	return data;
}

/**
 * GitHub’s answer to a REST request, e.g. to `repos/foo/bar/compare/a...b`.
 * @param {string} path
 * @param {AbortSignal} signal - The load’s
 */
export function rest (path, signal) {
	return request(`https://api.github.com/${path}`, {}, "GET", { signal: inTime(signal) });
}

/**
 * The nodes that a `nodes(ids:)` query finds, e.g. of `details()`. GitHub stops a query that runs too long,
 * so one it stopped asks again in two halves, each faster. Only once, so a slow GitHub doesn’t get many more requests
 * @param {(ids: string[]) => string} query
 * @param {string[]} ids
 * @param {AbortSignal} signal - The load’s
 */
export async function nodes (query, ids, signal) {
	try {
		return (await graphql(query(ids), signal)).nodes;
	}
	catch (error) {
		if (!stopped(error)) {
			throw error;
		}

		let half = Math.ceil(ids.length / 2);
		// One PR asks again as it is
		let halves = [ids.slice(0, half), ids.slice(half)].filter(part => part.length > 0);
		let answers = await Promise.all(halves.map(ids => graphql(query(ids), signal)));
		return answers.flatMap(answer => answer.nodes);
	}
}

/**
 * Whether GitHub stopped a query that ran too long, which a smaller one may not.
 * Not a refusal, e.g. a 403, nor a request inTime() stopped, e.g. on a dropped connection, which would fail again
 * @param {unknown} error - What Madata or graphql() threw
 */
function stopped (error) {
	// Madata throws a 502’s HTML page as text, or its JSON with the status or GitHub’s words. A query’s error comes as JSON too
	return (
		typeof error === "string" ||
		error?.status === "502" ||
		/result of a timeout/.test(error?.message ?? error?.errors?.[0]?.message)
	);
}

/**
 * The signal for a request. It aborts with the load’s, or after 20 s, which describe() reads as “took too long”. That is twice the time GitHub gives a query.
 * A dropped connection, e.g. after the laptop slept, never answers otherwise.
 * @param {AbortSignal} signal - The load’s
 */
function inTime (signal) {
	return AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
}

/**
 * Say in the user’s words what went wrong and what to do, e.g. “You’re offline. Check your connection, then try again.”
 * @param {unknown} error - What Madata threw
 * @param {string} [advice] - What to do about an error not known here, which shows GitHub’s own words
 */
export function describe (error, advice = "Try again.") {
	// On an HTTP error, Madata throws GitHub’s response body. It is JSON, e.g. { message: "Bad credentials" }, or text, e.g. a 502’s HTML page.
	// Its own errors and GitHub’s GraphQL errors, e.g. a repo that doesn’t exist, are told apart by their messages
	let message = error?.message;
	let slow = "GitHub took too long to respond. Try again in a minute.";

	// A defect in the page’s own code isn’t GitHub’s answer, e.g. a method that an older browser lacks. The console keeps its stack
	if ([TypeError, ReferenceError, RangeError].some(type => error instanceof type)) {
		console.error(error);
		return "Something went wrong on this page. Reload the page, or update your browser.";
	}

	// Madata drops the failed fetch’s error, so only its own message tells a network failure apart, e.g. a request inTime() stopped before GitHub answered
	if (message === GithubAPI.phrase("something_went_wrong_while_connecting", GithubAPI.name)) {
		return navigator.onLine ? slow : "You’re offline. Check your connection, then try again.";
	}

	// A text body, e.g. a 502’s HTML page. Or an answer inTime() stopped as it arrived, whose reading error Madata doesn’t wrap.
	// Chrome names that error TimeoutError, Firefox and Safari AbortError. A load’s own abort never gets here
	if (message === undefined || ["TimeoutError", "AbortError"].includes(error.name)) {
		return slow;
	}

	// Madata joins GraphQL errors with line breaks, and the fields of one query may each fail with the same one
	message = [...new Set(message.split("\n"))].join("\n");

	let [, missing] = message.match(notFound) ?? [];

	// GitHub answers the same for a private repo the user can’t access, e.g. with a token for other repos
	if (missing === "Repository") {
		return "GitHub can’t find this repository, or your account or token can’t access it. Check the name, then try again.";
	}

	if (missing === "User") {
		return "GitHub can’t find this user. Check the name, or leave User empty to see your own queue.";
	}

	// The primary limit, e.g. “API rate limit exceeded for user ID 1”, and the secondary one, for too many requests at once
	if (/rate limit/i.test(message)) {
		return "GitHub is getting too many requests from this page. Wait a few minutes, then try again.";
	}

	if (message === "Bad credentials") {
		return "Your GitHub session has expired. Sign out, then sign in again.";
	}

	if (message === GithubAPI.phrase("invalid_access_token")) {
		return "GitHub didn’t accept this token. Check that you copied all of it and that it hasn’t expired.";
	}

	if (message === GithubAPI.phrase("popup_blocked")) {
		return "Your browser blocked the GitHub sign-in window. Allow pop-ups for this page, then try again.";
	}

	return `GitHub answered: “${message}”. ${advice}`;
}
