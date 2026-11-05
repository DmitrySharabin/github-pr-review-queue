import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Playwright’s `test` with GitHub faked for the test’s page, as DmitrySharabin, whose queue in any repo holds PRs A–F (#65–#70).
 * A test changes how GitHub answers through the `github` fixture’s hooks. Each gets the answer to change, e.g. to add GraphQL errors,
 * and may return an HTTP status to fail with, e.g. `github.search = () => 500`, or a promise to hold the answer until it settles.
 * `details` also gets the queries for commit sizes, whose nodes are then commits, e.g. N with +780.
 */
export const test = base.extend({
	github: async ({ context }, use) => {
		let github = {
			search () {},
			details () {},
		};

		// Madata signs in with a stored token without asking GitHub for one
		await context.addInitScript(() =>
			localStorage.setItem("madata:token:auth.madata.dev/github", "fake"));

		// Nothing waits on the network: an avatar that GitHub is slow to send holds up the page’s load event, and with it `page.goto()`.
		// Every avatar is a black square
		await context.route("https://auth.madata.dev/services.json", route =>
			route.fulfill({ json: { Github: { client_id: "fake" } } }));
		await context.route("https://github.com/*.png*", route =>
			route.fulfill({
				contentType: "image/svg+xml",
				body: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48"/></svg>`,
			}));

		await context.route("https://api.github.com/**", async route => {
			if (new URL(route.request().url()).pathname === "/user") {
				return route.fulfill({ json: { login: "DmitrySharabin" } });
			}

			let { query } = route.request().postDataJSON();
			let isSearch = query.includes("search(");
			let answer = isSearch
				? { data: { search: { nodes: [..."ABCDEF"].map(found) } } }
				: {
						data: {
							nodes: JSON.parse(query.match(/nodes\(ids: (\[.*?\])\)/)[1]).map(
								detailed,
							),
						},
					};

			let status = await (isSearch ? github.search : github.details)(answer);
			route.fulfill(status ? { status, json: { message: "Boom" } } : { json: answer });
		});

		await use(github);
	},
});

/** A PR as the search finds it, e.g. #65 for A. */
function found (id) {
	return {
		id,
		number: id.charCodeAt(0),
		title: `A pull request titled ${id}`,
		url: "https://github.com/foo/bar/pull/1",
		labels: { nodes: [] },
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
		commits: { nodes: [] },
		reviewRequests: { nodes: [] },
		latestReviews: { nodes: [] },
		latestOpinionatedReviews: { nodes: [] },
	};
}
