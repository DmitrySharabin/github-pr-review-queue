import {
	test,
	expect,
	changeUser,
	fillStorage,
	filter,
	filterBy,
	loaded,
	none,
	open,
	refresh,
	unfold,
} from "./github.js";

/** The Display button, whose name says how many of its settings are changed */
function display (page) {
	return page.getByRole("button", { name: /^Display/ });
}

/** The pattern field in the Display menu */
function pattern (page) {
	return page.getByRole("textbox", { name: "Exclude from counts" });
}

test("The first visit opens with the filters folded, even with a filter, as the folded line names it", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");

	await expect(page.getByRole("button", { name: "Show filters" })).toBeVisible();
	await expect(filter(page)).toBeHidden();
});

test("Filters unfolded with nothing applied open unfolded on the next visit, as the user left them", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await page.reload();

	await expect(filter(page)).toBeVisible();
});

test("Filters folded again open folded on the next visit", async ({ page }) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await page.getByRole("button", { name: "Hide filters" }).click();

	await page.reload();

	await expect(page.getByRole("button", { name: "Show filters" })).toBeVisible();
});

test("The author view folds a pattern away, as it counts no lines", async ({ page }) => {
	await open(page, "/?repo=foo/bar&role=author&exclude=test");

	// Shown, so folded. A hidden line could still hold the text
	await expect(page.locator("#filters .applied")).toBeVisible();
	await expect(page.locator("#filters .applied")).toHaveText("Filter");
});

test("A click on a folded value leaves the filters unfolded on the next visit", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");
	await page.locator("#filters .applied").getByText("label:bug").click();

	await page.reload();

	await expect(filter(page)).toBeVisible();
});

test("A full storage still shows the queue, and only the next visit forgets the fold", async ({
	page,
}) => {
	await open(page);
	// The fold isn’t stored yet, as on the first visit since an update, and doesn’t fit
	await page.evaluate(() => localStorage.removeItem("review-queue:filters-folded"));
	await fillStorage(page);

	await page.reload();

	await loaded(page);
	await expect(page.getByRole("button", { name: "Show filters" })).toBeVisible();
});

test("Unfolded filters stay unfolded when the queue loads again", async ({ page }) => {
	await open(page);
	await unfold(page);

	await refresh(page);
	await loaded(page);

	await expect(filter(page)).toBeVisible();
});

test("Folded, a pick of authors shows their faces, as the Author button does", async ({ page }) => {
	await open(page, "/?repo=foo/bar&authors=qux");

	await expect(page.locator("#filters .applied img")).toHaveCount(1);
});

test("A click on a folded pattern unfolds the filters with the focus on Display, which holds it", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&exclude=test");

	await page.locator("#filters .applied").getByText("test").click();

	await expect(display(page)).toBeFocused();
});

test("A click on folded authors while bars disable the Author button puts the focus on the fold button", async ({
	page,
	github,
}) => {
	await open(page, "/?repo=foo/bar&authors=qux");
	github.search = () => new Promise(() => {});
	await changeUser(page, "other-user");
	await expect(page.locator("#author-button")).toBeDisabled();

	await page.locator("#filters .applied").getByText("qux").click();

	await expect(page.getByRole("button", { name: "Hide filters" })).toBeFocused();
});

test("A refresh that ends while the author list is open keeps the picked authors on the folded line", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&authors=qux");
	await unfold(page);
	await page.getByRole("button", { name: "Author: qux" }).click();
	// A click on Refresh would close the list first
	await page.locator("#refresh").evaluate(button => button.click());
	await loaded(page);
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("Author qux");
});

test("The fold button says whether the filters show, and names what a click does", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	let fold = page.locator("#filters .fold");
	await expect(fold).toHaveAttribute("aria-expanded", "false");

	await fold.click();

	await expect(fold).toHaveAttribute("aria-expanded", "true");
	await expect(fold).toHaveAccessibleName("Hide filters");
});

test("With nothing applied, the folded line offers the filter, and a click puts the focus in it", async ({
	page,
}) => {
	await open(page);

	await page.locator("#filters .applied").getByRole("button", { name: "Filter" }).click();

	await expect(filter(page)).toBeFocused();
});

test("Folded, the line says what is applied, not what was typed and left", async ({ page }) => {
	await open(page, "/?repo=foo/bar&filter=label:bug");
	await unfold(page);
	await filter(page).fill("label:wip");

	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("Filter label:bug");
});

test("Tab out of an open menu applies it, as a click outside does", async ({
	page,
	browserName,
}) => {
	test.skip(browserName === "webkit", "WebKit’s Tab skips buttons, as Safari’s does by default");
	await open(page);
	await unfold(page);
	await display(page).click();
	await pattern(page).fill("src");

	await page.getByRole("button", { name: "Apply" }).focus();
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "Hide filters" })).toBeFocused();

	await expect(page).toHaveURL(/exclude=src/);
});

test("Folded, the filters say what they apply, keyed as the Author button names its pick", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&filter=label:bug&authors=qux&exclude=test");

	await expect(page.locator("#filters .applied")).toHaveText(
		"Filter label:bug Author qux Exclude test",
	);
});

test("Folded, the repo’s collaborators read as “Authors Collaborators”, so the key agrees with them", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&authors=@collaborators");

	await expect(page.locator("#filters .applied")).toHaveText("Authors Collaborators");
});

test("Folded, several authors read as the Author button’s count, with no key to repeat it", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&authors=qux,quux");

	await expect(page.locator("#filters .applied")).toHaveText("2 authors");
});

test("A folded value says that a press edits it, as its name only says what is applied", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");

	await expect(
		page.locator("#filters .applied").getByRole("button", { name: "Filter" }),
	).toHaveAccessibleDescription("Edit");
});

test("A click on a folded value unfolds the filters with the focus on its control", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&filter=label:bug&authors=qux");

	await page.locator("#filters .applied").getByText("qux").click();

	await expect(page.locator("#author-button")).toBeFocused();
});

test("The filter says which search terms it takes, under the field", async ({ page }) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await expect(filter(page)).toHaveAccessibleDescription(/Any GitHub search terms/);
	await expect(page.getByRole("link", { name: "GitHub search terms" })).toBeVisible();
});

test("The filter’s note wraps rather than cut the label of the Author menu beside it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 620, height: 600 });
	await open(page);
	await unfold(page);

	let cut = await page
		.locator("#author-button .text")
		.evaluate(text => text.scrollWidth > text.clientWidth);
	expect(cut).toBe(false);
});

test("A queue a filter emptied keeps the filter, to change or clear it", async ({
	page,
	github,
}) => {
	github.search = none;
	await page.goto("/?repo=foo/bar&filter=label:none");
	await unfold(page);

	await expect(page.locator("#empty")).toBeVisible();
	await expect(filter(page)).toHaveValue("label:none");
});

test("An empty queue with no filter has nothing to narrow, so no filter", async ({
	page,
	github,
}) => {
	github.search = none;
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#empty")).toBeVisible();
	await expect(page.locator("#filters")).toBeHidden();
});

test("Display says how many of its settings differ from their defaults", async ({ page }) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await unfold(page);

	await expect(page.getByRole("button", { name: "Display, 1 setting changed" })).toBeVisible();
	await expect(page.locator("#display-button .badge")).toBeVisible();
});

test("A menu that hides rows looks set, so the row says which control hides them", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&authors=qux");

	let fill = button =>
		page.locator(button).evaluate(element => getComputedStyle(element).backgroundColor);
	expect(await fill("#author-button")).not.toBe(await fill("#display-button"));
});

test("Display with every setting at its default shows no count, nor names one", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await expect(page.getByRole("button", { name: "Display", exact: true })).toBeVisible();
	await expect(page.locator("#display-button .badge")).toBeHidden();
});

test("Display closed with no change loads nothing", async ({ page, github }) => {
	await open(page, "/?repo=foo/bar&exclude=test");
	await unfold(page);

	await display(page).click();
	await page.locator("#updated").click();
	await expect(page.locator("#display")).toBeHidden();
	// A search that the close started would come before the refresh’s
	await refresh(page);
	await loaded(page);

	expect(github.searches).toBe(2);
});

test("Enter in Display applies the pattern", async ({ page }) => {
	await open(page);
	await unfold(page);

	await display(page).click();
	await pattern(page).fill("test");
	await pattern(page).press("Enter");

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("Display opens with the focus in its field, to type at once", async ({ page }) => {
	await open(page);
	await unfold(page);

	await display(page).click();

	await expect(pattern(page)).toBeFocused();
});

test("Clear in Display shows only while there is a pattern to clear", async ({ page }) => {
	await open(page, "/?repo=foo/bar&exclude=test");
	await unfold(page);
	await display(page).click();
	let clear = page.getByRole("button", { name: "Clear display settings" });
	await expect(clear).toBeVisible();

	await clear.click();
	await expect(clear).toBeHidden();
	await pattern(page).fill("src");

	await expect(clear).toBeVisible();
});

test("The filter’s ✕ shows only while a filter is applied", async ({ page }) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");
	await unfold(page);
	let clear = page.getByRole("button", { name: "Clear filter" });
	await expect(clear).toBeVisible();

	await filterBy(page, "");

	await expect(clear).toBeHidden();
});

test("An empty queue keeps the filter row while authors are picked, so they can be unpicked", async ({
	page,
	github,
}) => {
	// All their PRs merged, and no one else’s left
	github.search = none;
	await page.goto("/?repo=foo/bar&authors=nobody");
	await unfold(page);
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.getByRole("button", { name: "Author: nobody" })).toBeVisible();
});

test("An empty queue hides Display, as there is nothing to count", async ({ page, github }) => {
	github.search = none;
	await page.goto("/?repo=foo/bar&filter=label:none&exclude=test");
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.locator("#display-button")).toBeHidden();
});

test("The field focused after its ✕ stays, though the queue without the filter is empty too", async ({
	page,
	github,
}) => {
	github.search = none;
	await page.goto("/?repo=foo/bar&filter=label:none");
	// From the keyboard, as Firefox shows no focus ring after a click, and ✕ then leaves the focus alone
	await page.getByRole("button", { name: "Show filters" }).press("Enter");
	await expect(page.locator("#empty")).toBeVisible();

	await page.getByRole("button", { name: "Clear filter" }).press("Enter");
	await expect(page).toHaveURL(/\?repo=foo%2Fbar$/);
	await loaded(page);

	await expect(filter(page)).toBeFocused();
});

test("A failed search hides the filter row with the queue", async ({ page, github }) => {
	github.search = () => 500;
	await page.goto("/?repo=foo/bar&filter=label:bug");
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	await expect(page.locator("#filters")).toBeHidden();
});

test("While the author view loads, it has no Display either", async ({ page, github }) => {
	github.search = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar&role=author");
	await expect(page.locator("#queue .skeleton").first()).toBeVisible();

	await expect(page.locator("#display-button")).toBeHidden();
});

test("A click outside Display applies the pattern typed in it, as the author list does", async ({
	page,
}) => {
	await open(page);
	await unfold(page);

	await display(page).click();
	await pattern(page).fill("test");
	await page.locator("#updated").click();

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("Esc drops the pattern typed in Display", async ({ page }) => {
	await open(page, "/?repo=foo/bar&exclude=test");
	await unfold(page);

	await display(page).click();
	await pattern(page).fill("src");
	await page.keyboard.press("Escape");
	await expect(page.locator("#display")).toBeHidden();
	await display(page).click();

	await expect(pattern(page)).toHaveValue("test");
	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("A click after Esc in Display keeps the applied pattern", async ({ page }) => {
	await open(page, "/?repo=foo/bar&exclude=test");
	await unfold(page);

	await display(page).click();
	await page.keyboard.press("Escape");
	await page.locator("#updated").click();
	await expect(page.locator("#display")).toBeHidden();

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("A load that fails closes an open Display without applying it, so a click on the form applies nothing", async ({
	page,
	github,
}) => {
	await open(page);
	await unfold(page);
	await display(page).click();
	await pattern(page).fill("src");

	github.search = () => 500;
	// From the keyboard, which closes no menu
	await page.locator("#filter").evaluate(field => {
		field.value = "label:bug";
		field.form.requestSubmit();
	});
	await expect(page.locator("#repo-form .notice")).toBeVisible();
	await page.getByRole("button", { name: "Show queue" }).click();

	await expect(page).not.toHaveURL(/exclude/);
});

test("The author list open while a refresh empties the queue stays by its button", async ({
	page,
	github,
}) => {
	await open(page);
	await unfold(page);
	await page.getByRole("button", { name: "Author" }).click();

	github.search = none;
	// A click on Refresh would close the list first
	await page.locator("#refresh").evaluate(button => button.click());
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.locator("#author-button")).toBeVisible();
});

test("A click outside Display drops a pattern that isn’t a regular expression, rather than keep it unapplied", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&exclude=test");
	await unfold(page);

	await display(page).click();
	await pattern(page).fill("test(");
	await page.locator("#updated").click();
	await expect(page.locator("#display")).toBeHidden();
	await display(page).click();

	await expect(pattern(page)).toHaveValue("test");
});

test("The author view has no Display, as it counts no lines", async ({ page }) => {
	await open(page, "/?repo=foo/bar&role=author");
	await unfold(page);

	await expect(page.locator("#display-button")).toBeHidden();
	await expect(filter(page)).toBeVisible();
});
