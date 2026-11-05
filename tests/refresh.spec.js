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
	github.search = answer => {
		answer.data.search.nodes[0].labels.nodes = [..."1234567"].map(n => ({
			name: `label ${n}`,
			color: "d73a4a",
			description: null,
		}));
	};
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
