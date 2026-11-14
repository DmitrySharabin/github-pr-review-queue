import {
	test,
	expect,
	commit,
	detail,
	filter,
	loaded,
	numbers,
	open,
	refresh,
	row,
} from "./github.js";

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

/** A conversation on a PR, whose last comment is by `login`, with the URL `url`. */
function thread (login, { isResolved = false, type, url } = {}) {
	return {
		isResolved,
		comments: { nodes: [{ createdAt: ago(3), url, author: person(login, type) }] },
	};
}

/** Give the signed-in user this access to the repository, e.g. `READ`, as the search answers it. */
function permit (github, permission) {
	github.search = answer => {
		answer.data.repository.viewerPermission = permission;
	};
}

/** The Next step cell of a PR, e.g. of A, #65. */
function step (page, id) {
	return row(page, id).locator(".step");
}

test.describe("Next step", () => {
	let running = { statusCheckRollup: { state: "PENDING" } };

	// Each case gives PRs their details, and names the step each of them then shows
	let cases = [
		{
			title: "A PR re-requested after a change request waits for the reviewer, which GitHub gets wrong",
			// The reviewer requested changes, then the author pushed and asked them again
			details: {
				A: {
					...reviewed(
						[review("reviewer", "CHANGES_REQUESTED", { days: 42 })],
						["L", "N"],
					),
					...asked(["reviewer"], 35),
				},
			},
			steps: { A: "Waiting for @reviewer" },
		},
		{
			title: "A bot’s review leaves a PR without reviewers, since bots don’t take turns",
			details: { A: reviewed([review("Copilot", "COMMENTED", { type: "Bot" })]) },
			steps: { A: "Request a review" },
		},
		{
			title: "A review asked of a bot waits for no one, since bots don’t take turns",
			details: {
				A: { reviewRequests: { nodes: [{ requestedReviewer: person("Copilot", "Bot") }] } },
			},
			steps: { A: "Request a review" },
		},
		{
			title: "A conflict comes before waiting for reviewers, since the author must resolve it first",
			details: { A: { ...asked(["reviewer"]), mergeable: "CONFLICTING" } },
			steps: { A: "Resolve conflicts" },
		},
		{
			title: "A merge state GitHub hasn’t computed yet counts as no conflict",
			details: { A: { ...asked(["reviewer"]), mergeable: "UNKNOWN" } },
			steps: { A: "Waiting for @reviewer" },
		},
		{
			title: "Running checks wait for no one but GitHub, so reviewers come first",
			details: {
				A: { ...asked(["reviewer"]), ...running },
				B: { ...reviewed([review("reviewer", "COMMENTED")]), ...running },
			},
			steps: { A: "Waiting for @reviewer", B: "Checks are running" },
		},
		{
			title: "A check that errs fails too, and one GitHub still expects is running",
			details: {
				A: {
					...reviewed([review("reviewer", "COMMENTED")]),
					statusCheckRollup: { state: "ERROR" },
				},
				B: {
					...reviewed([review("reviewer", "COMMENTED")]),
					statusCheckRollup: { state: "EXPECTED" },
				},
			},
			steps: { A: "Fix failing checks", B: "Checks are running" },
		},
		{
			title: "An approved PR whose checks still run waits for them, since GitHub merges only once they pass",
			details: { A: { ...reviewed([review("reviewer", "APPROVED")]), ...running } },
			steps: { A: "Checks are running" },
		},
		{
			title: "Requested changes with no push since are the author’s to make",
			// A merge of the base branch brings no change of the author’s
			details: {
				A: reviewed([review("reviewer", "CHANGES_REQUESTED")], ["L", "M"]),
				B: {
					...reviewed([review("reviewer", "CHANGES_REQUESTED")], ["L"]),
					commits: { totalCount: 2, nodes: [commit("L"), commit("M", 2)] },
				},
			},
			steps: { A: "Re-request review", B: "Make changes" },
		},
		{
			title: "Requested changes on code a force push removed are the reviewer’s to see again",
			details: {
				A: reviewed([review("reviewer", "CHANGES_REQUESTED", { oid: "L" })], ["N"]),
			},
			steps: { A: "Re-request review" },
		},
		{
			title: "Several reviewers to ask again share one button",
			details: {
				A: reviewed(
					[
						review("reviewer", "CHANGES_REQUESTED"),
						review("other-user", "CHANGES_REQUESTED"),
					],
					["L", "M"],
				),
			},
			steps: { A: "Re-request reviews" },
		},
		{
			title: "A reviewer who only commented, with nothing left to answer, is the author’s to ask again",
			details: { A: reviewed([review("reviewer", "COMMENTED")]) },
			steps: { A: "Re-request review" },
		},
		{
			title: "Auto-merge waits for an approval, which only the author can ask for",
			details: {
				A: {
					...reviewed([review("reviewer", "COMMENTED")]),
					autoMergeRequest: { enabledAt: ago(2) },
				},
			},
			steps: { A: "Re-request review" },
		},
		{
			title: "A dismissed review comes before an approval, since it no longer counts and needs asking again",
			details: {
				A: {
					...reviewed([review("other-user", "APPROVED")]),
					latestReviews: {
						nodes: [review("reviewer", "DISMISSED"), review("other-user", "APPROVED")],
					},
				},
			},
			steps: { A: "Re-request review" },
		},
		{
			title: "Several reviewers asked show as a count",
			details: { A: asked(["reviewer", "other-user"]) },
			steps: { A: "Waiting for 2 reviews" },
		},
		{
			title: "Conversations count only where the author has yet to reply and the reviewer isn’t asked again",
			details: {
				A: {
					...reviewed([
						review("reviewer", "COMMENTED"),
						review("other-user", "COMMENTED"),
					]),
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
			},
			steps: { A: "Reply to 2 conversations" },
		},
		{
			title: "One conversation reads in the singular",
			details: {
				A: {
					...reviewed([review("reviewer", "COMMENTED")]),
					reviewThreads: { nodes: [thread("reviewer")] },
				},
			},
			steps: { A: "Reply to 1 conversation" },
		},
	];

	for (let { title, details, steps } of cases) {
		test(title, async ({ page, github }) => {
			detail(github, details);
			await page.goto("/?repo=foo/bar&role=author");

			for (let [id, text] of Object.entries(steps)) {
				await expect(step(page, id)).toHaveText(text);
			}
		});
	}

	test("An approval with no one asked is the author’s to merge, though the app can’t tell it is enough", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: reviewed([
				review("reviewer", "APPROVED", { days: 10 }),
				review("other-user", "APPROVED", { days: 3 }),
			]),
			B: { ...reviewed([review("reviewer", "APPROVED")]), ...asked(["other-user"]) },
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Merge pull request");
		// Since the last approval, when the PR came back to the author
		await expect(row(page, "A").locator(".requested time")).toHaveText("3 days");
		await expect(step(page, "B")).toHaveText("Waiting for @other-user");
	});

	test("An author without write access can’t request reviews or merge, so a maintainer has the turn", async ({
		page,
		github,
	}) => {
		permit(github, "READ");
		detail(github, {
			B: reviewed([review("reviewer", "APPROVED")]),
			C: reviewed([review("reviewer", "CHANGES_REQUESTED")]),
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Waiting for a review");
		await expect(step(page, "B")).toHaveText("Waiting for a maintainer to merge");
		await expect(row(page, "B").locator(".requested time")).toHaveText("10 days");
		// Changes a reviewer asked for are the author’s to make at any access
		await expect(page.locator("#summary .turns")).toHaveText("1");
	});

	test("Triage access is enough to request reviews, but not to merge", async ({
		page,
		github,
	}) => {
		permit(github, "TRIAGE");
		detail(github, { B: reviewed([review("reviewer", "APPROVED")]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Request a review");
		await expect(step(page, "B")).toHaveText("Waiting for a maintainer to merge");
	});

	test("Admin access merges, as write access does", async ({ page, github }) => {
		permit(github, "ADMIN");
		detail(github, { A: reviewed([review("reviewer", "APPROVED")]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Merge pull request");
	});

	test("A PR in the merge queue or set to merge automatically waits for GitHub, not the author", async ({
		page,
		github,
	}) => {
		let approved = reviewed([review("reviewer", "APPROVED")]);
		detail(github, {
			A: { ...approved, isInMergeQueue: true },
			// Auto-merge is for checks that still run
			B: {
				...approved,
				autoMergeRequest: { enabledAt: ago(2) },
				statusCheckRollup: { state: "PENDING" },
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Queued to merge");
		await expect(step(page, "B")).toHaveText("Auto-merge enabled");
		await expect(row(page, "B").locator(".requested time")).toHaveText("2 days");
	});

	test("A PR that waits for GitHub to merge it is others’ turn, so it sorts after the author’s and doesn’t count", async ({
		page,
		github,
	}) => {
		let approved = reviewed([review("reviewer", "APPROVED")]);
		detail(github, {
			A: { ...approved, isInMergeQueue: true },
			B: { ...approved, autoMergeRequest: { enabledAt: ago(2) } },
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(numbers(page)).toHaveText(["#67", "#68", "#69", "#70", "#66", "#65"]);
		await expect(page.locator("#summary .turns")).toHaveText("4");
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
		await expect(row(page, "A").locator(".requested time")).toHaveText("8 days");
	});

	test("Only the reviewers whose reviewed code is still there wait for the author’s changes", async ({
		page,
		github,
	}) => {
		// The author pushed M after the review of L
		detail(github, {
			A: reviewed(
				[
					review("reviewer", "CHANGES_REQUESTED", { oid: "L" }),
					review("other-user", "CHANGES_REQUESTED", { oid: "M" }),
					review("third-user", "CHANGES_REQUESTED", { oid: "M" }),
				],
				["L", "M"],
			),
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A").getByRole("link")).toHaveAttribute(
			"href",
			"https://github.com/foo/bar/pull/1#review-other-user",
		);
	});

	test("A draft is no one’s turn, whatever else it lacks", async ({ page, github }) => {
		github.search = answer => {
			answer.data.search.nodes[0].isDraft = true;
		};
		detail(github, { A: { mergeable: "CONFLICTING" } });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A")).toHaveText("Ready for review");
		await expect(step(page, "A").locator(".quiet")).toBeVisible();
	});

	test("Only the author’s steps are buttons, since others’ steps leave the author nothing to do", async ({
		page,
		github,
	}) => {
		detail(github, { B: asked(["reviewer"]) });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A").getByRole("link")).toHaveAccessibleName("Request a review");
		await expect(step(page, "A").locator(".quiet")).toHaveCount(0);
		await expect(step(page, "B").getByRole("link")).toHaveCount(0);
	});

	test("Failing checks link to the PR’s checks, where the author sees which fail", async ({
		page,
		github,
	}) => {
		detail(github, { A: { ...asked(["reviewer"]), statusCheckRollup: { state: "FAILURE" } } });
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A").getByRole("link")).toHaveAttribute(
			"href",
			"https://github.com/foo/bar/pull/1/checks",
		);
	});

	test("A reply links to the first conversation that waits for it", async ({ page, github }) => {
		detail(github, {
			A: {
				...reviewed([review("reviewer", "COMMENTED")]),
				reviewThreads: {
					nodes: [
						thread("DmitrySharabin", {
							url: "https://github.com/foo/bar/pull/1#discussion_r1",
						}),
						thread("reviewer", {
							url: "https://github.com/foo/bar/pull/1#discussion_r2",
						}),
						thread("reviewer", {
							url: "https://github.com/foo/bar/pull/1#discussion_r3",
						}),
					],
				},
			},
		});
		await page.goto("/?repo=foo/bar&role=author");

		await expect(step(page, "A").getByRole("link")).toHaveAttribute(
			"href",
			"https://github.com/foo/bar/pull/1#discussion_r2",
		);
	});

	test("A step done in the PR’s merge box or sidebar links to the PR, since GitHub has no deeper link", async ({
		page,
		github,
	}) => {
		github.search = answer => {
			answer.data.search.nodes[5].isDraft = true;
		};
		detail(github, {
			B: { ...asked(["reviewer"]), mergeable: "CONFLICTING" },
			C: reviewed([review("reviewer", "APPROVED")]),
			D: reviewed([review("reviewer", "COMMENTED")]),
		});
		await page.goto("/?repo=foo/bar&role=author");

		for (let id of "ABCDF") {
			await expect(step(page, id).getByRole("link")).toHaveAttribute(
				"href",
				"https://github.com/foo/bar/pull/1",
			);
		}
	});
});

test("A draft has GitHub’s draft icon in place of an open PR’s, apart from its labels", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes[0].isDraft = true;
	};
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").getByRole("img", { name: "Draft" })).toBeVisible();
	await expect(row(page, "B").getByRole("img", { name: "Draft" })).toHaveCount(0);
});

test("An author’s PR says when it was opened, not by whom, since all of them are theirs", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes[0].createdAt = ago(21);
	};
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").locator("small")).toHaveText("#65 opened 21 days ago");
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

	await expect(row(page, "A").locator(".requested time")).toHaveText("20 days");
	await expect(row(page, "B").locator(".requested time")).toHaveText("—");
	// A PR no one was asked to review waits since it was opened, which its byline already says
	await expect(row(page, "C").locator(".requested time")).toHaveText("—");
});

test("Waiting counts from the oldest pending request, each reviewer’s latest", async ({
	page,
	github,
}) => {
	// reviewer was asked 30 days ago and again 5 days ago. other-user was asked 10 days ago
	detail(github, {
		A: {
			timelineItems: {
				nodes: [
					{ createdAt: ago(30), requestedReviewer: person("reviewer") },
					{ createdAt: ago(10), requestedReviewer: person("other-user") },
					{ createdAt: ago(5), requestedReviewer: person("reviewer") },
				],
			},
			reviewRequests: {
				nodes: [
					{ requestedReviewer: person("reviewer") },
					{ requestedReviewer: person("other-user") },
				],
			},
		},
	});
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").locator(".requested time")).toHaveText("10 days");
});

test("The author’s turn sorts first, the longest wait first, and a draft last", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes[0].isDraft = true;
	};
	// B and C wait for the author, C longer. D has a conflict, which waits for nothing, so it follows them. E and F wait for a reviewer, E longer
	detail(github, {
		B: reviewed([review("reviewer", "CHANGES_REQUESTED", { days: 2 })]),
		C: reviewed([review("reviewer", "CHANGES_REQUESTED", { days: 20 })]),
		D: { ...asked(["reviewer"], 1), mergeable: "CONFLICTING" },
		E: asked(["reviewer"], 30),
		F: asked(["reviewer"], 10),
	});
	await open(page, "/?repo=foo/bar&role=author");

	await expect(numbers(page)).toHaveText(["#67", "#66", "#68", "#69", "#70", "#65"]);
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

test("A change request isn’t marked as an earlier version, though the author pushed since", async ({
	page,
	github,
}) => {
	detail(github, { A: reviewed([review("reviewer", "CHANGES_REQUESTED")], ["L", "M"]) });
	await page.goto("/?repo=foo/bar&role=author");

	await expect(row(page, "A").locator(".reviewers a")).toHaveAttribute(
		"title",
		"reviewer requested changes",
	);
});

test("A refresh asks for every PR’s details again, since a finished check changes nothing the search finds", async ({
	page,
	github,
}) => {
	await open(page, "/?repo=foo/bar&role=author");

	let asked = [];
	github.details = answer => {
		asked.push(...answer.data.nodes.map(pr => pr.id));
	};
	await refresh(page);
	await loaded(page);

	expect(asked.toSorted()).toEqual([..."ABCDEF"]);
});

test("The summary counts the PRs whose turn is the author’s, as “Author’s turn” for someone else", async ({
	page,
	github,
}) => {
	detail(github, { A: asked(["other-user"]), B: asked(["other-user"]) });
	await page.goto("/?repo=foo/bar&role=author&user=reviewer");

	await expect(page.locator("#summary .turns")).toHaveText("4");
	await expect(page.locator("#summary .tally")).toHaveText("Author’s turn");
});

test("The summary counts the author’s own turns as theirs", async ({ page }) => {
	await page.goto("/?repo=foo/bar&role=author");

	await expect(page.locator("#summary .tally")).toHaveText("Your turn");
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
			"review-queue:queue:3:repo=foo%2Fbar&role=author",
			JSON.stringify({
				user: "DmitrySharabin",
				at: Date.now(),
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

test("A stored queue shows when each PR was opened and when it was asked for review, while it loads again", async ({
	page,
	github,
}) => {
	github.search = answer => {
		answer.data.search.nodes[0].createdAt = ago(21);
	};
	detail(github, { A: asked(["reviewer"], 20) });
	await open(page, "/?repo=foo/bar&role=author");

	github.search = () => new Promise(() => {});
	await page.reload();

	await expect(row(page, "A").locator("small")).toHaveText("#65 opened 21 days ago");
	await expect(row(page, "A").locator(".requested time")).toHaveText("20 days");
});

test("The author’s own stored queue says “Your turn” while the sign-in runs", async ({
	page,
	github,
}) => {
	await open(page, "/?repo=foo/bar&role=author");

	github.user = () => new Promise(() => {});
	await page.reload();

	await expect(page.locator("#summary .tally")).toHaveText("Your turn");
});
