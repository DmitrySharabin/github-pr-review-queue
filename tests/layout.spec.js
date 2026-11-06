import { test, expect, commit } from "./github.js";

/**
 * Where each of these cells starts while bars stand in for the rows, then once the rows replace them, e.g. `[[65, 518, …], [65, 518, …]]`.
 * `edge` measures another side of them instead, e.g. `bottom`.
 */
async function starts (page, github, selector, { url = "/?repo=foo/bar", edge = "x" } = {}) {
	let measure = () =>
		page
			.locator(selector)
			.evaluateAll(
				(cells, edge) => cells.map(cell => Math.round(cell.getBoundingClientRect()[edge])),
				edge,
			);

	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	// As in a real reviewer queue, every PR waits for DmitrySharabin. A wait time is wider than the dash of no request.
	// A test’s own `github.details` still runs, e.g. to add reviewers
	let { details } = github;
	github.details = answer => {
		details(answer);
		for (let pr of answer.data.nodes) {
			pr.timelineItems.nodes = [
				{
					createdAt: new Date(Date.now() - 25 * 86_400_000).toISOString(),
					requestedReviewer: { login: "DmitrySharabin" },
				},
			];
			// Still pending, so the request isn’t a team’s
			pr.reviewRequests.nodes.push({ requestedReviewer: { login: "DmitrySharabin" } });
		}
	};
	await page.goto(url);
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	let before = await measure();

	resolve();
	await expect(page.locator("progress")).toBeHidden();

	return [before, await measure()];
}

test("Columns stay put when the rows replace the bars that stood in for them", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("On a phone, where titles wrap, columns stay put when the rows replace the bars", async ({
	page,
	github,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });

	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("Columns stay put when a PR’s many reviewers arrive", async ({ page, github }) => {
	github.details = answer => {
		answer.data.nodes[0].reviewRequests.nodes = Array.from({ length: 12 }, (_, i) => ({
			requestedReviewer: { login: `user${i}`, avatarUrl: `https://github.com/user${i}.png` },
		}));
	};

	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("The strip’s cells stay put when the count and the latest request replace their bars", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#summary > div");

	expect(after).toEqual(before);
});

test("In the author view, columns stay put when the rows replace the bars", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#queue thead th", {
		url: "/?repo=foo/bar&role=author",
	});

	expect(after).toEqual(before);
});

test("A step that wraps, as long ones do, leaves its row as tall as the bars", async ({
	page,
	github,
}) => {
	// Changes requested on the last commit: “Make the changes @reviewer requested”
	github.details = answer => {
		let review = {
			state: "CHANGES_REQUESTED",
			url: "",
			submittedAt: "2026-11-01T12:00:00Z",
			author: {
				__typename: "User",
				login: "reviewer",
				avatarUrl: "https://github.com/reviewer.png",
			},
			commit: { oid: "L" },
		};
		for (let pr of answer.data.nodes) {
			Object.assign(pr, {
				commits: { totalCount: 1, nodes: [commit("L")] },
				latestReviews: { nodes: [review] },
				latestOpinionatedReviews: { nodes: [review] },
			});
		}
	};

	let [before, after] = await starts(page, github, "#queue tbody tr", {
		url: "/?repo=foo/bar&role=author",
		edge: "bottom",
	});

	expect(after).toEqual(before);
});
