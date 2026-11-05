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
