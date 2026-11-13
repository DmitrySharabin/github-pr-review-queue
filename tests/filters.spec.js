import { test, expect, unfold } from "./github.js";

/** The Display button, whose name says how many of its settings are changed */
function display (page) {
	return page.getByRole("button", { name: /^Display/ });
}

/** The pattern field in the Display menu */
function pattern (page) {
	return page.getByRole("textbox", { name: "Exclude from counts" });
}

test("A view that applies nothing opens with the filters folded, so the rows come first", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");

	await expect(page.getByRole("button", { name: "Show filters" })).toBeVisible();
	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeHidden();
});

test("A view with a filter opens with the filters unfolded, to change it", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");

	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeVisible();
});

test("The author view folds a pattern away, as it counts no lines", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&role=author&exclude=test");
	await expect(page.locator("progress")).toBeHidden();

	// Shown, so folded. A hidden line could still hold the text
	await expect(page.locator("#filters .applied")).toBeVisible();
	await expect(page.locator("#filters .applied")).toHaveText("Filter");
});

test("Unfolded filters stay unfolded when the queue loads again, as only the first view picks the fold", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await unfold(page);

	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeVisible();
});

test("Folded, a pick of authors shows their faces, as the Author button does", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied img")).toHaveCount(1);
});

test("A click on a folded pattern unfolds the filters with the focus on Display, which holds it", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await page.locator("#filters .applied").getByText("test").click();

	await expect(display(page)).toBeFocused();
});

test("A click on folded authors while bars disable the Author button puts the focus on the fold button", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();
	github.search = () => new Promise(() => {});
	await page.getByRole("button", { name: "Change user" }).click();
	await page.getByRole("textbox", { name: "User" }).fill("other-user");
	await page.getByRole("textbox", { name: "User" }).press("Enter");
	await expect(page.locator("#author-button")).toBeDisabled();

	await page.locator("#filters .applied").getByText("qux").click();

	await expect(page.getByRole("button", { name: "Hide filters" })).toBeFocused();
});

test("A refresh that ends while the author list is open keeps the picked authors on the folded line", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Author: qux" }).click();
	// A click on Refresh would close the list first
	await page.locator("#refresh").evaluate(button => button.click());
	await expect(page.locator("progress")).toBeHidden();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("Author qux");
});

test("The fold button says whether the filters show, and names what a click does", async ({
	page,
	github,
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
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.locator("#filters .applied").getByRole("button", { name: "Filter" }).click();

	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeFocused();
});

test("Folded, the line says what is applied, not what was typed and left", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("searchbox", { name: "Filter", exact: true }).fill("label:wip");

	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("Filter label:bug");
});

test("Tab from an open menu to the fold button applies the menu, so folding leaves no menu open unseen", async ({
	page,
	github,
	browserName,
}) => {
	test.skip(browserName === "webkit", "WebKit’s Tab skips buttons, as Safari’s does by default");
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await unfold(page);
	await display(page).click();
	await pattern(page).fill("src");

	await page.getByRole("button", { name: "Apply" }).focus();
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "Hide filters" })).toBeFocused();
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(/exclude=src/);
});

test("Folded, the filters say what they apply, keyed as the Author button names its pick", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug&authors=qux&exclude=test");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText(
		"Filter label:bug Author qux Exclude test",
	);
});

test("Folded, the repo’s collaborators read as “Authors Collaborators”, so the key agrees with them", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=@collaborators");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("Authors Collaborators");
});

test("Folded, several authors read as the Author button’s count, with no key to repeat it", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=qux,quux");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await expect(page.locator("#filters .applied")).toHaveText("2 authors");
});

test("A folded value says that a press edits it, as its name only says what is applied", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");

	await expect(
		page.locator("#filters .applied").getByRole("button", { name: "Filter" }),
	).toHaveAccessibleDescription("Edit");
});

test("A click on a folded value unfolds the filters with the focus on its control", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&filter=label:bug&authors=qux");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Hide filters" }).click();

	await page.locator("#filters .applied").getByText("qux").click();

	await expect(page.locator("#author-button")).toBeFocused();
});

test("The filter says which search terms it takes, under the field", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await expect(
		page.getByRole("searchbox", { name: "Filter", exact: true }),
	).toHaveAccessibleDescription(/Any GitHub search terms/);
	await expect(page.getByRole("link", { name: "GitHub search terms" })).toBeVisible();
});

test("A long login shrinks the Author button, rather than push Display onto a line of its own", async ({
	page,
	github,
}) => {
	github.search = answer => {
		for (let pr of answer.data.search.nodes) {
			pr.author = { login: "a-very-long-login-name-that-goes-on-and-on", avatarUrl: "" };
		}
	};
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(
		"/?repo=foo/bar&authors=a-very-long-login-name-that-goes-on-and-on&exclude=test",
	);
	await expect(page.locator("progress")).toBeHidden();

	let [author, display] = await Promise.all(
		["#author-button", "#display-button"].map(selector => page.locator(selector).boundingBox()),
	);
	expect(display.y).toBe(author.y);
});

test("The filter’s note wraps rather than cut the label of the Author menu beside it", async ({
	page,
	github,
}) => {
	await page.setViewportSize({ width: 620, height: 600 });
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let cut = await page
		.locator("#author-button .text")
		.evaluate(text => text.scrollWidth > text.clientWidth);
	expect(cut).toBe(false);
});

test("A queue a filter emptied keeps the filter, to change or clear it", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&filter=label:none");

	await expect(page.locator("#empty")).toBeVisible();
	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toHaveValue(
		"label:none",
	);
});

test("An empty queue with no filter has nothing to narrow, so no filter", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#empty")).toBeVisible();
	await expect(page.locator("#filters")).toBeHidden();
});

test("Display says how many of its settings differ from their defaults", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&exclude=test");

	await expect(page.getByRole("button", { name: "Display, 1 setting changed" })).toBeVisible();
	await expect(page.locator("#display-button .badge")).toBeVisible();
});

test("A menu that hides rows looks set, so the row says which control hides them", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();

	let fill = button =>
		page.locator(button).evaluate(element => getComputedStyle(element).backgroundColor);
	expect(await fill("#author-button")).not.toBe(await fill("#display-button"));
});

test("Display with every setting at its default shows no count, nor names one", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await expect(page.getByRole("button", { name: "Display", exact: true })).toBeVisible();
	await expect(page.locator("#display-button .badge")).toBeHidden();
});

test("Display closed with no change loads nothing", async ({ page, github }) => {
	let searches = 0;
	let answer = github.search;
	github.search = found => {
		searches++;
		answer(found);
	};
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await page.locator("h1").click();
	await expect(page.locator("#display")).toBeHidden();
	// A search that the close started would come before the refresh’s
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	expect(searches).toBe(2);
});

test("Enter in Display applies the pattern", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await pattern(page).fill("test");
	await pattern(page).press("Enter");

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("Display opens with the focus in its field, to type at once", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();

	await expect(pattern(page)).toBeFocused();
});

test("Clear in Display shows only while there is a pattern to clear", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();
	await display(page).click();
	let clear = page.getByRole("button", { name: "Clear display settings" });
	await expect(clear).toBeVisible();

	await clear.click();
	await expect(clear).toBeHidden();
	await pattern(page).fill("src");

	await expect(clear).toBeVisible();
});

test("The filter’s ✕ shows only while a filter is applied", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&filter=label:bug");
	let clear = page.getByRole("button", { name: "Clear filter" });
	await expect(clear).toBeVisible();

	let field = page.getByRole("searchbox", { name: "Filter", exact: true });
	await field.fill("");
	await field.press("Enter");

	await expect(clear).toBeHidden();
});

test("An empty queue keeps the filter row while authors are picked, so they can be unpicked", async ({
	page,
	github,
}) => {
	// All their PRs merged, and no one else’s left
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&authors=nobody");
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.getByRole("button", { name: "Author: nobody" })).toBeVisible();
});

test("An empty queue hides Display, as there is nothing to count", async ({ page, github }) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&filter=label:none&exclude=test");
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.locator("#display-button")).toBeHidden();
});

test("The field focused after its ✕ stays, though the queue without the filter is empty too", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&filter=label:none");
	await expect(page.locator("#empty")).toBeVisible();

	await page.getByRole("button", { name: "Clear filter" }).press("Enter");
	await expect(page).toHaveURL(/\?repo=foo%2Fbar$/);
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeFocused();
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
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await pattern(page).fill("test");
	await page.locator("h1").click();

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("Esc drops the pattern typed in Display", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await pattern(page).fill("src");
	await page.keyboard.press("Escape");
	await expect(page.locator("#display")).toBeHidden();
	await display(page).click();

	await expect(pattern(page)).toHaveValue("test");
	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("A click after Esc in Display keeps the applied pattern", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await page.keyboard.press("Escape");
	await page.locator("h1").click();
	await expect(page.locator("#display")).toBeHidden();

	await expect(page).toHaveURL(/[?&]exclude=test(&|$)/);
});

test("A load that fails closes an open Display without applying it, so a click on the form applies nothing", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();
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
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Author" }).click();

	github.search = answer => {
		answer.data.search.nodes = [];
	};
	// A click on Refresh would close the list first
	await page.locator("#refresh").evaluate(button => button.click());
	await expect(page.locator("#empty")).toBeVisible();

	await expect(page.locator("#author-button")).toBeVisible();
});

test("A click outside Display drops a pattern that isn’t a regular expression, rather than keep it unapplied", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("progress")).toBeHidden();

	await display(page).click();
	await pattern(page).fill("test(");
	await page.locator("h1").click();
	await expect(page.locator("#display")).toBeHidden();
	await display(page).click();

	await expect(pattern(page)).toHaveValue("test");
});

test("The author view has no Display, as it counts no lines", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar&role=author");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#display-button")).toBeHidden();
	await expect(page.getByRole("searchbox", { name: "Filter", exact: true })).toBeVisible();
});
