/**
 * @import { Role } from "./pull-request.js"
 *
 * @typedef {object} View - The URL parameters that decide which PRs a load finds and how it counts them, e.g. not `authors`, which only hides rows
 * @property {string} repo
 * @property {string} user
 * @property {Role | null} [role]
 * @property {string | null} [filter] - Narrows the search further, e.g. `label:foo -label:bar`
 * @property {string | null} [exclude] - A regular expression for the paths of files whose lines count apart, e.g. `test|\.lock$`
 */
import { normalize } from "./pull-request.js";

/** The URL parameters of a view, see {@link viewOf} */
export const viewNames = ["repo", "user", "role", "filter", "exclude"];

/**
 * The view of these URL parameters. A missing one means its default, e.g. no `user` is the signed-in user.
 * @param {URLSearchParams} [params]
 * @returns {View}
 */
export function viewOf (params = new URLSearchParams(location.search)) {
	return Object.fromEntries(viewNames.map(name => [name, params.get(name)]));
}

/**
 * One string per view, e.g. `repo=foo%2Fbar&role=author`. Equal views have equal keys.
 * @param {View} view
 */
export function viewKey (view) {
	return `${new URLSearchParams(Object.entries(view).filter(([, value]) => value))}`;
}

/**
 * The view of a key from {@link viewKey}.
 * @param {string} key
 */
export function parseKey (key) {
	return viewOf(new URLSearchParams(key));
}

/**
 * Rewrite URL parameters as GitHub’s pulls page rewrites its query, see {@link normalize}, e.g. `?role=author&user=foo` for `?role=author&filter=author:foo`.
 * @param {URLSearchParams | FormData} params
 */
export function normalizeParams (params) {
	let { user, filter, authors } = normalize(
		Object.fromEntries(
			["user", "role", "filter", "authors"].map(name => [name, params.get(name)]),
		),
	);
	for (let [name, value] of Object.entries({ user, filter, authors })) {
		if (value) {
			params.set(name, value);
		}
		else {
			params.delete(name);
		}
	}
}
