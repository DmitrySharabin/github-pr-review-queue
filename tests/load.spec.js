import { test, expect } from "./github.js";

test("A failed search hides the bars that stood in for its rows, even of the view shown last", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
	github.search = () => 500;
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	// Back to the reviewer view, still the one last shown, which shows bars since nothing is on screen
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goBack();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve(500);

	await expect(page.locator("#queue")).toBeHidden();
});

test("With a stored token, bars stand in for the rows while the sign-in runs, so nothing jumps in when they arrive", async ({
	page,
	github,
}) => {
	// Madata asks auth.madata.dev for its services before it signs in
	await page.route("https://auth.madata.dev/**", () => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
});

// Without the `github` fixture, no token is stored
test("Without a stored token, no bars flash before the sign-in card", async ({ page }) => {
	await page.route("https://auth.madata.dev/**", () => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#queue")).toBeHidden();
});

test("Bars that stood in for the user during the sign-in give way to the user once it ends", async ({
	page,
	github,
}) => {
	github.search = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#summary .user")).toHaveText("DmitrySharabin");
});

test("A new user’s avatar shows a disc, not the last user’s face, while it loads", async ({
	page,
	github,
}) => {
	// The new user’s avatar never arrives
	await page.route("https://github.com/other-user.png*", () => {});
	await page.goto("/?repo=foo/bar");
	let avatar = page.locator("#summary .user img");
	await expect.poll(() => avatar.evaluate(img => img.naturalWidth)).toBe(48);
	let face = await avatar.screenshot();

	await page.getByRole("button", { name: "Change user" }).click();
	await page.getByRole("textbox", { name: "User" }).fill("other-user");
	await page.getByRole("textbox", { name: "User" }).press("Enter");
	await expect(page.locator("#summary .user")).toHaveText("other-user");

	expect((await avatar.screenshot()).equals(face)).toBe(false);
});

test("A role switch hides the counter of the load it stops", async ({ page, github }) => {
	github.details = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();

	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Author" }).click();

	await expect(page.locator("#counter")).toBeHidden();
});

test("On a phone, the counter shows below the title, not over it", async ({ page, github }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	github.details = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();

	let title = await page.locator("h1").boundingBox();
	let counter = await page.locator("#counter").boundingBox();

	expect(counter.y).toBeGreaterThanOrEqual(title.y + title.height);
});

test("Failed details keep the rows the search found on screen", async ({ page, github }) => {
	github.details = () => 500;
	await page.goto("/?repo=foo/bar");
	// GitHub’s own words, as the fake fails
	await expect(page.locator("#failure")).toContainText("Boom");

	await expect(page.locator("#queue tbody .number").filter({ visible: true })).toHaveCount(6);
});

test("Details GitHub stops for running too long load in two halves, so a slow batch doesn’t fail the load", async ({
	page,
	github,
}) => {
	// The 6 PRs take one query, and GitHub times out on more than 3
	github.details = answer => (answer.data.nodes.length > 3 ? 502 : undefined);
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue td.diff .added")).toHaveCount(6);
});

test("A role switch stops the requests of the load it leaves", async ({ page, github }) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let stopped = 0;
	page.on("requestfailed", request => {
		if (request.url() === "https://api.github.com/graphql") {
			stopped++;
		}
	});
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.getByRole("button", { name: "Refresh" }).click();
	await page.getByRole("link", { name: "Author" }).click();

	await expect.poll(() => stopped).toBe(1);
	resolve();
});

test("A role switch stops the details requests of the load it leaves too", async ({
	page,
	github,
}) => {
	let stopped = 0;
	page.on("requestfailed", request => {
		if (request.url() === "https://api.github.com/graphql") {
			stopped++;
		}
	});
	let { promise, resolve } = Promise.withResolvers();
	github.details = () => promise;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();
	await page.getByRole("link", { name: "Author" }).click();

	await expect.poll(() => stopped).toBe(1);
	resolve();
});

test("A request GitHub doesn’t answer in time stops, and says GitHub took too long", async ({
	page,
	github,
}) => {
	// Any time limit runs out at once
	await page.addInitScript(() => {
		AbortSignal.timeout = () => AbortSignal.abort(new DOMException("", "TimeoutError"));
	});
	github.search = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#repo-form .notice")).toContainText("GitHub took too long");
});

test("A sort chosen while the bars show keeps them, and sorts the rows that replace them", async ({
	page,
	github,
}) => {
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();

	await page.getByRole("button", { name: "All changes" }).click();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve();

	await expect(page.locator("#queue tbody .number")).toHaveText([
		"#70",
		"#69",
		"#68",
		"#67",
		"#66",
		"#65",
	]);
});

test("A PR deleted between the search and its details counts as loaded, and leaves the others to load", async ({
	page,
	github,
}) => {
	// 11 PRs ask for details in two batches, of 10 and 1
	github.search = answer => {
		let [pr] = answer.data.search.nodes;
		answer.data.search.nodes.push(
			...[..."GHIJK"].map(id => ({ ...pr, id, number: id.charCodeAt(0) })),
		);
	};
	let { promise, resolve } = Promise.withResolvers();
	github.details = answer => {
		if (answer.data.nodes.length === 1) {
			return promise;
		}

		// As GitHub answers for B
		answer.data.nodes[1] = null;
		answer.errors = [
			{
				type: "NOT_FOUND",
				path: ["nodes", 1],
				message: "Could not resolve to a node with the global id of 'B'.",
			},
		];
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toContainText("10 of 11");
	resolve();

	// The update time shows once a load ends
	await expect(page.locator("#updated time")).not.toBeEmpty();
	await expect(page.locator("#queue td.diff .added")).toHaveCount(10);
});

test("A PR stored without details, after GitHub said it was deleted, asks for them again on the next visit", async ({
	page,
	github,
}) => {
	github.details = answer => {
		answer.data.nodes[1] = null;
		answer.errors = [
			{
				type: "NOT_FOUND",
				path: ["nodes", 1],
				message: "Could not resolve to a node with the global id of 'B'.",
			},
		];
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	let asked = [];
	github.details = answer => {
		asked.push(...answer.data.nodes.map(pr => pr.id));
	};
	await page.reload();
	await expect(page.locator("progress")).toBeHidden();

	expect(asked).toEqual(["B"]);
});

test("A repository GitHub can’t find still fails the load", async ({ page, github }) => {
	github.search = answer => {
		answer.data.repository = null;
		answer.errors = [
			{
				type: "NOT_FOUND",
				path: ["repository"],
				message: "Could not resolve to a Repository with the name 'foo/bar'.",
			},
		];
	};
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#repo-form .notice")).toContainText(
		"GitHub can’t find this repository",
	);
});

test("A PR whose commit sizes fail ends the load only once the other PRs are counted, so no row fills in after it", async ({
	page,
	github,
}) => {
	let commit = (id, parents = 1) => ({
		commit: { id, oid: id, parents: { totalCount: parents } },
	});
	let failed = Promise.withResolvers();
	let held = Promise.withResolvers();
	let asked = 0;
	// A and B each have one of the author’s commits since the review, after a merge, so their sizes are the count: N for A, which GitHub fails twice, and O for B
	github.details = answer => {
		let [node] = answer.data.nodes;
		if (node.id === "N") {
			if (++asked === 2) {
				failed.resolve();
			}
			return 502;
		}
		if (node.id === "O") {
			return held.promise;
		}

		for (let pr of answer.data.nodes.filter(pr => pr.id === "A" || pr.id === "B")) {
			pr.commits.nodes = [commit("L"), commit("M", 2), commit(pr.id === "A" ? "N" : "O")];
			pr.reviews.nodes = [
				{
					submittedAt: "2026-11-01T12:00:00Z",
					author: { login: "DmitrySharabin" },
					commit: { oid: "L" },
				},
			];
		}
	};
	await page.goto("/?repo=foo/bar");
	await failed.promise;
	held.resolve();

	await expect(
		page.locator("#queue tbody tr").filter({ hasText: "#66" }).locator(".since-review"),
	).toContainText("+790");
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();
	await expect(page.locator("#counter")).toBeHidden();
});
