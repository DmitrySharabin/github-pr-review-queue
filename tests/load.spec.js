import { test, expect } from "./github.js";

test("A failed search hides the bars that stood in for its rows, even of the view shown last", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = () => 500;
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	// Back to the reviewer view, still the one last shown, which shows bars since nothing is on screen
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goBack();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve(500);

	await expect(page.locator("#queue")).toBeHidden();
});

test("A role switch hides the counter of the load it stops", async ({ page, github }) => {
	github.details = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();

	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Author" }).click();

	await expect(page.locator("#counter")).toBeHidden();
});

test("On a phone, the counter shows below the title, not over it", async ({ page, github }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	github.details = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();

	let title = await page.locator("h1").boundingBox();
	let counter = await page.locator("#counter").boundingBox();

	expect(counter.y).toBeGreaterThanOrEqual(title.y + title.height);
});

test("Failed details keep the rows the search found on screen", async ({ page, github }) => {
	github.details = () => 500;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	await expect(page.locator("#queue tbody .number").filter({ visible: true })).toHaveCount(6);
});

test("A sort chosen while the bars show keeps them, and sorts the rows that replace them", async ({ page, github }) => {
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();

	await page.getByRole("button", { name: "All changes" }).click();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve();

	await expect(page.locator("#queue tbody .number")).toHaveText(["#70", "#69", "#68", "#67", "#66", "#65"]);
});

test("A PR deleted between the search and its details counts as loaded, and leaves the others to load", async ({ page, github }) => {
	// 11 PRs ask for details in two batches, of 10 and 1
	github.search = answer => {
		let [pr] = answer.data.search.nodes;
		answer.data.search.nodes.push(...[..."GHIJK"].map(id => ({ ...pr, id, number: id.charCodeAt(0) })));
	};
	let { promise, resolve } = Promise.withResolvers();
	github.details = answer => {
		if (answer.data.nodes.length === 1) {
			return promise;
		}

		// As GitHub answers for B
		answer.data.nodes[1] = null;
		answer.errors = [{ type: "NOT_FOUND", path: ["nodes", 1], message: "Could not resolve to a node with the global id of 'B'." }];
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toContainText("10 of 11");
	resolve();

	// The update time shows only once a load ends without failing
	await expect(page.locator("#updated time")).not.toBeEmpty();
	await expect(page.locator("#queue td.diff .added")).toHaveCount(10);
});

test("A PR stored without details, after GitHub said it was deleted, asks for them again on the next visit", async ({ page, github }) => {
	github.details = answer => {
		answer.data.nodes[1] = null;
		answer.errors = [{ type: "NOT_FOUND", path: ["nodes", 1], message: "Could not resolve to a node with the global id of 'B'." }];
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.reload();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#repo-form .notice")).toBeHidden();
});

test("A repository GitHub can’t find still fails the load", async ({ page, github }) => {
	github.search = answer => {
		answer.data.repository = null;
		answer.errors = [{ type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository with the name 'foo/bar'." }];
	};
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#repo-form .notice")).toContainText("GitHub can’t find this repository");
});
