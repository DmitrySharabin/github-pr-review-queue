import { test, expect, label, unfold } from "./github.js";

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

test("A failed reload of a view whose first load didn’t finish shows the form, not the time of another view", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();
	// The author view’s search answers, but its details never come
	github.details = () => new Promise(() => {});
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#counter")).toBeVisible();

	github.search = () => 502;
	await page.getByRole("searchbox", { name: "Filter", exact: true }).press("Enter");

	await expect(page.locator("#repo-form .notice")).toBeVisible();
});

test("Rows of another view don’t show the time of the view before while their details load", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await expect(page.locator("#updated time")).not.toBeEmpty();
	// The author view’s search answers, but its details never come
	github.details = () => new Promise(() => {});
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#counter")).toBeVisible();

	await expect(page.locator("#updated time")).toBeEmpty();
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

test("A refresh marks the PRs it finds that the last load didn’t, and the rows that changed", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		let { nodes } = answer.data.search;
		nodes[1].title = "A pull request retitled B";
		nodes.push({ ...nodes[0], id: "G", number: 71 });
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue tbody small:has(mark:not([hidden]))")).toHaveText([
		"#66 by ghost changed",
		"#71 by ghost new",
	]);
	await expect(page.locator("#summary .delta .up")).toHaveText("+1");
	await expect(page.locator("#updated .changes")).toContainText("1 new");
});

test("A step back to the view on screen before another view’s search answers still marks what changed", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Author" }).click();

	github.search = answer => {
		answer.data.search.nodes.pop();
	};
	await page.goBack();

	await expect(page.locator("#summary .delta .down")).toHaveText("−1");
});

test("A refresh that finds nothing new marks nothing, even after one that marked rows", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = answer => {
		let { nodes } = answer.data.search;
		nodes[1].title = "A pull request retitled B";
		nodes.push({ ...nodes[0], id: "G", number: 71 });
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("#updated .changes")).toHaveText("No changes");

	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveCount(0);
});

test("A refresh keeps showing the labels the user showed", async ({ page, github }) => {
	label(github, { A: [..."1234567"].map(n => `label ${n}`) });
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	await page.getByRole("button", { name: "+2 more labels" }).click();

	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.getByRole("link", { name: "Filter by label label 7" })).toBeVisible();
});

test("A click on a link in a marked row removes its mark, since the user has seen what changed", async ({
	page,
	context,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = answer => {
		let { nodes } = answer.data.search;
		nodes.push({ ...nodes[0], id: "G", number: 71, title: "A pull request titled G" });
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveText(["new"]);

	// The PR opens in a new tab
	await context.route("https://github.com/foo/**", route => route.fulfill({ body: "" }));
	await page.getByRole("link", { name: "A pull request titled G" }).click();

	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveCount(0);
});

test("A refresh whose details fail still marks the PRs its search found", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		let { nodes } = answer.data.search;
		nodes.push({ ...nodes[0], id: "G", number: 71 });
	};
	github.details = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	await expect(page.locator("#queue tbody small:has(mark:not([hidden]))")).toHaveText([
		"#71 by ghost new",
	]);
	await expect(page.locator("#summary .delta .up")).toHaveText("+1");
	// As a screen reader hears it, before the reason
	await expect(page.locator("#updated .changes")).toContainText("1 new");
});

test("A refresh after one whose details failed doesn’t mark the PRs that one showed as new again", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = answer => {
		let { nodes } = answer.data.search;
		nodes.push({ ...nodes[0], id: "G", number: 71 });
	};
	github.details = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	github.details = () => {};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeHidden();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveCount(0);
});

test("A refresh whose details fail shows the rows it rechecked as they were, not dimmed as if still loading", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	github.details = () => 502;
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();

	await expect(page.locator("#queue tr.stale")).toHaveCount(0);
});

test("A refresh marks a row whose other reviewer approved, though avatars are all that cell shows", async ({
	page,
	github,
}) => {
	let reviewer = { login: "user", avatarUrl: "https://github.com/user.png" };
	github.details = answer => {
		let pr = answer.data.nodes.find(node => node?.id === "A");
		if (pr) {
			pr.reviewRequests.nodes = [{ requestedReviewer: reviewer }];
		}
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	github.details = answer => {
		let pr = answer.data.nodes.find(node => node?.id === "A");
		if (pr) {
			pr.latestReviews.nodes = [
				{
					state: "APPROVED",
					url: "https://github.com/foo/bar/pull/65#review",
					author: reviewer,
				},
			];
		}
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue tbody small:has(mark:not([hidden]))")).toHaveText([
		"#65 by ghost changed",
	]);
});

test("A refresh keeps the sort of its own tab, though another tab saved a different one", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await page.getByRole("button", { name: "Iterations" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await page.evaluate(() =>
		localStorage.setItem(
			"review-queue:sort",
			JSON.stringify({ column: "diff", direction: "descending" }),
		));
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue th[aria-sort]")).toHaveText("Iterations");
});

test("A switch to the author and back keeps the reviewer sort of its own tab, though another tab saved a different one", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await page.getByRole("button", { name: "Iterations" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await page.evaluate(() =>
		localStorage.setItem(
			"review-queue:sort",
			JSON.stringify({ column: "diff", direction: "descending" }),
		));
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#queue th[aria-sort]")).toHaveText("Next step");
	await page.getByRole("link", { name: "Reviewer" }).click();
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue th[aria-sort]")).toHaveText("Iterations");
});

test("One label past the shown ones is offered in the singular", async ({ page, github }) => {
	label(github, { A: [..."123456"].map(n => `label ${n}`) });
	await page.goto("/?repo=foo/bar");

	await expect(page.getByRole("button", { name: "+1 more label", exact: true })).toBeVisible();
});

test("A label has its color from GitHub, and its description in the tooltip", async ({
	page,
	github,
}) => {
	label(github, {
		A: [{ name: "docs", color: "0075ca", description: "Improvements to the docs" }],
	});
	await page.goto("/?repo=foo/bar");

	let link = page.getByRole("link", { name: "Filter by label docs" });
	await expect(link).toHaveCSS("background-color", "rgb(0, 117, 202)");
	await expect(link).toHaveAttribute("title", "Improvements to the docs");
});

test("A label links to the queue with it in place of the filter’s other labels", async ({
	page,
	github,
}) => {
	label(github, { A: ["bug"] });
	await page.goto("/?repo=foo/bar&filter=label:docs -label:wip");

	await expect(page.getByRole("link", { name: "Filter by label bug" })).toHaveAttribute(
		"href",
		`?${new URLSearchParams({ repo: "foo/bar", filter: '-label:wip label:"bug"' })}`,
	);
});

test.describe("A failed refresh says why", () => {
	test.beforeEach(async ({ page, github }) => {
		await page.goto("/?repo=foo/bar");
		await expect(page.locator("progress")).toBeHidden();
	});

	test("A rate limit says to wait", async ({ page }) => {
		await page.route("https://api.github.com/graphql", route =>
			route.fulfill({
				status: 403,
				json: { message: "API rate limit exceeded for user ID 1" },
			}));
		await page.getByRole("button", { name: "Refresh" }).click();

		await expect(page.locator("#failure")).toContainText(
			"GitHub is getting too many requests from this page. Wait a few minutes, then try again.",
		);
	});

	test("A lost connection says the user is offline", async ({ page, context }) => {
		// The faked GitHub still answers offline, so its request fails as a dropped connection does
		await page.route("https://api.github.com/graphql", route =>
			route.abort("internetdisconnected"));
		await context.setOffline(true);
		await page.getByRole("button", { name: "Refresh" }).click();

		await expect(page.locator("#failure")).toContainText("You’re offline.");
	});

	test("A token GitHub no longer accepts says to sign in again", async ({ page, github }) => {
		github.search = () => 401;
		await page.getByRole("button", { name: "Refresh" }).click();

		await expect(page.locator("#failure")).toContainText("Your GitHub session has expired.");
	});
});

test("Refresh during a load waits for it, and doesn’t start another", async ({ page, github }) => {
	let searches = 0;
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => {
		searches++;
		return promise;
	};
	await page.goto("/?repo=foo/bar");
	await expect.poll(() => searches).toBe(1);

	// aria-disabled, so Playwright would wait for it to be enabled. A click still reaches it
	await page.getByRole("button", { name: "Refresh" }).click({ force: true });
	resolve();
	await expect(page.locator("progress")).toBeHidden();

	expect(searches).toBe(1);
});

test("A load with another filter marks nothing, as the PRs it finds aren’t new", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await unfold(page);
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.data.search.nodes.pop();
	};
	let field = page.getByRole("searchbox", { name: "Filter", exact: true });
	await field.fill("is:draft");
	await field.press("Enter");
	await expect(page.locator("#summary .count")).toHaveText("5");
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#summary .delta .down")).toHaveText("");
});
