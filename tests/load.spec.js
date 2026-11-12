import { test, expect, commit, detail } from "./github.js";

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

test.describe("Without a stored token", () => {
	test.use({ token: null });

	test("No bars flash before the sign-in card", async ({ page, github }) => {
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

	test("A pasted token that GitHub accepts loads the queue", async ({ page, github }) => {
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

	await expect(page.locator("#queue td.diff a")).toHaveCount(6);
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

	await expect(page.locator("#queue tbody .number")).toHaveText([
		"#70",
		"#69",
		"#68",
		"#67",
		"#66",
		"#65",
	]);
});

test("A sort chosen before the rows slide into place puts them in its order", async ({
	page,
	github,
}) => {
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

	await expect(page.locator("#queue tbody .number")).toHaveText([
		"#65",
		"#66",
		"#67",
		"#68",
		"#69",
		"#70",
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
	await expect(page.locator("#queue td.diff a")).toHaveCount(10);
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
	github.search = answer => {
		for (let pr of answer.data.search.nodes) {
			if (["A", "C"].includes(pr.id)) {
				pr.labels.nodes = [{ name: "bug", color: "d73a4a", description: null }];
			}
		}
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = () => new Promise(() => {});
	await page.getByRole("link", { name: "Filter by label bug" }).first().click();

	await expect(page.locator("#queue tbody .number")).toHaveText(["#65", "#67"]);
});

test.describe("A filter that repeats the view’s qualifiers", () => {
	/** Apply `filter` in the open view, as the user types it */
	async function apply (page, filter) {
		await page.locator("#narrow summary").click();
		await page.getByRole("searchbox", { name: "Filter" }).fill(filter);
		await page.locator("#narrow").getByRole("button", { name: "Apply" }).click();
	}

	/** The view the page’s URL asks for, e.g. `{ user: "foo", filter: null }` */
	function view (page) {
		let params = new URL(page.url()).searchParams;
		return { user: params.get("user"), filter: params.get("filter") };
	}

	// The search would join the two authors with an OR, while the summary names one of them
	test("Another author in the author view’s filter opens their queue, as on GitHub’s pulls page", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&role=author");

		await apply(page, "author:other-user label:bug");

		await expect.poll(() => view(page)).toEqual({ user: "other-user", filter: "label:bug" });
	});

	test("Another reviewer in the reviewer view’s filter opens their queue", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar");

		await apply(page, "review-requested:other-user");

		await expect.poll(() => view(page)).toEqual({ user: "other-user", filter: null });
	});

	test("Of two authors in the filter, the last one wins, as on GitHub’s pulls page", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&role=author");

		await apply(page, "author:third-user author:other-user");

		await expect.poll(() => view(page)).toEqual({ user: "other-user", filter: null });
	});

	test("`author:@me` opens the signed-in user’s queue", async ({ page, github }) => {
		await page.goto("/?repo=foo/bar&user=other-user&role=author");

		await apply(page, "author:@me");

		await expect.poll(() => view(page)).toEqual({ user: null, filter: null });
	});

	// A negated author narrows the search, so it is a filter of its own
	test("A negated author in the author view stays in the filter", async ({ page, github }) => {
		await page.goto("/?repo=foo/bar&role=author");

		await apply(page, "-author:other-user");

		await expect.poll(() => view(page)).toEqual({ user: null, filter: "-author:other-user" });
	});

	// Two places would pick authors apart, e.g. `author:foo` with `foo` unpicked in the list, and show nothing
	test("Authors in the reviewer view’s filter become the Author button’s picks, in place of the ones before", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&authors=qux");

		await apply(page, "author:other-user author:app/foo label:bar");

		await expect
			.poll(() => Object.fromEntries(new URL(page.url()).searchParams))
			.toEqual({ repo: "foo/bar", filter: "label:bar", authors: "other-user,foo" });
	});

	test("A negated author in the reviewer view stays in the filter, as the Author button can’t exclude", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar");

		await apply(page, "-author:other-user");

		await expect.poll(() => view(page)).toEqual({ user: null, filter: "-author:other-user" });
	});

	test("A link to the view with other repos in the filter searches only its own repo", async ({
		page,
		github,
	}) => {
		let queries = [];
		page.on("request", request => {
			if (request.url().endsWith("/graphql")) {
				queries.push(request.postData());
			}
		});

		await page.goto(
			`/?repo=foo/bar&filter=${encodeURIComponent("repo:foo/baz org:baz user:baz label:bug")}`,
		);
		await expect(page.locator("progress")).toBeHidden();

		expect(view(page)).toEqual({ user: null, filter: "label:bug" });
		expect(queries.some(query => query.includes("baz"))).toBe(false);
	});

	test("A link to the view with closed PRs or issues in the filter keeps to open PRs, drafts and all", async ({
		page,
		github,
	}) => {
		await page.goto(
			`/?repo=foo/bar&filter=${encodeURIComponent("is:closed is:issue is:draft")}`,
		);

		expect(view(page)).toEqual({ user: null, filter: "is:draft" });
	});

	test("A link that the page rewrites keeps its fragment", async ({ page, github }) => {
		await page.goto(`/?repo=foo/bar&filter=${encodeURIComponent("repo:foo/baz")}#queue`);

		expect(new URL(page.url()).hash).toBe("#queue");
	});

	test("The switch to the author view opens the queue of the author that the filter names", async ({
		page,
		github,
	}) => {
		await page.goto(`/?repo=foo/bar&filter=${encodeURIComponent("author:other-user")}`);

		await page.getByRole("link", { name: "Author", exact: true }).click();

		await expect.poll(() => view(page)).toEqual({ user: "other-user", filter: null });
	});
});

test("A queue stored for another user marks nothing new for the one signed in now", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();
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
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue tbody mark:not([hidden])")).toHaveCount(0);
});

test("A queue stored by another version, e.g. with a step this one doesn’t know, loads anew", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&role=author");
	await expect(page.locator("progress")).toBeHidden();
	await page.evaluate(() => {
		let key = Object.keys(localStorage).find(key => key.startsWith("review-queue:queue:"));
		let queue = JSON.parse(localStorage.getItem(key));
		queue.rows[0].summary.step.name = "some-future-step";
		localStorage.setItem(key, JSON.stringify(queue));
	});

	await page.reload();

	await expect(page.locator("#summary .count")).toHaveText("6");
});

test("A refreshed row of a PR deleted before its details shows as it was, not dimmed as if still loading", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	github.search = answer => {
		answer.data.search.nodes[0].updatedAt = "2026-11-05T12:00:00Z";
	};
	github.details = answer => {
		answer.data.nodes[0] = null;
		answer.errors = [
			{
				type: "NOT_FOUND",
				path: ["nodes", 0],
				message: "Could not resolve to a node with the global id of 'A'.",
			},
		];
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

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
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&user=dmitrysharabin");

	await expect(page.locator("#empty p")).toHaveText(
		"No pull requests in foo/bar are waiting for your review.",
	);
});

test("An empty queue of another user names them", async ({ page, github }) => {
	github.search = answer => {
		answer.data.search.nodes = [];
	};
	await page.goto("/?repo=foo/bar&role=author&user=other-user");

	await expect(page.locator("#empty p")).toHaveText(
		"other-user has no open pull requests in foo/bar.",
	);
});

for (let size of ["diff", "diffSinceReview"]) {
	test(`A count stored by an older version as unsplit asks for the details again, so its cell gets a reason (${size})`, async ({
		page,
		github,
	}) => {
		// Every PR lists its files, as GitHub does when the details ask for them
		detail(
			github,
			Object.fromEntries(
				[..."ABCDEF"].map(id => [
					id,
					{
						files: {
							totalCount: 1,
							nodes: [{ path: "src/a.js", additions: 1, deletions: 0 }],
						},
					},
				]),
			),
		);
		await page.goto("/?repo=foo/bar&exclude=test");
		await expect(page.locator("progress")).toBeHidden();
		await page.evaluate(size => {
			let key = Object.keys(localStorage).find(key => key.startsWith("review-queue:queue:"));
			let queue = JSON.parse(localStorage.getItem(key));
			queue.rows.find(row => row.pr.id === "A").summary[size].ignored = null;
			localStorage.setItem(key, JSON.stringify(queue));
		}, size);

		let asked = [];
		github.details = answer => {
			asked.push(...answer.data.nodes.map(pr => pr.id));
		};
		await page.reload();
		await expect(page.locator("progress")).toBeHidden();

		expect(asked).toEqual(["A"]);
	});
}
