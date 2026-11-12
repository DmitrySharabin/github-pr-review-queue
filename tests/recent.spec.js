import { test, expect } from "./github.js";

test("Typing in the repository field marks the typed part of each recent repository, in any case", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await page.goto("/");

	await page.getByRole("combobox", { name: "Repository" }).fill("BA");

	await expect(page.getByRole("option").locator("mark")).toHaveText(["ba"]);
});
