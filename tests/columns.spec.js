import { test, expect, commit, detail, row } from "./github.js";

/** The last commits of a PR, of `totalCount` in all, e.g. `commits(["N"], 101)`. */
function commits (ids, totalCount = ids.length) {
	// Not `map(commit)`, which would pass the index as the parents
	return { totalCount, nodes: ids.map(id => commit(id)) };
}

/** The user’s review of the commit `oid`, or of one GitHub no longer has, which it answers as `null`. */
function review (oid) {
	return {
		submittedAt: "2026-11-01T12:00:00Z",
		author: { login: "DmitrySharabin" },
		commit: oid ? { oid } : null,
	};
}

/** A request to the user to review a PR, made at `createdAt`. */
function request (createdAt) {
	return { createdAt, requestedReviewer: { login: "DmitrySharabin" } };
}

/** The colors a diffstat paints, e.g. `adnnn` for one added square, one deleted and three neutral. */
async function squares (diffstat) {
	let png = (await diffstat.screenshot()).toString("base64");

	return diffstat.page().evaluate(async png => {
		let image = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${png}`)).blob(),
		);
		let context = new OffscreenCanvas(image.width, image.height).getContext("2d");
		context.drawImage(image, 0, 0);

		return Array.from({ length: 5 }, (_, i) => {
			let [red, green] = context.getImageData(
				((i + 0.5) * image.width) / 5,
				image.height / 2,
				1,
				1,
			).data;
			return green - red > 40 ? "a" : red - green > 40 ? "d" : "n";
		}).join("");
	}, png);
}

test("The diffstat paints GitHub’s squares: one per line below five lines, then each share rounded down", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { additions: 1, deletions: 1 },
		B: { additions: 3, deletions: 3 },
		// A share that comes out whole: 5 × 340 / 425 = 4
		C: { additions: 340, deletions: 85 },
	});
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	expect([
		await squares(row(page, "A").locator(".diff .diffstat")),
		await squares(row(page, "B").locator(".diff .diffstat")),
		await squares(row(page, "C").locator(".diff .diffstat")),
	]).toEqual(["adnnn", "aaddn", "aaaad"]);
});

test("A review of a commit the PR no longer has counts the whole PR, as after a force push", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: commits(["N"]), reviews: { nodes: [review("L")] } },
		// GitHub has no commit to answer. Over 100 commits, so the commit isn’t merely older than the last 100
		B: { commits: commits(["N"], 101), reviews: { nodes: [review(null)] } },
	});
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review .force-pushed")).toBeVisible();
	await expect(row(page, "B").locator(".since-review .force-pushed")).toBeVisible();
});

test("A review of a commit before the last 100 isn’t called a force push", async ({
	page,
	github,
}) => {
	detail(github, {
		A: {
			commits: commits(["N"], 101),
			reviews: { nodes: [review("L")] },
		},
	});
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review a")).toHaveAttribute(
		"title",
		/isn’t among the last 100 commits/,
	);
	await expect(row(page, "A").locator(".since-review .force-pushed")).toBeHidden();
});

test("A comparison counts the PR’s changes since the review exactly, by the files GitHub lists", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: commits(["L", "N"]), reviews: { nodes: [review("L")] } },
	});
	github.compare = answer => {
		answer.files = [{ additions: 5, deletions: 1 }];
	};
	await page.goto("/?repo=foo/bar");

	// Not N’s own size, +780, which only estimates
	await expect(row(page, "A").locator(".since-review")).toContainText("+5 −1");
});

test("A comparison of 300 files, as many as GitHub lists, gives way to the sizes of the commits", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: commits(["L", "N"]), reviews: { nodes: [review("L")] } },
	});
	github.compare = answer => {
		answer.files = Array(300).fill({ additions: 1, deletions: 0 });
	};
	await page.goto("/?repo=foo/bar");

	// N’s own size
	await expect(row(page, "A").locator(".since-review")).toContainText("+780");
});

test("Each run of the author’s commits between merges compares on its own, so the base branch’s changes count nothing", async ({
	page,
	github,
}) => {
	// After the review of L, the author pushed N and P, merged the base branch in M, and pushed O
	detail(github, {
		A: {
			commits: {
				totalCount: 5,
				nodes: [commit("L"), commit("N"), commit("P"), commit("M", 2), commit("O")],
			},
			reviews: { nodes: [review("L")] },
		},
	});
	let lines = { "L...P": 5, "M...O": 3 };
	github.compare = (answer, range) => {
		answer.files = [{ additions: lines[range], deletions: 1 }];
	};
	await page.goto("/?repo=foo/bar");

	// Not the sum of N, P and O, +2,370, which counts a line again each time a commit rewrites it
	await expect(row(page, "A").locator(".since-review")).toHaveText("+8 −2", {
		useInnerText: true,
	});
});

/** Commits of a PR reviewed at L, with `count` runs of N after it, each after a merge */
function afterMerges (count) {
	let nodes = [commit("L")];
	for (let i = 0; i < count; i++) {
		nodes.push(commit(`M${i}`, 2), commit("N"));
	}
	return { commits: { totalCount: nodes.length, nodes }, reviews: { nodes: [review("L")] } };
}

test("Up to five runs each compare on their own", async ({ page, github }) => {
	detail(github, { A: afterMerges(5) });
	let compared = 0;
	github.compare = answer => {
		compared++;
		answer.files = [{ additions: 1, deletions: 0 }];
	};
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review")).toHaveText("+5 −0", {
		useInnerText: true,
	});
	expect(compared).toBe(5);
});

test("More runs than the limit add up the sizes of the commits, so a PR can’t send many comparisons", async ({
	page,
	github,
}) => {
	detail(github, { A: afterMerges(6) });
	let compared = 0;
	github.compare = () => {
		compared++;
	};
	await page.goto("/?repo=foo/bar");

	// N’s own size, six times
	await expect(row(page, "A").locator(".since-review")).toHaveText("+4,680 −12", {
		useInnerText: true,
	});
	expect(compared).toBe(0);
});

test("A comparison of 300 files in any run gives way to the sizes of the commits", async ({
	page,
	github,
}) => {
	detail(github, { A: afterMerges(2) });
	github.compare = (answer, range) => {
		answer.files = Array(range === "M1...N" ? 300 : 1).fill({ additions: 1, deletions: 0 });
	};
	await page.goto("/?repo=foo/bar");

	// N’s own size, twice
	await expect(row(page, "A").locator(".since-review")).toHaveText("+1,560 −4", {
		useInnerText: true,
	});
});

test("A refresh doesn’t compare 300 files again, since GitHub would list as many", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: commits(["L", "N"]), reviews: { nodes: [review("L")] } },
	});
	let compared = 0;
	github.compare = answer => {
		compared++;
		answer.files = Array(300).fill({ additions: 1, deletions: 0 });
	};
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.locator("progress")).toBeHidden();

	expect(compared).toBe(1);
});

test("A PR asked only of the user’s team shows no count of rounds, since the team’s requests are unknown", async ({
	page,
	github,
}) => {
	// No pending request names the user on A, only someone else, so GitHub’s search found it through a team. B asks the user once
	detail(github, {
		A: { reviewRequests: { nodes: [{ requestedReviewer: { login: "other-user" } }] } },
		B: {
			timelineItems: { nodes: [request("2026-11-01T12:00:00Z")] },
			reviewRequests: { nodes: [{ requestedReviewer: { login: "DmitrySharabin" } }] },
		},
	});
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".iterations")).toHaveText("—");
	await expect(row(page, "B").locator(".iterations")).toHaveText("0");
});

test("A review after the user’s request still counts when the next request came through a team", async ({
	page,
	github,
}) => {
	// The user was asked on Oct 30 and reviewed L on Nov 1. No request names the user now
	detail(github, {
		A: {
			timelineItems: { nodes: [request("2026-10-30T12:00:00Z")] },
			commits: commits(["L", "N"]),
			reviews: { nodes: [review("L")] },
		},
	});
	github.compare = answer => {
		answer.files = [{ additions: 5, deletions: 1 }];
	};
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review")).toContainText("+5 −1");
	// The answered request isn’t what the PR waits on
	await expect(row(page, "A").locator("time")).toHaveText("—");
});

test.describe("Exclude from counts", () => {
	/** A PR’s changed files, as its details list them, e.g. `files({ "src/a.js": 10 })` for +10 −0. */
	function files (lines, totalCount = Object.keys(lines).length) {
		return {
			files: {
				totalCount,
				nodes: Object.entries(lines).map(([path, additions]) => ({
					path,
					additions,
					deletions: 0,
				})),
			},
		};
	}

	test("A PR’s cell counts the files the pattern doesn’t match, with every file’s total under them", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }) });
		await page.goto("/?repo=foo/bar&files=test");

		let cell = row(page, "A").locator(".diff");
		await expect(cell.locator("a")).toHaveAccessibleName("+10 −0 without excluded files");
		await expect(cell.locator(".total")).toHaveText("+510 −0");
	});

	test("A screen reader hears which line leaves the excluded files out", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }) });
		await page.goto("/?repo=foo/bar&files=test");

		await expect(row(page, "A").locator(".diff")).toHaveAccessibleName(
			"+10 −0 without excluded files +510 −0 total",
		);
	});

	test("The lines left to review sort the column, not the total", async ({ page, github }) => {
		// A is mostly tests, B has more code to read
		detail(github, {
			A: files({ "src/a.js": 10, "test/a.test.js": 500 }),
			B: files({ "src/b.js": 300 }),
		});
		await page.goto("/?repo=foo/bar&files=test");
		await expect(page.locator("progress")).toBeHidden();

		await page.getByRole("button", { name: "Changes", exact: true }).click();

		// C–F have no files, so they count every line and sort apart
		let numbers = page.locator("#queue tbody .number").filter({ hasText: /#6[56]/ });
		await expect(numbers).toHaveText(["#66", "#65"]);
	});

	test("Without a pattern, the details don’t ask for files, which slow them down", async ({
		page,
		github,
	}) => {
		let queries = [];
		page.on("request", request => {
			if (request.url().endsWith("/graphql")) {
				queries.push(request.postData());
			}
		});
		await page.goto("/?repo=foo/bar");
		await expect(page.locator("progress")).toBeHidden();

		expect(queries.some(query => query.includes("files("))).toBe(false);
	});

	test("A comparison counts the changes since the review apart from the excluded files", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: { commits: commits(["L", "N"]), reviews: { nodes: [review("L")] } },
		});
		github.compare = answer => {
			answer.files = [
				{ filename: "src/a.js", additions: 5, deletions: 1 },
				{ filename: "deps.lock", additions: 900, deletions: 40 },
			];
		};
		await page.goto(`/?repo=foo/bar&files=${encodeURIComponent("lock")}`);

		let cell = row(page, "A").locator(".since-review");
		await expect(cell.locator("a")).toHaveAccessibleName("+5 −1 without excluded files");
		await expect(cell.locator(".total")).toHaveText("+905 −41");
	});

	test("A sum of commits stands in with its total, since commits don’t list their files", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: { commits: commits(["L", "N"]), reviews: { nodes: [review("L")] } },
		});
		github.compare = () => 500;
		await page.goto("/?repo=foo/bar&files=test");

		// N’s own size, with no word after it, which would break the column’s run of figures
		let cell = row(page, "A").locator(".since-review");
		await expect(cell.locator("a")).toHaveAccessibleName("+780 −2 with excluded files");
		await expect(cell.locator("small")).toBeHidden();
		await expect(cell.locator("a")).toHaveAttribute("title", "This counts excluded files too");
		// Gray, as other counts that stand in for the one the column means
		await expect(cell.locator("a .added")).toHaveCSS("filter", "grayscale(1)");
	});

	test("An unreviewed PR of over 100 files says both why it counts the whole PR and that it counts excluded files", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }, 101) });
		await page.goto("/?repo=foo/bar&files=test");

		await expect(row(page, "A").locator(".since-review a")).toHaveAttribute(
			"title",
			"Not reviewed yet, so this counts the whole pull request, excluded files too",
		);
	});

	test("Another pattern counts the files anew", async ({ page, github }) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }) });
		await page.goto("/?repo=foo/bar&files=test");
		await expect(row(page, "A").locator(".diff a .added")).toHaveText("+10");

		await page.locator("#ignored summary").click();
		await page.getByRole("searchbox", { name: "Exclude from counts" }).fill("src");
		await page.locator("#ignored").getByRole("button", { name: "Apply" }).click();

		// Now the tests are what is left to read
		await expect(row(page, "A").locator(".diff a .added")).toHaveText("+500");
	});

	test("A PR of over 100 files stands in with its total, since the files left out can’t be told apart", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }, 101) });
		await page.goto("/?repo=foo/bar&files=test");

		// The PR’s own count of every file
		let cell = row(page, "A").locator(".diff");
		await expect(cell.locator("a")).toHaveAccessibleName("+650 −2 with excluded files");
		await expect(cell.locator("small")).toBeHidden();
		await expect(cell.locator("a")).toHaveAttribute("title", "This counts excluded files too");
	});

	test("A size with no total keeps its figures level with the other size’s in the row", async ({
		page,
		github,
	}) => {
		// A splits its whole PR, while its sum of commits since the review can’t split
		detail(github, {
			A: {
				...files({ "src/a.js": 10, "test/a.test.js": 500 }),
				commits: commits(["L", "N"]),
				reviews: { nodes: [review("L")] },
			},
		});
		github.compare = () => 500;
		await page.goto("/?repo=foo/bar&files=test");
		await expect(row(page, "A").locator(".diff .total")).toBeVisible();
		await expect(row(page, "A").locator(".since-review")).toContainText("+780");

		let [diff, since] = await Promise.all(
			[".diff a", ".since-review a"].map(link => row(page, "A").locator(link).boundingBox()),
		);
		expect(since.y).toBeCloseTo(diff.y, 0);
		// The line kept for the word shows nothing, and a screen reader skips it
		await expect(row(page, "A").locator(".since-review small")).toBeHidden();
	});

	test("A pattern that isn’t a regular expression stops Apply", async ({ page, github }) => {
		await page.goto("/?repo=foo/bar");
		await page.locator("#ignored summary").click();
		let field = page.getByRole("searchbox", { name: "Exclude from counts" });
		await field.fill("test(");
		// The browser fires `invalid` when it stops a form, and shows the field’s message
		let stopped = field.evaluate(
			input =>
				new Promise(resolve =>
					input.addEventListener("invalid", () => resolve(input.validationMessage))),
		);

		await page.locator("#ignored").getByRole("button", { name: "Apply" }).click();

		expect(await stopped).toBe("Enter a valid regular expression.");
	});

	test("A pattern the URL brings back after an invalid one can be applied", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&files=test");
		await page.locator("#ignored summary").click();
		let field = page.getByRole("searchbox", { name: "Exclude from counts" });
		await field.fill("test(");

		// The role switch resets the field to the URL’s `test`, firing no input event
		await page.getByRole("link", { name: "Author" }).click();
		await page.getByRole("link", { name: "Reviewer" }).click();
		await expect(field).toHaveValue("test");

		expect(await field.evaluate(input => input.validity.valid)).toBe(true);
	});

	test("Clear opens the queue without the pattern, and keeps the filter", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&filter=label:bug&files=test");
		await page.locator("#ignored summary").click();

		await page.locator("#ignored").getByRole("link", { name: "Clear exclusions" }).click();

		await expect(page).toHaveURL(/\?repo=foo%2Fbar&filter=label%3Abug$/);
	});

	test("Clear leaves the focus in the emptied field, not on the page", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&files=test");
		await page.locator("#ignored summary").click();

		await page
			.locator("#ignored")
			.getByRole("link", { name: "Clear exclusions" })
			.press("Enter");

		await expect(page.getByRole("searchbox", { name: "Exclude from counts" })).toBeFocused();
	});

	test("The filter’s Clear leaves the focus in its emptied field too", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&filter=label:bug");
		await page.locator("#narrow summary").click();

		await page.locator("#narrow").getByRole("link", { name: "Clear filter" }).press("Enter");

		await expect(page.getByRole("searchbox", { name: "Filter" })).toBeFocused();
	});

	test("A click on Clear leaves the field alone, so a phone opens no keyboard", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&files=test");
		await page.locator("#ignored summary").click();

		await page.locator("#ignored").getByRole("link", { name: "Clear exclusions" }).click();
		await expect(page).toHaveURL(/\?repo=foo%2Fbar$/);

		await expect(
			page.getByRole("searchbox", { name: "Exclude from counts" }),
		).not.toBeFocused();
	});

	test("A pattern that isn’t a regular expression, e.g. from the URL, leaves out no file", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10, "test/a.test.js": 500 }) });
		await page.goto(`/?repo=foo/bar&files=${encodeURIComponent("test(")}`);
		await expect(page.locator("progress")).toBeHidden();

		// The PR’s own count, on one line
		await expect(row(page, "A").locator(".diff")).toHaveText("+650 −2", { useInnerText: true });
	});

	test("A PR whose every file is left out shows nothing left to read, over its total", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "test/a.test.js": 500 }) });
		await page.goto("/?repo=foo/bar&files=test");

		await expect(row(page, "A").locator(".diff")).toHaveAccessibleName(
			"+0 −0 without excluded files +500 −0 total",
		);
	});

	test("A PR with no file left out shows one line, as without a pattern", async ({
		page,
		github,
	}) => {
		detail(github, { A: files({ "src/a.js": 10 }) });
		await page.goto("/?repo=foo/bar&files=test");
		await expect(page.locator("progress")).toBeHidden();

		await expect(row(page, "A").locator(".diff")).toHaveText("+10 −0", { useInnerText: true });
	});

	test("Applying a filter keeps the pattern", async ({ page, github }) => {
		await page.goto("/?repo=foo/bar&files=test");
		await page.locator("#narrow summary").click();

		await page.getByRole("searchbox", { name: "Filter" }).fill("label:bug");
		await page.locator("#narrow").getByRole("button", { name: "Apply" }).click();

		await expect(page).toHaveURL(/^(?=.*filter=label%3Abug)(?=.*files=test)/);
	});

	test("Applying a pattern keeps the filter", async ({ page, github }) => {
		await page.goto("/?repo=foo/bar&filter=label:bug");
		await page.locator("#ignored summary").click();

		await page.getByRole("searchbox", { name: "Exclude from counts" }).fill("test");
		await page.locator("#ignored").getByRole("button", { name: "Apply" }).click();

		await expect(page).toHaveURL(/^(?=.*filter=label%3Abug)(?=.*files=test)/);
	});

	test("A pattern that isn’t a regular expression marks its field once the user leaves it", async ({
		page,
		github,
	}) => {
		await page.goto("/?repo=foo/bar&files=test");
		await page.locator("#ignored summary").click();
		let field = page.getByRole("searchbox", { name: "Exclude from counts" });
		let valid = await field.evaluate(input => getComputedStyle(input).borderColor);

		await field.fill("test(");
		await field.press("Tab");

		await expect(field).not.toHaveCSS("border-color", valid);
	});

	test("A total alone keeps the column’s edge, so its figures line up with the others", async ({
		page,
		github,
	}) => {
		detail(github, {
			A: files({ "src/a.js": 10, "test/a.test.js": 500 }),
			B: files({ "src/a.js": 10, "test/a.test.js": 500 }, 101),
		});
		await page.goto("/?repo=foo/bar&files=test");
		await expect(page.locator("progress")).toBeHidden();

		let [split, unsplit] = await Promise.all(
			["A", "B"].map(id => row(page, id).locator(".diff .figures").first().boundingBox()),
		);
		expect(unsplit.x + unsplit.width).toBeCloseTo(split.x + split.width, 0);
	});

	test("The author view asks for no files, as it counts no lines", async ({ page, github }) => {
		let queries = [];
		page.on("request", request => {
			if (request.url().endsWith("/graphql")) {
				queries.push(request.postData());
			}
		});
		await page.goto("/?repo=foo/bar&role=author&files=test");
		await expect(page.locator("progress")).toBeHidden();

		expect(queries.some(query => query.includes("files("))).toBe(false);
	});
});
