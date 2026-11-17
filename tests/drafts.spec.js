import { test, expect, none, open, row, unfold } from "./github.js";

/** Make PRs drafts, e.g. `"A"` for #65, or all six. */
function draft (github, ids = "A") {
	github.search = answer => {
		for (let pr of answer.data.search.nodes) {
			pr.isDraft = ids.includes(pr.id);
		}
	};
}

/** The toggle, whose name says how many drafts it hides, e.g. “Hide drafts, 1 hidden”. */
function toggle (page) {
	return page.locator("#drafts-button");
}

test("A reviewer’s queue hides drafts, which they can’t review yet, and the toggle says how many", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page);
	await unfold(page);

	await expect(row(page, "A")).toBeHidden();
	await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
	await expect(toggle(page)).toHaveAccessibleName("Hide drafts, 1 hidden");
});

test("A press on the toggle shows the drafts without a new search, and the URL keeps it for a link", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page);
	await unfold(page);

	await toggle(page).click();

	await expect(row(page, "A")).toBeVisible();
	await expect(page).toHaveURL(/drafts=show/);
	expect(github.searches).toBe(1);
});

test("A press back to the view’s default leaves no `drafts` in the URL, as a link without it means the same", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page, "/?repo=foo/bar&drafts=show");
	await unfold(page);

	await toggle(page).click();

	await expect(row(page, "A")).toBeHidden();
	await expect(page).not.toHaveURL(/drafts/);
});

test("The author view shows the author’s own drafts", async ({ page, github }) => {
	draft(github);
	await open(page, "/?repo=foo/bar&role=author");
	await unfold(page);

	await expect(row(page, "A")).toBeVisible();
	await expect(toggle(page)).toBeVisible();
	await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
});

for (let term of ["-is:draft", "draft:false", "-draft:true"]) {
	test(`The term \`${term}\` moves from the filter to the toggle, so only one place says that drafts hide`, async ({
		page,
		github,
	}) => {
		draft(github);
		await open(page, `/?repo=foo/bar&filter=${term}`);

		await expect.poll(() => new URL(page.url()).search).toBe("?repo=foo%2Fbar");
	});
}

test("A term that hides drafts in the author view becomes `drafts=hide`, as that view shows them by default", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page, "/?repo=foo/bar&role=author&filter=draft:false");

	await expect(row(page, "A")).toBeHidden();
	await expect
		.poll(() => Object.fromEntries(new URL(page.url()).searchParams))
		.toEqual({ repo: "foo/bar", role: "author", drafts: "hide" });
});

test("A typed term that hides drafts wins over an older `drafts=show`, as a filter’s `author:` wins over older `authors`", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page, "/?repo=foo/bar&drafts=show&filter=-is:draft");

	await expect(row(page, "A")).toBeHidden();
	await expect.poll(() => new URL(page.url()).search).toBe("?repo=foo%2Fbar");
});

for (let term of ["is:draft", "draft:true", "-draft:false"]) {
	test(`The term \`${term}\` asks for drafts only, so they show and the toggle that could hide them goes`, async ({
		page,
		github,
	}) => {
		draft(github);
		await open(page, `/?repo=foo/bar&filter=${term}`);
		await unfold(page);

		await expect(row(page, "A")).toBeVisible();
		await expect(toggle(page)).toBeHidden();
	});
}

test("A queue without drafts disables the toggle and says so, as a press would change nothing", async ({
	page,
}) => {
	await open(page);
	await unfold(page);

	await expect(toggle(page)).toBeDisabled();
	await expect(toggle(page)).toHaveText("No drafts");
	await expect(toggle(page)).not.toHaveAttribute("aria-pressed");
});

test("The toggle without drafts keeps the focus and ignores a press, so a step back to such a queue doesn’t drop the focus to the page", async ({
	page,
}) => {
	await open(page);
	await unfold(page);

	await toggle(page).focus();
	await page.keyboard.press("Enter");

	await expect(toggle(page)).toBeFocused();
	await expect(page).not.toHaveURL(/drafts/);
});

test("A search that finds nothing hides the toggle, as there is nothing to hide", async ({
	page,
	github,
}) => {
	github.search = none;
	// A filter keeps the row on screen, which an empty queue hides otherwise
	await open(page, "/?repo=foo/bar&filter=label:x");
	await unfold(page);

	await expect(toggle(page)).toBeHidden();
});

test("The strip counts the PRs that show of all the search found, as hidden drafts are among them", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page);

	await expect(page.locator("#summary .count")).toHaveText("5 of 6");
});

test("A queue without drafts counts its PRs plainly, as nothing is hidden", async ({ page }) => {
	await open(page);

	await expect(page.locator("#summary .count")).toHaveText("6");
});

test("Folded filters say how many drafts hide, so no draft someone asked about goes missing unseen", async ({
	page,
	github,
}) => {
	draft(github, "AB");
	await open(page);

	await expect(page.locator("#filters .applied")).toHaveText("2 drafts hidden");
});

test("A queue of drafts only says so, and its link shows them", async ({ page, github }) => {
	draft(github, "ABCDEF");
	await open(page);
	await expect(page.locator("#empty h2")).toHaveText("Nothing ready for review");
	await expect(page.locator("#empty p")).toHaveText(
		"All 6 pull requests waiting for your review in foo/bar are drafts. Show drafts to see them.",
	);

	await page.getByRole("link", { name: "Show drafts" }).click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
});

test("The Author list counts the PRs it can show, not hidden drafts", async ({ page, github }) => {
	draft(github);
	await open(page);
	await unfold(page);

	await page.getByRole("button", { name: "Author" }).click();

	await expect(page.locator("#authors .prs")).toHaveText(["5"]);
});

test("A switch to the author view drops `drafts=show`, as the author view shows drafts anyway", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page, "/?repo=foo/bar&drafts=show");

	await page.getByRole("link", { name: "Author" }).click();

	await expect(page).toHaveURL(/role=author/);
	await expect(page).not.toHaveURL(/drafts/);
});

test("The toggle waits for the bars’ load, which would show a press only once it ends", async ({
	page,
	github,
}) => {
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goto("/?repo=foo/bar");
	await unfold(page);

	await expect(toggle(page)).toBeDisabled();
	resolve();
});

test("The toggle counts only the drafts a press would show, not those of authors not picked", async ({
	page,
	github,
}) => {
	draft(github, "AB");
	github.search = (search => answer => {
		search(answer);
		for (let pr of answer.data.search.nodes) {
			pr.author = { login: pr.id === "A" ? "foo" : "qux", avatarUrl: "" };
		}
	})(github.search);
	await open(page, "/?repo=foo/bar&authors=foo");
	await unfold(page);

	await expect(toggle(page)).toHaveAccessibleName("Hide drafts, 1 hidden");
});

test("An author can hide their own drafts too, and a link keeps it", async ({ page, github }) => {
	draft(github);
	await open(page, "/?repo=foo/bar&role=author&drafts=hide");

	await expect(row(page, "A")).toBeHidden();
});

test("A press says what it did, since the rows it shows or hides are away from the focus", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page);
	await unfold(page);

	await toggle(page).click();

	await expect(page.locator("#drafts [role=status]")).toHaveText("Drafts shown");
});

test("Show drafts from the keyboard leaves the focus on the toggle, not on the page, as its card goes", async ({
	page,
	github,
}) => {
	draft(github, "ABCDEF");
	await open(page);
	// From the keyboard, as Firefox takes no focus moved by script for :focus-visible
	await page.getByRole("button", { name: "Show filters" }).press("Enter");

	await page.getByRole("link", { name: "Show drafts" }).press("Enter");

	await expect(toggle(page)).toBeFocused();
});

test("Show drafts from the keyboard leaves the focus on the button that shows the filters while they are folded, as the toggle is out of reach", async ({
	page,
	github,
}) => {
	draft(github, "ABCDEF");
	await open(page);
	// From the keyboard, as Firefox takes no focus moved by script for :focus-visible
	await page.keyboard.press("Tab");

	await page.getByRole("link", { name: "Show drafts" }).press("Enter");

	await expect(page.getByRole("button", { name: "Show filters" })).toBeFocused();
});

test("A filter with a word that only starts like `is:draft` leaves the draft hidden and the toggle on screen", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page, "/?repo=foo/bar&filter=is:drafts");
	await unfold(page);

	await expect(row(page, "A")).toBeHidden();
	await expect(toggle(page)).toBeVisible();
});

test("A load says nothing about drafts, as no press asked", async ({ page, github }) => {
	draft(github);
	await open(page);

	await expect(page.locator("#drafts [role=status]")).toHaveText("");
});

test("The toggle names how many drafts hide only while they hide, and a press that hides them says the number", async ({
	page,
	github,
}) => {
	draft(github);
	await open(page);
	await unfold(page);

	await toggle(page).click();
	await expect(toggle(page)).toHaveAccessibleName("Hide drafts");
	await toggle(page).click();

	await expect(toggle(page)).toHaveAccessibleName("Hide drafts, 1 hidden");
	await expect(page.locator("#drafts [role=status]")).toHaveText("1 draft hidden");
});

test("An author whose PRs all hide as drafts stays in the Author list, so a reviewer learns why none show", async ({
	page,
	github,
}) => {
	draft(github);
	github.search = (search => answer => {
		search(answer);
		for (let pr of answer.data.search.nodes) {
			pr.author = { login: pr.id === "A" ? "qux" : "foo", avatarUrl: "" };
		}
	})(github.search);
	await open(page);
	await unfold(page);

	await page.getByRole("button", { name: "Author" }).click();

	await expect(
		page.locator("#authors").getByRole("img", { name: "1 hidden draft" }),
	).toBeVisible();
});
