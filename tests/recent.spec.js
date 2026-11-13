import { test, expect } from "./github.js";

/** Load the queues of these repos, the last one latest, then open the page that asks for a repo. */
async function visit (page, ...repos) {
	for (let repo of repos) {
		await page.goto(`/?repo=${repo}`);
		await expect(page.locator("progress")).toBeHidden();
	}
	await page.goto("/");
	return page.getByRole("combobox", { name: "Repository" });
}

test("Typing in the repository field marks the typed part of each recent repository, in any case", async ({
	page,
	github,
}) => {
	let field = await visit(page, "foo/bar");

	await field.fill("BA");

	await expect(page.getByRole("option").locator("mark")).toHaveText(["ba"]);
});

test("↓ in the repository field lists the recent repositories, the latest first", async ({
	page,
	github,
}) => {
	let field = await visit(page, "foo/bar", "foo/baz");

	await field.press("ArrowDown");

	await expect(page.getByRole("option")).toHaveText(["foo/baz", "foo/bar"]);
});

test("Enter picks the active recent repository", async ({ page, github }) => {
	let field = await visit(page, "foo/bar", "foo/baz");

	await field.press("ArrowDown");
	await field.press("ArrowDown");
	await field.press("Enter");

	await expect(field).toHaveValue("foo/bar");
});

test("Esc closes the recent repositories and keeps what is typed", async ({ page, github }) => {
	let field = await visit(page, "foo/bar");

	await field.fill("foo");
	await field.press("Escape");

	await expect(page.getByRole("listbox", { name: "Recent repositories" })).toBeHidden();
	await expect(field).toHaveValue("foo");
});

test("Shift+Delete removes the active recent repository, also on the next visit", async ({
	page,
	github,
}) => {
	let field = await visit(page, "foo/bar", "foo/baz");

	await field.press("ArrowDown");
	await field.press("Shift+Delete");
	await page.reload();
	await field.press("ArrowDown");

	await expect(page.getByRole("option")).toHaveText(["foo/bar"]);
});

test("Clear recent repositories empties the list, also on the next visit", async ({
	page,
	github,
}) => {
	let field = await visit(page, "foo/bar", "foo/baz");

	await field.press("ArrowDown");
	await page.getByRole("button", { name: "Clear recent repositories" }).click();
	await page.reload();
	await field.press("ArrowDown");

	await expect(page.getByRole("listbox", { name: "Recent repositories" })).toBeHidden();
});
