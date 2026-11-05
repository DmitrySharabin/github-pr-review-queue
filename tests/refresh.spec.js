import { test, expect } from "./github.js";

test("A refresh asks for the details of only the PRs that changed since the last load", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let asked = [];
	github.details = answer => {
		asked.push(...answer.data.nodes.map(pr => pr.id));
	};
	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	expect(asked).toEqual(["A"]);
});

test("A refresh keeps focus in a row that didn’t change", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.getByRole("button", { name: "Refresh" }).click();
	let link = page.getByRole("link", { name: "A pull request titled B" });
	await link.focus();
	resolve();

	await expect(page.locator("progress")).toBeHidden();
	await expect(link).toBeFocused();
});

test("A refresh that GitHub fails keeps the queue on screen, with no form to fix a repo or user that were fine", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.details = () => 502;
	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	await page.getByRole("button", { name: "Refresh" }).click();

	await expect(page.getByText("Couldn’t refresh")).toBeVisible();
	await expect(page.locator("#repo-form")).toBeHidden();
	await expect(page.getByRole("link", { name: "A pull request titled A" })).toBeVisible();
});

test("A refresh that GitHub fails leaves focus on Refresh, so the user can try again", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	await expect(page.getByRole("button", { name: "Refresh" })).toBeFocused();
});

test("A refresh that can’t find the repository shows the form to fix it", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.errors = [{ message: "Could not resolve to a Repository with the name 'foo/bar'." }];
	};
	await page.getByRole("button", { name: "Refresh" }).click();

	await expect(page.locator("#repo-form .notice")).toBeVisible();
});

test("A refresh that succeeds after a failed one no longer says it failed", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	github.search = () => {};
	await page.getByRole("button", { name: "Refresh" }).click();

	await expect(page.getByText("Couldn’t refresh")).toBeHidden();
});

test("A long reason for a failed refresh shows its first lines, so the header doesn’t push the queue far down", async ({
	page,
	github,
}) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.errors = [
			{ message: "Your token’s lifetime is too long for this organization. ".repeat(4) },
		];
	};
	await page.getByRole("button", { name: "Refresh" }).click();

	await expect(page.locator("#failure").getByRole("button", { name: "Show all" })).toBeVisible();
});

test("A failed refresh calls the time the last update, so it doesn’t read as if the refresh updated the rows", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();

	await expect(page.getByText("Last updated at")).toBeVisible();
});

test("A failed refresh after one that showed the form hides the form, whose reason no longer holds", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = answer => {
		answer.errors = [{ message: "Could not resolve to a Repository with the name 'foo/bar'." }];
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	await expect(page.locator("#repo-form")).toBeHidden();
});

test("A failed refresh of an empty queue doesn’t leave a screen reader hearing that it still loads", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#empty")).toBeVisible();

	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	await expect(page.locator("#status")).not.toHaveText("Loading pull requests…");
});

test("A retry after a failed refresh keeps the queue in place while it runs, instead of moving it up and back", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	let strip = page.locator("#summary");
	let { y } = await strip.boundingBox();

	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeVisible();

	expect((await strip.boundingBox()).y).toBe(y);
	resolve(502);
});
