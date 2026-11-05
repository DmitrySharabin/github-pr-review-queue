import { test, expect } from "./github.js";

/** Where each of these cells starts while bars stand in for the rows, then once the rows replace them, e.g. `[[65, 518, …], [65, 518, …]]`. */
async function starts (page, github, selector) {
	let measure = () =>
		page
			.locator(selector)
			.evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().x)));

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

test("The strip’s cells stay put when the count and the latest request replace their bars", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#summary > div");

	expect(after).toEqual(before);
});
