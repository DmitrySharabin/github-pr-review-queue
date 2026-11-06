import { test, expect, commit, detail, row } from "./github.js";

const day = 864e5;

/** The time `days` ago, as GitHub answers it. */
function ago (days) {
	return new Date(Date.now() - days * day).toISOString();
}

/** Someone on GitHub, e.g. a reviewer, or `Copilot` as a `Bot`. */
function person (login, type = "User") {
	return { __typename: type, login, avatarUrl: `https://github.com/${login}.png` };
}

/** A review by `login` of the commit `oid`, submitted `days` ago, as each list of reviews in the details has it. */
function review (login, state, { oid = "L", days = 10, type } = {}) {
	return {
		state,
		url: `https://github.com/foo/bar/pull/1#review-${login}`,
		submittedAt: ago(days),
		author: person(login, type),
		commit: { oid },
	};
}

/** The details of a PR with these reviews, the latest of each reviewer last, and the commits `oids`. */
function reviewed (reviews, oids = ["L"]) {
	let opinions = reviews.filter(review => review.state !== "COMMENTED");
	return {
		reviews: { nodes: reviews },
		latestReviews: { nodes: reviews },
		latestOpinionatedReviews: { nodes: opinions },
		commits: { totalCount: oids.length, nodes: oids.map(id => commit(id)) },
	};
}

/** The details of a PR that waits for these reviewers, each asked `days` ago. */
function asked (logins, days = 5) {
	return {
		timelineItems: {
			nodes: logins.map(login => ({
				createdAt: ago(days),
				requestedReviewer: person(login),
			})),
		},
		reviewRequests: { nodes: logins.map(login => ({ requestedReviewer: person(login) })) },
	};
}

/** A conversation on a PR, whose last comment is by `login`. */
function thread (login, { isResolved = false, type } = {}) {
	return {
		isResolved,
		comments: { nodes: [{ createdAt: ago(3), author: person(login, type) }] },
	};
}

/** The Next step cell of a PR, e.g. of A, #65. */
function step (page, id) {
	return row(page, id).locator(".step");
}

test.describe("Next step", () => {
	test("A PR re-requested after a change request waits for the reviewer, which GitHub gets wrong", async ({
		page,
		github,
	}) => {
		// The reviewer requested changes, then the author pushed and asked them again
		detail(github, {
			A: {
				...reviewed([review("reviewer", "CHANGES_REQUESTED", { days: 42 })], ["L", "N"]),
				...asked(["reviewer"], 35),
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Waiting for @reviewer");
	});

	test("A PR no one was asked to review asks the author to request a review", async ({
		page,
	}) => {
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Request a review");
	});

	test("A bot’s review leaves a PR without reviewers, since bots don’t take turns", async ({
		page,
		github,
	}) => {
		detail(github, { A: reviewed([review("Copilot", "COMMENTED", { type: "Bot" })]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Request a review");
	});

	test("A conflict comes before waiting for reviewers, since the author must resolve it first", async ({
		page,
		github,
	}) => {
		detail(github, { A: { ...asked(["reviewer"]), mergeable: "CONFLICTING" } });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Resolve conflicts");
	});

	test("Failing checks come before waiting for reviewers", async ({ page, github }) => {
		detail(github, {
			A: {
				...asked(["reviewer"]),
				head: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Fix failing checks");
	});

	test("Running checks wait for no one but GitHub, so reviewers come first", async ({
		page,
		github,
	}) => {
		let running = {
			head: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
		};
		detail(github, {
			A: { ...asked(["reviewer"]), ...running },
			B: { ...reviewed([review("reviewer", "COMMENTED")]), ...running },
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Waiting for @reviewer");
		await expect(step(page, "B")).toHaveText("Checks are running");
	});

	test("Requested changes with no push since are the author’s to make", async ({
		page,
		github,
	}) => {
		// A merge of the base branch brings no change of the author’s
		detail(github, {
			A: reviewed([review("reviewer", "CHANGES_REQUESTED")], ["L", "M"]),
			B: {
				...reviewed([review("reviewer", "CHANGES_REQUESTED")], ["L"]),
				commits: { totalCount: 2, nodes: [commit("L"), commit("M", 2)] },
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Re-request @reviewer’s review");
		await expect(step(page, "B")).toHaveText("Make the changes @reviewer requested");
	});

	test("Conversations count only where the author has yet to reply and the reviewer isn’t asked again", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: {
				...reviewed([review("reviewer", "COMMENTED"), review("other-user", "COMMENTED")]),
				...asked(["other-user"]),
				reviewThreads: {
					nodes: [
						thread("reviewer"),
						thread("reviewer"),
						thread("reviewer", { isResolved: true }),
						thread("DmitrySharabin"),
						thread("other-user"),
						thread("Copilot", { type: "Bot" }),
					],
				},
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Reply to 2 conversations");
	});

	test("An approval with no one asked is the author’s to merge, though the app can’t tell it is enough", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: reviewed([review("reviewer", "APPROVED")]),
			B: { ...reviewed([review("reviewer", "APPROVED")]), ...asked(["other-user"]) },
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Approved");
		await expect(step(page, "B")).toHaveText("Waiting for @other-user");
	});

	test("A dismissed review comes before an approval, since it no longer counts and needs asking again", async ({
		page,
		github,
	}) => {
		let approval = review("other-user", "APPROVED");
		detail(github, {
			A: {
				...reviewed([approval]),
				latestReviews: { nodes: [review("reviewer", "DISMISSED"), approval] },
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Re-request @reviewer’s review");
	});

	test("A request to a team the token can’t see waits for the team, from when it was asked", async ({
		page,
		github,
	}) => {
		// GitHub answers such a team as null, in the pending requests and in the timeline
		detail(github, {
			A: {
				timelineItems: { nodes: [{ createdAt: ago(8), requestedReviewer: null }] },
				reviewRequests: { nodes: [{ requestedReviewer: null }] },
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Waiting for a team review");
		await expect(row(page, "A").locator("time")).toHaveText("8 days");
	});

	test("Several reviewers asked show as a count", async ({ page, github }) => {
		detail(github, { A: asked(["reviewer", "other-user"]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Waiting for 2 reviews");
	});

	test("A draft is no one’s turn, whatever else it lacks", async ({ page, github }) => {
		github.search = answer => {
			answer.data.search.nodes[0].isDraft = true;
		};
		detail(github, { A: { mergeable: "CONFLICTING" } });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Draft");
	});

	test("Only the author’s turn is in bold", async ({ page, github }) => {
		detail(github, { B: asked(["reviewer"]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A").locator("strong")).toHaveText("Request a review");
		await expect(step(page, "B").locator("strong")).toHaveCount(0);
	});
});

test("Waiting shows how long the PR waits for its step, and nothing for a step no review decides", async ({
	page,
	github,
}) => {
	detail(github, {
		A: asked(["reviewer"], 20),
		B: { ...asked(["reviewer"]), mergeable: "CONFLICTING" },
	});
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").locator("time")).toHaveText("20 days");
	await expect(row(page, "B").locator("time")).toHaveText("—");
});

test("The author’s turn sorts first, the longest wait first, and a draft last", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes[0].isDraft = true;
	};
	// B and C wait for the author, C longer. D and E wait for a reviewer, E longer
	detail(github, {
		B: reviewed([review("reviewer", "CHANGES_REQUESTED", { days: 2 })]),
		C: reviewed([review("reviewer", "CHANGES_REQUESTED", { days: 20 })]),
		D: asked(["reviewer"], 1),
		E: asked(["reviewer"], 30),
		F: asked(["reviewer"], 10),
	});
	await page.goto("/?repo=foo/bar&role=author");
	await expect(page.locator("progress")).toBeHidden();

	await expect(page.locator("#queue tbody .number")).toHaveText([
		"#67",
		"#66",
		"#69",
		"#70",
		"#68",
		"#65",
	]);
});

test("An approval before the author’s last commit is marked as of an earlier version", async ({
	page,
	github,
}) => {
	// A merge of the base branch after B’s approval changes none of the author’s code
	detail(github, {
		A: reviewed([review("reviewer", "APPROVED")], ["L", "M"]),
		B: {
			...reviewed([review("reviewer", "APPROVED")]),
			commits: { totalCount: 2, nodes: [commit("L"), commit("M", 2)] },
		},
	});
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").locator(".reviewers a")).toHaveAttribute(
		"title",
		"reviewer approved an earlier version",
	);
	await expect(row(page, "B").locator(".reviewers a")).toHaveAttribute(
		"title",
		"reviewer approved",
	);
});

test("A refresh asks for every PR’s details again, since a finished check changes nothing the search finds", async ({
	page,
	github,
}) => {
	await page.goto("/?repo=foo/bar&role=author");
	await expect(page.locator("progress")).toBeHidden();

	let asked = [];
	github.details = answer => {
		asked.push(...answer.data.nodes.map(pr => pr.id));
	};
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	expect(asked.toSorted()).toEqual([..."ABCDEF"]);
});

test("Each role keeps its own sort, so a reviewer’s choice doesn’t sort the author’s steps", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	await page.getByRole("button", { name: "All changes" }).click();
	await page.getByRole("link", { name: "Author" }).click();

	await expect(page.locator("#queue th[aria-sort]")).toHaveText("Next step");
});

test("The summary counts the PRs whose turn is the author’s, by name for someone else", async ({
	page,
	github,
}) => {
	detail(github, { A: asked(["other-user"]), B: asked(["other-user"]) });
	await page.goto("/?repo=foo/bar&role=author&user=reviewer");

	await expect(page.locator("#summary .turns")).toHaveText("4");
	await expect(
		page.locator("#summary .turns").locator("xpath=../preceding-sibling::dt"),
	).toHaveText("reviewer’s turn");
});

test("The author sees only the columns that help them: whose turn, for how long, and the reviewers", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar&role=author");

	await expect(page.locator("#queue thead th:visible")).toHaveText([
		"Pull request",
		"Next step",
		"Waiting",
		"Reviewers",
	]);
});

test("A queue stored before PRs had steps shows while it loads, then counts the author’s turns", async ({
	page,
	context,
	github,
}) => {
	await context.addInitScript(() => {
		let summary = {
			number: 65,
			title: "A pull request titled A",
			url: "",
			author: "ghost",
			avatar: "",
			labels: [],
			reviewers: [],
		};
		localStorage.setItem(
			"review-queue:queue:repo=foo%2Fbar&role=author",
			JSON.stringify({
				user: "DmitrySharabin",
				at: new Date().toISOString(),
				rows: [{ pr: { id: "A", labels: { nodes: [] } }, summary }],
			}),
		);
	});
	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	await page.goto("/?repo=foo/bar&role=author");
	await expect(row(page, "A")).toBeVisible();
	resolve();

	await expect(page.locator("#summary .turns")).toHaveText("6");
});
