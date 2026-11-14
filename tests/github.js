import { test as base, expect } from "@playwright/test";

export { expect };

/**
 * Playwright’s `test` with GitHub faked for the test’s page, as DmitrySharabin, whose queue in any repo holds PRs A–F (#65–#70).
 * A test changes how GitHub answers through the `github` fixture’s hooks. Each gets the answer to change, e.g. to add GraphQL errors,
 * and may return an HTTP status to fail with, e.g. `github.search = () => 500`, or a promise to hold the answer until it settles.
 * `details` also gets the queries for commit sizes, whose nodes are then commits, e.g. N with +780.
 * `user` gets GitHub’s answer to whose token it is, e.g. `github.user = () => 401` for a token GitHub rejects.
 * `compare` gets the comparison of two commits, with no changed files until it adds some, and its range, e.g. `L...N`.
 * `files` gets a page of a PR’s files, with none until it adds some, and the PR’s number and the page’s, e.g. `65, 1`.
 */
export const test = base.extend({
	// The token Madata finds stored, or none for the sign-in card: `test.use({ token: null })`
	token: ["fake", { option: true }],

	// Automatic, so GitHub is faked for a test that changes no answer too
	github: [
		async ({ context, token }, use) => {
			let github = {
				user () {},
				search () {},
				details () {},
				compare () {},
				files () {},
			};

			// Madata signs in with a stored token without asking GitHub for one
			if (token) {
				await context.addInitScript(
					token => localStorage.setItem("madata:token:auth.madata.dev/github", token),
					token,
				);
			}

			// Nothing waits on the network. An avatar that GitHub is slow to send holds up the page’s load event, and with it `page.goto()`.
			// Every avatar is a black square
			await context.route("https://auth.madata.dev/services.json", route =>
				route.fulfill({ json: { Github: { client_id: "fake" } } }));
			await context.route("https://github.com/*.png*", route =>
				route.fulfill({
					contentType: "image/svg+xml",
					body: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48"/></svg>`,
				}));

			await context.route("https://api.github.com/**", async route => {
				let path = new URL(route.request().url()).pathname;
				if (path === "/user") {
					let answer = { login: "DmitrySharabin" };
					let status = await github.user(answer);
					return route.fulfill(failed(status) ?? { json: answer });
				}

				if (path.includes("/compare/")) {
					let answer = { files: [] };
					let status = await github.compare(answer, path.split("/compare/")[1]);
					return route.fulfill(failed(status) ?? { json: answer });
				}

				let [, number] = path.match(/\/pulls\/(\d+)\/files$/) ?? [];
				if (number) {
					let answer = [];
					let page = new URL(route.request().url()).searchParams.get("page");
					let status = await github.files(answer, Number(number), Number(page));
					return route.fulfill(failed(status) ?? { json: answer });
				}

				let { query } = route.request().postDataJSON();
				let isSearch = query.includes("search(");
				let answer = isSearch
					? {
							data: {
								// As GitHub, only when the query asks for it
								repository: query.includes("viewerPermission")
									? { viewerPermission: "WRITE" }
									: {},
								search: { nodes: [..."ABCDEF"].map(found) },
							},
						}
					: {
							data: {
								nodes: JSON.parse(query.match(/nodes\(ids: (\[.*?\])\)/)[1]).map(
									detailed,
								),
							},
						};

				let status = await (isSearch ? github.search : github.details)(answer);
				// GitHub answers a field under the query’s alias for it, e.g. `filename: path`.
				// In new objects, so a test’s files keep their paths for the next request
				let alias = query.match(/(\w+): path\b/)?.[1] ?? "path";
				for (let pr of answer.data?.nodes ?? []) {
					if (pr?.files) {
						pr.files = {
							...pr.files,
							nodes: pr.files.nodes.map(({ path, ...file }) => ({
								...file,
								[alias]: path,
							})),
						};
					}
				}
				route.fulfill(failed(status) ?? { json: answer });
			});

			await use(github);
		},
		{ auto: true },
	],
});

/** A commit of a PR’s details, e.g. a merge with 2 parents. */
export function commit (id, parents = 1) {
	return { commit: { id, oid: id, parents: { totalCount: parents } } };
}

/** Give PRs their details from `fields`, e.g. `{ A: { additions: 1 } }`. */
export function detail (github, fields) {
	github.details = answer => {
		for (let pr of answer.data.nodes) {
			Object.assign(pr, fields[pr.id]);
		}
	};
}

/**
 * Give PRs labels on top of what the search answers already, e.g. `{ A: ["bug"] }`.
 * A label is red and has no description, unless it says otherwise, e.g. `{ name: "docs", color: "0075ca" }`.
 */
export function label (github, labels) {
	let search = github.search;
	github.search = answer => {
		let status = search(answer);
		for (let pr of answer.data.search.nodes) {
			pr.labels.nodes = (labels[pr.id] ?? []).map(label => ({
				color: "d73a4a",
				description: null,
				...(typeof label === "string" ? { name: label } : label),
			}));
		}
		return status;
	};
}

/** Open a view, the reviewer queue of foo/bar unless `url` asks for another, and wait until its load ends. */
export async function open (page, url = "/?repo=foo/bar") {
	await page.goto(url);
	await loaded(page);
}

/** Wait until the load in flight ends, e.g. after a refresh. */
export async function loaded (page) {
	await expect(page.locator("progress")).toBeHidden();
}

/** Click Refresh. */
export async function refresh (page) {
	await page.getByRole("button", { name: "Refresh" }).click();
}

/** Unfold the filter row, which opens folded on the first visit. */
export async function unfold (page) {
	await page.getByRole("button", { name: "Show filters" }).click();
}

/** The filter field, which shows once the filter row is unfolded. */
export function filter (page) {
	return page.getByRole("searchbox", { name: "Filter", exact: true });
}

/** Apply `terms` as the filter, as the user types them, e.g. `label:bug`. */
export async function filterBy (page, terms) {
	await filter(page).fill(terms);
	await filter(page).press("Enter");
}

/** Show the queue of another user, as the user types the login in the strip. */
export async function changeUser (page, login) {
	await page.getByRole("button", { name: "Change user" }).click();
	await page.getByRole("textbox", { name: "User" }).fill(login);
	await page.getByRole("textbox", { name: "User" }).press("Enter");
}

/** Fill the storage with other data, so a write that needs more room throws, e.g. of a key not stored yet. */
export async function fillStorage (page) {
	await page.evaluate(() => {
		let [low, high] = [0, 2e7];
		while (low < high) {
			let size = Math.ceil((low + high) / 2);
			try {
				localStorage.setItem("filler", "x".repeat(size));
				low = size;
			}
			catch {
				high = size - 1;
			}
		}
	});
}

/** The PR numbers of the rows, in the order shown, e.g. `#65`. */
export function numbers (page) {
	return page.locator("#queue tbody .number");
}

/** The row of a PR, e.g. of A, #65. */
export function row (page, id) {
	return page.locator("#queue tbody tr").filter({ hasText: `#${id.charCodeAt(0)}` });
}

/** GitHub’s answer that fails with this status, if any. Its body repeats the status, which Madata reads, e.g. a 401 for a token GitHub rejects */
function failed (status) {
	if (status) {
		return {
			status,
			json: { message: status === 401 ? "Bad credentials" : "Boom", status: String(status) },
		};
	}
}

/** A PR as the search finds it, e.g. #65 for A. */
function found (id) {
	return {
		id,
		number: id.charCodeAt(0),
		title: `A pull request titled ${id}`,
		url: "https://github.com/foo/bar/pull/1",
		// Fixed, as GitHub’s, so a refresh changes no row
		createdAt: "2026-01-01T00:00:00Z",
		labels: { nodes: [] },
		isDraft: false,
	};
}

/** A PR’s details. The later its letter, the bigger it is, e.g. F has +700. No one asked for a review, so no PR waits longer than another. */
function detailed (id) {
	return {
		id,
		additions: 10 * id.charCodeAt(0),
		deletions: 2,
		reviews: { nodes: [] },
		timelineItems: { nodes: [] },
		commits: { totalCount: 0, nodes: [] },
		reviewRequests: { nodes: [] },
		latestReviews: { nodes: [] },
		latestOpinionatedReviews: { nodes: [] },
		mergeable: "MERGEABLE",
		isInMergeQueue: false,
		autoMergeRequest: null,
		statusCheckRollup: null,
		reviewThreads: { nodes: [] },
	};
}
