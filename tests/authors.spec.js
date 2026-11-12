import { test, expect, row } from "./github.js";

/** Who wrote PRs A–F, and how each relates to the repo, as GitHub’s `authorAssociation` */
const authors = {
	A: ["foo", "OWNER"],
	B: ["other-user", "MEMBER"],
	C: ["third-user", "COLLABORATOR"],
	D: ["qux", "CONTRIBUTOR"],
	E: ["qux", "CONTRIBUTOR"],
	F: ["quux", "FIRST_TIME_CONTRIBUTOR"],
};

/** Give the PRs their {@link authors}, or other ones, e.g. `{ F: ["newcomer", "CONTRIBUTOR"] }`. */
function authored (github, changes = {}) {
	github.search = answer => {
		for (let pr of answer.data.search.nodes) {
			let [login, association] = { ...authors, ...changes }[pr.id];
			pr.author = { login, avatarUrl: `https://github.com/${login}.png` };
			pr.authorAssociation = association;
		}
	};
}

/** The checkbox of an author in the open list. */
function pick (page, login) {
	return page.locator("#authors").getByRole("checkbox", { name: login });
}

test("Picked authors show only their PRs, without a new search", async ({ page, github }) => {
	authored(github);
	let searches = 0;
	let answer = github.search;
	github.search = found => {
		searches++;
		answer(found);
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await pick(page, "qux").check();
	await page.getByRole("button", { name: "Show 2 PRs" }).click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(2);
	expect(searches).toBe(1);
});

test("“All collaborators” keeps the PRs of owners, members and collaborators, and the new ones of each later", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await page.getByRole("checkbox", { name: "All collaborators" }).check();
	await page.getByRole("button", { name: "Show 3 PRs" }).click();

	await expect(page).toHaveURL(/authors=%40collaborators$/);
	await expect(page.locator("#queue tbody tr")).toHaveCount(3);
	for (let id of "ABC") {
		await expect(row(page, id)).toBeVisible();
	}
});

test("Esc drops the authors checked since the list opened", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await pick(page, "qux").check();
	await page.keyboard.press("Escape");

	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
	await expect(page).not.toHaveURL(/authors/);
});

test("A click outside the list shows the authors checked in it", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await pick(page, "quux").check();
	await page.locator("h1").click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(1);
});

test("Esc that only clears the search field leaves the picks to show on a click outside", async ({
	page,
	github,
	browserName,
}) => {
	test.skip(browserName === "webkit", "WebKit closes the list on that Esc");
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	let field = page.getByRole("searchbox", { name: "Filter authors" });
	await field.fill("quux");
	await pick(page, "quux").check();
	await field.press("Escape");
	await page.locator("h1").click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(1);
});

test("Enter in the list with no change closes it without a new search", async ({
	page,
	github,
}) => {
	authored(github);
	let searches = 0;
	let answer = github.search;
	github.search = found => {
		searches++;
		answer(found);
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await page.getByRole("searchbox", { name: "Filter authors" }).press("Enter");
	await expect(page.locator("#authors")).toBeHidden();
	// A search would start at once
	await page.waitForTimeout(500);

	expect(searches).toBe(1);
});

test("Every collaborator picked by name stays those people, not every later collaborator", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	for (let login of ["foo", "other-user", "third-user"]) {
		await pick(page, login).check();
	}
	await page.getByRole("button", { name: "Show 3 PRs" }).click();

	await expect(page).toHaveURL(/authors=foo%2Cother-user%2Cthird-user$/);
});

test("A list open while a refresh ends lists the refresh’s authors once opened again", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let { promise, resolve } = Promise.withResolvers();
	authored(github, { F: ["newcomer", "CONTRIBUTOR"] });
	let answer = github.search;
	github.search = async found => {
		await promise;
		answer(found);
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await page.getByRole("button", { name: "Author" }).click();
	resolve();
	await expect(page.locator("progress")).toBeHidden();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Author" }).click();

	await expect(pick(page, "newcomer")).toBeVisible();
});

test("A list of outside contributors only has no group headings, as there is nothing to tell apart", async ({
	page,
	github,
}) => {
	authored(github, {
		A: ["foo", "CONTRIBUTOR"],
		B: ["other-user", "CONTRIBUTOR"],
		C: ["third-user", "NONE"],
	});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();

	await expect(page.locator("#authors legend:visible")).toHaveCount(0);
});

test("A queue without collaborators keeps “All collaborators” in the list, grayed out, and says why", async ({
	page,
	github,
}) => {
	authored(github, {
		A: ["foo", "CONTRIBUTOR"],
		B: ["other-user", "CONTRIBUTOR"],
		C: ["third-user", "NONE"],
	});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();

	let all = page.getByRole("checkbox", { name: /All collaborators/ });
	await expect(all).toBeDisabled();
	await expect(page.locator("#authors .all")).toContainText("None in this queue");
});

test("A list of collaborators and others names both groups", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();

	await expect(page.locator("#authors legend:visible")).toHaveText([
		"Collaborators",
		"Other authors",
	]);
});

test("The button keeps its avatars when the list closes unchanged, so they don’t flash while they load again", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();
	let face = await page.locator("#author-button img").elementHandle();

	await page.getByRole("button", { name: "Author: qux" }).click();
	await page.keyboard.press("Escape");
	await expect(page.locator("#authors")).toBeHidden();

	expect(await face.evaluate(img => img.isConnected)).toBe(true);
});

test("The count says how many PRs of all the search found are by the picked authors", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=qux");

	await expect(page.locator("#summary .count")).toHaveText("2 of 6");
});

test("The button names the one picked author", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=quux");

	await expect(page.getByRole("button", { name: "Author: quux" })).toBeVisible();
});

test("Typing in the list narrows it to the logins that have what is typed", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author" }).click();
	await page.getByRole("searchbox", { name: "Filter authors" }).fill("qu");

	await expect(page.locator("#authors fieldset label:visible")).toHaveText([/qux/, /quux/]);
});

test("Picked authors with no PRs left, e.g. all merged, are named in the card, which clears them in one click", async ({
	page,
	github,
}) => {
	// No PR has an author with a role in the repo
	await page.goto("/?repo=foo/bar&authors=nobody,@collaborators");
	await expect(page.locator("#empty p")).toContainText("by nobody or the repo’s collaborators");
	await page.getByRole("link", { name: "Clear authors" }).click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
});

test("A new filter keeps the picked authors", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=qux");
	await page.locator("#narrow summary").click();
	await page.getByRole("searchbox", { name: "Filter" }).fill("label:baz");
	await page.getByRole("button", { name: "Apply" }).click();

	await expect(page).toHaveURL(/authors=qux/);
});

test("The same filter applied again loads the queue again, as only other authors show the rows on screen", async ({
	page,
	github,
}) => {
	authored(github);
	let searches = 0;
	let answer = github.search;
	github.search = found => {
		searches++;
		answer(found);
	};
	await page.goto("/?repo=foo/bar&filter=label:baz");
	await expect(page.locator("progress")).toBeHidden();

	await page.locator("#narrow summary").click();
	await page.getByRole("button", { name: "Apply" }).click();

	await expect.poll(() => searches).toBe(2);
});

test("Rows that tie in the new sort column keep the order of the last one", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=@collaborators,qux");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Changes", exact: true }).click();
	// No PR has iterations, so all tie
	await page.getByRole("button", { name: "Iterations" }).click();

	await expect(page.locator("#queue tbody tr")).toHaveText([/#69/, /#68/, /#67/, /#66/, /#65/]);
});

test("The author view has no list of authors, since its PRs are all the user’s", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar&role=author&authors=qux");
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#author-button")).toBeHidden();
	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
});

test("The form after a failed load keeps the picked authors", async ({ page, github }) => {
	github.search = () => 500;
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("#repo-form .notice")).toBeVisible();
	await page.getByRole("button", { name: "Show queue" }).click();

	await expect(page).toHaveURL(/authors=qux/);
});

test("Unchecking the only picked author shows every PR", async ({ page, github }) => {
	authored(github);
	await page.goto("/?repo=foo/bar&authors=qux");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Author: qux" }).click();
	await pick(page, "qux").uncheck();
	await page.getByRole("button", { name: "Show 6 PRs" }).click();

	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
});

test("A step back to other authors after a failed load loads the queue, as none is on screen", async ({
	page,
	github,
}) => {
	authored(github);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "Author" }).click();
	await pick(page, "qux").check();
	await page.getByRole("button", { name: "Show 2 PRs" }).click();
	await expect(page).toHaveURL(/authors=qux/);

	// Nothing stored shows either
	await page.evaluate(() => localStorage.clear());
	let answer = github.search;
	github.search = () => 500;
	await page.reload();
	await expect(page.locator("#repo-form .notice")).toBeVisible();
	github.search = answer;
	await page.goBack();

	await expect(page.locator("#queue tbody tr")).toHaveCount(6);
});
