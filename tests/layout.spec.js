import { test, expect } from "./github.js";

/** Where each column header starts, e.g. `[65, 518, …]`. */
function columns (page) {
	return page
		.locator("#queue thead th")
		.evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().x)));
}

test("Columns stay put when the rows replace the bars that stood in for them", async ({
	page,
	github,
}) => {
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	// As in a real reviewer queue, where every PR waits for DmitrySharabin: a wait time is wider than the dash of no request
	github.details = answer => {
		for (let pr of answer.data.nodes) {
			pr.timelineItems.nodes = [
				{
					createdAt: new Date(Date.now() - 25 * 86_400_000).toISOString(),
					requestedReviewer: { login: "DmitrySharabin" },
				},
			];
		}
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	let before = await columns(page);

	resolve();
	await expect(page.locator("progress")).toBeHidden();

	expect(await columns(page)).toEqual(before);
});
