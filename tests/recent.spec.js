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
	// Picked, not submitted
	await expect(page).toHaveURL("/");
});

test("Esc closes the recent repositories and keeps what is typed", async ({ page, github }) => {
	let field = await visit(page, "foo/bar");

	await field.fill("foo");
	await expect(page.getByRole("option")).toHaveText(["foo/bar"]);
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
	await expect(page.getByRole("option")).toHaveCount(2);
	await page.getByRole("button", { name: "Clear recent repositories" }).click();
	await page.reload();
	await field.press("ArrowDown");

	await expect(page.getByRole("listbox", { name: "Recent repositories" })).toBeHidden();
});

test("A repo with queues of two roles shows once, and removing it forgets both", async ({
	page,
	github,
}) => {
	let field = await visit(page, "foo/bar", "foo/bar&role=author", "foo/baz");

	await field.press("ArrowDown");
	await expect(page.getByRole("option")).toHaveText(["foo/baz", "foo/bar"]);
	await field.press("ArrowUp");
	await field.press("Shift+Delete");
	await page.reload();
	await field.press("ArrowDown");

	await expect(page.getByRole("option")).toHaveText(["foo/baz"]);
});

test("Delete without Shift keeps the active recent repository", async ({ page, github }) => {
	let field = await visit(page, "foo/bar");

	await field.press("ArrowDown");
	await field.press("Delete");

	await expect(page.getByRole("option")).toHaveText(["foo/bar"]);
});

test("Removing a recent user forgets that user’s queues only", async ({ page, github }) => {
	let field = await visit(page, "foo/bar&user=other-user", "foo/baz");

	let user = page.getByRole("combobox", { name: "User" });
	await user.press("ArrowDown");
	await user.press("Shift+Delete");
	await page.reload();
	await field.press("ArrowDown");

	await expect(page.getByRole("option")).toHaveText(["foo/baz"]);
});
