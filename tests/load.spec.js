import {
	test,
	expect,
	changeUser,
	commit,
	detail,
	fillStorage,
	filter,
	filterBy,
	label,
	loaded,
	none,
	numbers,
	open,
	refresh,
	row,
	unfold,
} from "./github.js";

/** Count the GraphQL requests that the page stops, e.g. `await expect.poll(stopped).toBe(1)`. */
function stops (page) {
	let count = 0;
	page.on("requestfailed", request => {
		if (request.url() === "https://api.github.com/graphql") {
			count++;
		}
	});
	return () => count;
}

/** Answer for the PR at `index` as GitHub does once the PR is deleted, e.g. for B at 1. */
function deleted (answer, index) {
	let { id } = answer.data.nodes[index];
	answer.data.nodes[index] = null;
	answer.errors = [
		{
			type: "NOT_FOUND",
			path: ["nodes", index],
			message: `Could not resolve to a node with the global id of '${id}'.`,
		},
	];
}

test("A failed search hides the bars that stood in for its rows, even of the view shown last", async ({
	page,
	github,
}) => {
	// Failed details store no queue, so nothing stands in for the rows on a step back
	github.details = () => 500;
	await open(page);
	github.search = () => 500;
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	// Back to the reviewer view, the one last shown, which shows bars since nothing is on screen
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goBack();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve(500);

	await expect(page.locator("#queue")).toBeHidden();
});

test("A step back after a failed role switch shows the stored queue at once, as a visit does", async ({
	page,
	github,
}) => {
	await open(page);
	github.search = () => 500;
	await page.getByRole("link", { name: "Author" }).click();
	await expect(page.locator("#repo-form .notice")).toBeVisible();

	github.search = () => new Promise(() => {});
	await page.goBack();

	await expect(row(page, "A")).toBeVisible();
});

test("With a stored token, bars stand in for the rows while the sign-in runs, so nothing jumps in when they arrive", async ({
	page,
}) => {
	// Madata asks auth.madata.dev for its services before it signs in
	await page.route("https://auth.madata.dev/**", () => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
});

test.describe("Without a stored token", () => {
	test.use({ token: null });

	test("No bars flash before the sign-in card", async ({ page }) => {
		await page.route("https://auth.madata.dev/**", () => {});
		await page.goto("/?repo=foo/bar");

		await expect(page.locator("#queue")).toBeHidden();
	});

	test("A pasted token that GitHub rejects says so on the sign-in card", async ({
		page,
		github,
	}) => {
		github.user = () => 401;
		await page.goto("/?repo=foo/bar");
		await page.getByLabel("Fine-grained token").fill("github_pat_foo");
		await page.getByRole("button", { name: "Use token" }).click();

		await expect(page.locator("#sign-in .notice")).toContainText(
			"GitHub didn’t accept this token",
		);
	});

	test("A pasted token that GitHub accepts loads the queue", async ({ page }) => {
		await page.goto("/?repo=foo/bar");
		await page.getByLabel("Fine-grained token").fill("github_pat_foo");
		await page.getByRole("button", { name: "Use token" }).click();

		await expect(page.locator("#summary .user")).toHaveText("DmitrySharabin");
	});
});

test("A stored token that GitHub rejects, e.g. expired, shows the sign-in card", async ({
	page,
	github,
}) => {
	github.user = () => 401;
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#sign-in")).toBeVisible();
});

test("Someone else who signs in gets their own details, not those of the rows the last user saw", async ({
	page,
	github,
}) => {
	await open(page);
	// GitHub fails to say whose the token is, so the stored queue stays with a failure beside Refresh
	github.user = () => 500;
	await page.reload();
	await expect(page.locator("header")).toHaveClass(/failed/);
	// Then it rejects the token, so the sign-in card shows, and someone else signs in
	github.user = () => 401;
	await refresh(page);
	github.user = answer => {
		answer.login = "other-user";
	};
	detail(github, { A: { additions: 1 } });
	await page.getByLabel("Fine-grained token").fill("github_pat_foo");
	await page.getByRole("button", { name: "Use token" }).click();
	await expect(page.locator("#summary .user")).toHaveText("other-user");
	await loaded(page);

	await expect(row(page, "A").locator(".diff")).toContainText("+1 −2");
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

	await changeUser(page, "other-user");
	await expect(page.locator("#summary .user")).toHaveText("other-user");

	expect((await avatar.screenshot()).equals(face)).toBe(false);
});

test("Bars, not the last user’s rows, stand in for a new user’s queue while its search runs", async ({
	page,
	github,
}) => {
	await open(page);
	github.search = () => new Promise(() => {});

	await changeUser(page, "other-user");

	await expect(page.locator("#summary .user")).toHaveText("other-user");
	await expect(page.locator("#queue tbody tr:not(.skeleton)")).toHaveCount(0);
});

test("Another repo’s view shows bars at once, not the last repo’s rows under its name", async ({
	page,
	github,
}) => {
	await open(page);
	github.search = () => new Promise(() => {});

	await page.getByRole("button", { name: "Change repository" }).click();
	await page.getByRole("textbox", { name: "Repository" }).fill("foo/baz");
	await page.getByRole("textbox", { name: "Repository" }).press("Enter");

	await expect(page.locator("#queue tbody tr:not(.skeleton)")).toHaveCount(0);
});

test("The signed-in user’s own login, in any case, keeps the rows, as they are the same queue’s", async ({
	page,
	github,
}) => {
	await open(page);
	github.search = () => new Promise(() => {});

	await changeUser(page, "dmitrysharabin");

	await expect(page).toHaveURL(/user=dmitrysharabin/);
	await expect(page.locator("#queue tbody tr:not(.skeleton)")).toHaveCount(6);
});

test("A role switch shows bars at once, not the other role’s rows", async ({ page, github }) => {
	await open(page);
	github.search = () => new Promise(() => {});

	await page.getByRole("link", { name: "Author" }).click();

	await expect(page.locator("#queue tbody tr:not(.skeleton)")).toHaveCount(0);
});

test("A new filter keeps the rows on screen until its search ends, as they are the same queue’s", async ({
	page,
	github,
}) => {
	await open(page);
	github.search = () => new Promise(() => {});
	await unfold(page);

	await filterBy(page, "label:bug");

	await expect(page.locator("#queue tbody tr:not(.skeleton)")).toHaveCount(6);
});

test("Bars name the picked authors of their own view, not those of the view before", async ({
	page,
	github,
}) => {
	await open(page, "/?repo=foo/bar&authors=qux");
	github.search = () => new Promise(() => {});

	// A link to another view, e.g. typed or shared, opens in place
	await page.evaluate(() => navigation.navigate("?repo=foo/bar&user=other-user"));

	await expect(page.locator("#author-button .text")).toHaveText("Author");
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

	await expect(numbers(page).filter({ visible: true })).toHaveCount(6);
});

test("Details GitHub stops for running too long load in two halves, so a slow batch doesn’t fail the load", async ({
	page,
	github,
}) => {
	// The 6 PRs take one query, and GitHub times out on more than 3
	github.details = answer => (answer.data.nodes.length > 3 ? 502 : undefined);
	await open(page);

	await expect(page.locator("#queue td.diff a")).toHaveCount(6);
});

test("Details GitHub says may have timed out load in two halves too", async ({ page, github }) => {
	github.details = answer => {
		if (answer.data.nodes.length > 3) {
			answer.errors = [
				{
					message:
						"Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.",
				},
			];
		}
	};
	await open(page);

	await expect(page.locator("#queue td.diff a")).toHaveCount(6);
});

test("Details GitHub refuses, e.g. with a 403, aren’t asked for again in halves, which it would refuse too", async ({
	page,
	github,
}) => {
	let asked = 0;
	github.details = () => {
		asked++;
		return 403;
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#failure")).toContainText("Boom");

	expect(asked).toBe(1);
});

test("A role switch stops the requests of the load it leaves", async ({ page, github }) => {
	await open(page);

	let stopped = stops(page);
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await refresh(page);
	await page.getByRole("link", { name: "Author" }).click();

	await expect.poll(stopped).toBe(1);
	resolve();
});

test("A role switch stops the details requests of the load it leaves too", async ({
	page,
	github,
}) => {
	let stopped = stops(page);
	let { promise, resolve } = Promise.withResolvers();
	github.details = () => promise;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();
	await page.getByRole("link", { name: "Author" }).click();

	await expect.poll(stopped).toBe(1);
	resolve();
});

test("Sign out stops the load in flight, so it stores no queue after the queues are forgotten", async ({
	page,
	github,
}) => {
	let stopped = stops(page);
	let { promise, resolve } = Promise.withResolvers();
	github.details = () => promise;
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toBeVisible();
	// The reload after it waits, so it stops nothing itself
	await page.route("/?repo=foo/bar", () => {});
	await page.getByRole("button", { name: "Sign out" }).click({ noWaitAfter: true });

	await expect.poll(stopped).toBe(1);
	resolve();
});

test("Sign out forgets the stored queues, e.g. the titles of private repos", async ({ page }) => {
	await open(page);
	// The reload after it opens a blank page, so no sign-in card forgets them instead
	await page.route("/?repo=foo/bar", route =>
		route.fulfill({ contentType: "text/html", body: "" }));
	await page.getByRole("button", { name: "Sign out" }).click();

	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.keys(localStorage).filter(key => key.startsWith("review-queue:queue:"))))
		.toEqual([]);
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

test("A sign-in GitHub doesn’t answer in time says GitHub took too long, not loading forever", async ({
	page,
	github,
}) => {
	// Any time limit runs out soon after it starts, not at once, so the sign-in hears it while it waits
	await page.addInitScript(() => {
		AbortSignal.timeout = () => {
			let controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException("", "TimeoutError")), 300);
			return controller.signal;
		};
	});
	github.user = () => new Promise(() => {});
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

	await page.getByRole("button", { name: "Changes", exact: true }).click();
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	resolve();

	await expect(numbers(page)).toHaveText(["#70", "#69", "#68", "#67", "#66", "#65"]);
});

test("A sort chosen before the rows slide into place puts them in its order", async ({ page }) => {
	// The rows slide into place on a call, which a busy page makes a frame or more later
	await page.addInitScript(() => {
		document.startViewTransition = place => {
			window.place = place;
		};
		localStorage.setItem(
			"review-queue:sort",
			JSON.stringify({ column: "diff", direction: "descending" }),
		);
	});
	await page.goto("/?repo=foo/bar");
	await page.waitForFunction(() => window.place);

	await page.getByRole("button", { name: "Changes", exact: true }).click();
	await page.evaluate(() => window.place());

	await expect(numbers(page)).toHaveText(["#65", "#66", "#67", "#68", "#69", "#70"]);
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
		deleted(answer, 1);
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("#counter")).toContainText("10 of 11");
	resolve();

	// The update time shows once a load ends
	await expect(page.locator("#updated time")).not.toBeEmpty();
	await expect(page.locator("#queue td.diff a")).toHaveCount(10);
});

test("A PR stored without details, after GitHub said it was deleted, asks for them again on the next visit", async ({
	page,
	github,
}) => {
	github.details = answer => deleted(answer, 1);
	await open(page);

	let asked = [];
	github.details = answer => {
		asked.push(...answer.data.nodes.map(pr => pr.id));
	};
	await page.reload();
	await loaded(page);

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
	let failed = Promise.withResolvers();
	let held = Promise.withResolvers();
	let asked = 0;
	// A and B each have one of the author’s commits since the review, whose comparison fails, so their sizes are the count. A has N, which GitHub fails twice, and B has O
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
			pr.commits.nodes = [commit("L"), commit(pr.id === "A" ? "N" : "O")];
			pr.reviews.nodes = [
				{
					submittedAt: "2026-11-01T12:00:00Z",
					author: { login: "DmitrySharabin" },
					commit: { oid: "L" },
				},
			];
		}
	};
	github.compare = () => 500;
	await page.goto("/?repo=foo/bar");
	await failed.promise;
	held.resolve();

	await expect(
		page.locator("#queue tbody tr").filter({ hasText: "#66" }).locator(".since-review"),
	).toContainText("+790");
	await expect(page.getByText("Couldn’t refresh")).toBeVisible();
	await expect(page.locator("#counter")).toBeHidden();
});

test("A click on a label keeps the rows that have it while the search runs", async ({
	page,
	github,
}) => {
	label(github, { A: ["bug"], C: ["bug"] });
	await open(page);

	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Filter by label bug" }).first().click();

	await expect(numbers(page)).toHaveText(["#65", "#67"]);
});

test("A click on a label in a queue of 100 PRs, the most a search finds, keeps every row until the search ends", async ({
	page,
	github,
}) => {
	github.search = answer => {
		let { nodes } = answer.data.search;
		for (let i = nodes.length; i < 100; i++) {
			nodes.push({ ...nodes[1], id: `P${i}`, number: 100 + i });
		}
	};
	label(github, { A: ["bug"] });
	await open(page);

	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Filter by label bug" }).click();
	await expect(page.locator("#refresh")).toHaveAttribute("aria-disabled", "true");

	await expect(page.locator("#queue tbody tr")).toHaveCount(100);
});

test.describe("A filter that repeats the view’s qualifiers", () => {
	/** The view the page’s URL asks for, e.g. `{ user: "foo", filter: null }` */
	function view (page) {
		let params = new URL(page.url()).searchParams;
		return { user: params.get("user"), filter: params.get("filter") };
	}

	// Each case opens a view and applies a filter in it, and names the view that the URL then asks for
	let cases = [
		{
			// The search would join the two authors with an OR, while the summary names one of them
			title: "Another author in the author view’s filter opens their queue, as on GitHub’s pulls page",
			url: "/?repo=foo/bar&role=author",
			terms: "author:other-user label:bug",
			opens: { user: "other-user", filter: "label:bug" },
		},
		{
			title: "Another reviewer in the reviewer view’s filter opens their queue",
			url: "/?repo=foo/bar",
			terms: "review-requested:other-user",
			opens: { user: "other-user", filter: null },
		},
		{
			title: "Of two authors in the filter, the last one wins, as on GitHub’s pulls page",
			url: "/?repo=foo/bar&role=author",
			terms: "author:third-user author:other-user",
			opens: { user: "other-user", filter: null },
		},
		{
			title: "`author:@me` opens the signed-in user’s queue",
			url: "/?repo=foo/bar&user=other-user&role=author",
			terms: "author:@me",
			opens: { user: null, filter: null },
		},
		{
			// A negated author narrows the search, so it is a filter of its own
			title: "A negated author in the author view stays in the filter",
			url: "/?repo=foo/bar&role=author",
			terms: "-author:other-user",
			opens: { user: null, filter: "-author:other-user" },
		},
		{
			title: "A negated author in the reviewer view stays in the filter, as the Author button can’t exclude",
			url: "/?repo=foo/bar",
			terms: "-author:other-user",
			opens: { user: null, filter: "-author:other-user" },
		},
	];

	for (let { title, url, terms, opens } of cases) {
		test(title, async ({ page }) => {
			await page.goto(url);
			await unfold(page);

			await filterBy(page, terms);

			await expect.poll(() => view(page)).toEqual(opens);
		});
	}

	// Two places would pick authors apart, e.g. `author:foo` with `foo` unpicked in the list, and show nothing
	test("Authors in the reviewer view’s filter become the Author button’s picks, in place of the ones before", async ({
		page,
	}) => {
		await page.goto("/?repo=foo/bar&authors=qux");
		await unfold(page);

		await filterBy(page, "author:other-user author:app/foo label:bar");

		await expect
			.poll(() => Object.fromEntries(new URL(page.url()).searchParams))
			.toEqual({ repo: "foo/bar", filter: "label:bar", authors: "other-user,foo" });
	});

	test("A link to the view with other repos in the filter searches only its own repo", async ({
		page,
		github,
	}) => {
		await page.goto(
			`/?repo=foo/bar&filter=${encodeURIComponent("repo:foo/baz org:baz user:baz label:bug")}`,
		);
		await loaded(page);

		expect(view(page)).toEqual({ user: null, filter: "label:bug" });
		expect(github.queries.some(query => query.includes("baz"))).toBe(false);
	});

	test("A link to the view with closed PRs or issues in the filter keeps to open PRs, drafts and all", async ({
		page,
	}) => {
		await page.goto(
			`/?repo=foo/bar&filter=${encodeURIComponent("is:closed is:issue is:draft")}`,
		);

		expect(view(page)).toEqual({ user: null, filter: "is:draft" });
	});

	test("A link that the page rewrites keeps its fragment", async ({ page }) => {
		await page.goto(`/?repo=foo/bar&filter=${encodeURIComponent("repo:foo/baz")}#queue`);

		expect(new URL(page.url()).hash).toBe("#queue");
	});

	test("The switch to the author view opens the queue of the author that the filter names", async ({
		page,
	}) => {
		await page.goto(`/?repo=foo/bar&filter=${encodeURIComponent("author:other-user")}`);

		await page.getByRole("link", { name: "Author", exact: true }).click();

		await expect.poll(() => view(page)).toEqual({ user: "other-user", filter: null });
	});
});

test("A queue stored for another user marks nothing new for the one signed in now", async ({
	page,
}) => {
	await open(page);
	// As if whoever was signed in before saw three PRs fewer
	await page.evaluate(() => {
		let key = Object.keys(localStorage).find(key => key.startsWith("review-queue:queue:"));
		let queue = JSON.parse(localStorage.getItem(key));
		queue.user = "other-user";
		queue.rows = queue.rows.slice(0, 3);
		localStorage.setItem(key, JSON.stringify(queue));
	});

	await page.reload();
	await expect(page.locator("#summary .count")).toHaveText("6");
	await loaded(page);

	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveCount(0);
});

test("A full storage drops the queue stored longest ago, and keeps the newer ones", async ({
	page,
}) => {
	for (let repo of ["foo/bar", "foo/baz"]) {
		await open(page, `/?repo=${repo}`);
	}
	// Other data fills the rest, so the next queue fits only once another goes
	await fillStorage(page);

	await open(page, "/?repo=foo/qux");
	await page.goto("/");
	await page.getByRole("combobox", { name: "Repository" }).press("ArrowDown");

	await expect(page.getByRole("option")).toHaveText(["foo/qux", "foo/baz"]);
});

test("A full storage still sorts the rows, and only the next visit forgets the sort", async ({
	page,
}) => {
	await open(page);
	// Other data fills the rest, so the chosen sort doesn’t fit
	await fillStorage(page);

	await page.getByRole("button", { name: "Changes", exact: true }).click();

	await expect(numbers(page)).toHaveText(["#70", "#69", "#68", "#67", "#66", "#65"]);
});

test("A queue stored by another version, e.g. with a step this one doesn’t know, loads anew", async ({
	page,
}) => {
	await open(page, "/?repo=foo/bar&role=author");
	await page.evaluate(() => {
		let key = Object.keys(localStorage).find(key => key.startsWith("review-queue:queue:"));
		let queue = JSON.parse(localStorage.getItem(key));
		queue.rows[0].summary.step.name = "some-future-step";
		localStorage.setItem(key, JSON.stringify(queue));
	});

	await page.reload();

	await expect(page.locator("#summary .count")).toHaveText("6");
});

test("A queue stored by the version before is neither shown nor kept", async ({ page, github }) => {
	await page.goto("/");
	await page.evaluate(() =>
		localStorage.setItem(
			"review-queue:queue:repo=foo%2Fbar",
			JSON.stringify({
				user: "DmitrySharabin",
				at: new Date().toISOString(),
				rows: [
					{
						pr: { id: "A", labels: { nodes: [] } },
						summary: {
							number: 65,
							title: "A pull request titled A",
							url: "",
							author: "ghost",
							avatar: "",
							labels: [],
						},
					},
				],
			}),
		));
	github.search = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain(
		"review-queue:queue:repo=foo%2Fbar",
	);
});

test("A refreshed row of a PR deleted before its details shows as it was, not dimmed as if still loading", async ({
	page,
	github,
}) => {
	await open(page);

	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	github.details = answer => deleted(answer, 0);
	await refresh(page);
	await loaded(page);

	await expect(page.locator("#queue tr.stale")).toHaveCount(0);
});

test("A queue of one PR counts it in the singular while its details load", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes.splice(1);
	};
	github.details = () => new Promise(() => {});
	await page.goto("/?repo=foo/bar");

	await expect(page.locator("#counter")).toHaveText("0 of 1 pull request loaded");
});

test("An empty queue of the signed-in user speaks to them as “you”", async ({ page, github }) => {
	github.search = none;
	await page.goto("/?repo=foo/bar&user=dmitrysharabin");

	await expect(page.locator("#empty p")).toHaveText(
		"No pull requests in foo/bar are waiting for your review.",
	);
});

test("An empty queue of another user names them", async ({ page, github }) => {
	github.search = none;
	await page.goto("/?repo=foo/bar&role=author&user=other-user");

	await expect(page.locator("#empty p")).toHaveText(
		"other-user has no open pull requests in foo/bar.",
	);
});

test("A repo that isn’t `owner/name` asks for a repo, as no repo does", async ({ page }) => {
	let form = page.locator("#repo-form");
	await page.goto("/");
	await expect(form).toBeVisible();
	let top = await form.evaluate(form => form.getBoundingClientRect().top);

	await page.goto("/?repo=foo/bar/issues");

	// In the same place, with no room kept for the controls
	await expect.poll(() => form.evaluate(form => form.getBoundingClientRect().top)).toBe(top);
});

test("A click on the app’s name opens the start page, with nothing in the URL, on a phone too", async ({
	page,
}) => {
	// The controls span the title’s cell there
	await page.setViewportSize({ width: 375, height: 812 });
	await open(page, "/?repo=foo/bar&filter=label:bug");

	await page.getByRole("link", { name: "GitHub PR review queue" }).click();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator("#repo-form")).toBeVisible();
});

test("A user that isn’t a login shows the signed-in user’s queue, as no user does", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar&user=foo/baz");

	await expect(page.locator("#summary .user")).toHaveText("DmitrySharabin");
});

test.describe("After a first load that failed, the form is all there is to act on", () => {
	test.beforeEach(async ({ page, github }) => {
		github.search = () => 500;
		await page.goto("/?repo=foo/bar");
		await expect(page.locator("#repo-form .notice")).toBeVisible();
	});

	test("Refresh hides, as Show queue tries again", async ({ page }) => {
		await expect(page.getByRole("button", { name: "Refresh" })).toBeHidden();
	});

	test("The update time, which has no time to say, is hidden from a screen reader too", async ({
		page,
	}) => {
		await expect(page.locator("#updated")).toHaveCSS("visibility", "hidden");
	});

	test("The update time takes no room beside Sign out", async ({ page }) => {
		let { width } = await page.locator("#updated").boundingBox();

		expect(width).toBeLessThanOrEqual(1);
	});

	test("The form sits in the middle of the page, as the page that asks for a repo", async ({
		page,
	}) => {
		let [form, main] = await Promise.all(
			["#repo-form", "main"].map(selector => page.locator(selector).boundingBox()),
		);

		expect(form.x + form.width / 2).toBeCloseTo(main.x + main.width / 2, 0);
	});
});

test("The update time fades in when a load ends, so a refresh in the same minute shows that it finished", async ({
	page,
}) => {
	await open(page);

	await expect(page.locator("#updated time")).toHaveCSS("animation-name", "appear");
});
