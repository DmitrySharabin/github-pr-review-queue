import { test, expect, commit, detail, filter, loaded, open, row } from "./github.js";

/**
 * Where each of these cells starts while bars stand in for the rows, then once the rows replace them, e.g. `[[65, 518, …], [65, 518, …]]`.
 * `edge` measures another side of them instead, e.g. `bottom`.
 */
async function starts (page, github, selector, { url = "/?repo=foo/bar", edge = "x" } = {}) {
	let measure = () =>
		page
			.locator(selector)
			.evaluateAll(
				(cells, edge) => cells.map(cell => Math.round(cell.getBoundingClientRect()[edge])),
				edge,
			);

	let { promise, resolve } = Promise.withResolvers();
	github.search = () => promise;
	// As in a real reviewer queue, every PR waits for DmitrySharabin. A wait time is wider than the dash of no request.
	// A test’s own `github.details` still runs, e.g. to add reviewers
	let { details } = github;
	github.details = answer => {
		details(answer);
		for (let pr of answer.data.nodes) {
			pr.timelineItems.nodes = [
				{
					createdAt: new Date(Date.now() - 25 * 86_400_000).toISOString(),
					requestedReviewer: { login: "DmitrySharabin" },
				},
			];
			// Still pending, so the request isn’t a team’s
			pr.reviewRequests.nodes.push({ requestedReviewer: { login: "DmitrySharabin" } });
		}
	};
	await page.goto(url);
	await expect(page.locator("#queue tr.skeleton").first()).toBeVisible();
	let before = await measure();

	resolve();
	await loaded(page);

	return [before, await measure()];
}

/** Give every PR a file of code and one of tests, e.g. for `exclude=test` to count apart. */
function withTests (answer) {
	for (let pr of answer.data.nodes) {
		pr.files = {
			totalCount: 2,
			nodes: [
				{ path: "src/a.js", additions: 10, deletions: 0 },
				{ path: "test/a.test.js", additions: 500, deletions: 0 },
			],
		};
	}
}

test("Columns stay put when the rows replace the bars that stood in for them", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("On a phone, where titles wrap, columns stay put when the rows replace the bars", async ({
	page,
	github,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });

	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("Columns stay put when a PR’s many reviewers arrive", async ({ page, github }) => {
	github.details = answer => {
		answer.data.nodes[0].reviewRequests.nodes = Array.from({ length: 12 }, (_, i) => ({
			requestedReviewer: { login: `user${i}`, avatarUrl: `https://github.com/user${i}.png` },
		}));
	};

	let [before, after] = await starts(page, github, "#queue thead th");

	expect(after).toEqual(before);
});

test("The strip’s cells stay put when the count and the latest request replace their bars", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#summary > div");

	expect(after).toEqual(before);
});

test("In the author view, columns stay put when the rows replace the bars", async ({
	page,
	github,
}) => {
	let [before, after] = await starts(page, github, "#queue thead th", {
		url: "/?repo=foo/bar&role=author",
	});

	expect(after).toEqual(before);
});

test("A step that wraps, as long ones do, leaves its row as tall as the bars", async ({
	page,
	github,
}) => {
	// Changes requested on the last commit: “Make the changes @reviewer requested”
	github.details = answer => {
		let review = {
			state: "CHANGES_REQUESTED",
			url: "",
			submittedAt: "2026-11-01T12:00:00Z",
			author: {
				__typename: "User",
				login: "reviewer",
				avatarUrl: "https://github.com/reviewer.png",
			},
			commit: { oid: "L" },
		};
		for (let pr of answer.data.nodes) {
			Object.assign(pr, {
				commits: { totalCount: 1, nodes: [commit("L")] },
				latestReviews: { nodes: [review] },
				latestOpinionatedReviews: { nodes: [review] },
			});
		}
	};

	let [before, after] = await starts(page, github, "#queue tbody tr", {
		url: "/?repo=foo/bar&role=author",
		edge: "bottom",
	});

	expect(after).toEqual(before);
});

test("A size with its total under it leaves its row as tall as the bars", async ({
	page,
	github,
}) => {
	github.details = withTests;

	let [before, after] = await starts(page, github, "#queue tbody tr", {
		url: "/?repo=foo/bar&exclude=test",
		edge: "bottom",
	});
	await expect(page.locator("#queue tbody .total").first()).toBeVisible();

	expect(after).toEqual(before);
});

test("On a phone, the ring of a focused name too long for its cell stays inside the cell", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/?repo=foo/bar");
	let link = page.locator("#summary .user");
	await expect(link).toHaveText("DmitrySharabin");

	await link.focus();

	// Whichever draws the ring, the link or the cell that scrolls it, against the edge the cell clips at, e.g. `{ ring: 342, edge: 346 }`
	let { ring, edge } = await link.evaluate(link => {
		let cell = link.parentElement;
		let owner = [link, cell].find(element => getComputedStyle(element).outlineStyle !== "none");
		let { left } = cell.getBoundingClientRect();
		return {
			ring: owner.getBoundingClientRect().right,
			edge: left + cell.clientLeft + cell.clientWidth,
		};
	});
	expect(ring).toBeLessThanOrEqual(edge);
});

test("On a tablet, the table scrolls in its own frame, not the page sideways", async ({ page }) => {
	await page.setViewportSize({ width: 820, height: 1180 });
	await open(page);

	let overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
	expect(overflow).toBe(0);
});

test("On a phone, what a size says only to a screen reader doesn’t widen the page, so Safari doesn’t zoom out", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/?repo=foo/bar&exclude=test");
	await expect(page.locator("#queue .spoken").first()).toBeAttached();

	let overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
	expect(overflow).toBe(0);
});

test("On a tablet, the author view’s table fits, so its header stays at the top of the window", async ({
	page,
}) => {
	await page.setViewportSize({ width: 900, height: 400 });
	await open(page, "/?repo=foo/bar&role=author");

	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => page.locator("#queue thead").evaluate(head => head.getBoundingClientRect().top))
		.toBe(0);
});

test("The field that edits the user is as tall as the name it replaces, so the strip doesn’t move", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	let cell = page.locator("#summary > div").filter({ has: page.locator(".user") });
	await expect(cell.locator(".user")).toHaveText("DmitrySharabin");
	let before = await cell.boundingBox();

	await page.getByRole("button", { name: "Change user" }).click();
	await expect(page.getByRole("textbox", { name: "User" })).toBeFocused();

	expect((await cell.boundingBox()).height).toBe(before.height);
});

test("The ring of the field that edits the user stays inside the cell that scrolls it", async ({
	page,
}) => {
	await page.goto("/?repo=foo/bar");
	await page.getByRole("button", { name: "Change user" }).click();
	let field = page.getByRole("textbox", { name: "User" });
	await expect(field).toBeFocused();

	// The ring’s outer edge, e.g. 3px out, against the edges of the cell’s scrolling box
	let { ring, box } = await field.evaluate(field => {
		let style = getComputedStyle(field);
		let width = Math.max(parseFloat(style.outlineWidth), 2) + parseFloat(style.outlineOffset);
		let rect = field.getBoundingClientRect();
		let dd = field.closest("dd");
		let outer = dd.getBoundingClientRect();
		return {
			ring: { top: rect.top - width, bottom: rect.bottom + width },
			box: {
				top: outer.top + dd.clientTop,
				bottom: outer.top + dd.clientTop + dd.clientHeight,
			},
		};
	});
	expect(ring.top >= box.top && ring.bottom <= box.bottom).toBe(true);
});

test("A total sits under the figures it adds to, not over them", async ({ page, github }) => {
	github.details = withTests;
	await page.goto("/?repo=foo/bar&exclude=test");

	let cell = page.locator("#queue tbody tr").first().locator(".diff");
	await expect(cell.locator(".total")).toBeVisible();
	let [figures, total] = await Promise.all(
		[cell.locator(".figures").first(), cell.locator(".total")].map(part => part.boundingBox()),
	);
	expect(total.y).toBeGreaterThanOrEqual(figures.y + figures.height - 1);
});

test("The ring of a focused count hugs the count, not the change beside it", async ({ page }) => {
	await page.goto("/?repo=foo/bar");
	let count = page.locator("#summary .count");
	await expect(count).toHaveText("6");

	await count.focus();

	// Whichever draws a ring, the count or its cell, which holds the change too, e.g. `{ ring: 12, width: 12 }`
	let { ring, width } = await count.evaluate(count => ({
		ring: Math.max(
			...[count, count.parentElement]
				.filter(element => getComputedStyle(element).outlineStyle !== "none")
				.map(element => element.getBoundingClientRect().width),
		),
		width: count.getBoundingClientRect().width,
	}));
	expect(ring).toBeLessThanOrEqual(width);
});

test("A sorted header’s label ends where its column’s values end, with the arrow past it", async ({
	page,
}) => {
	await open(page);

	// Of the label’s text, since the button holds the arrow too
	let label = await page.locator("#queue thead th[aria-sort] button").evaluate(button => {
		let range = document.createRange();
		range.selectNodeContents(button);
		return Math.round(range.getBoundingClientRect().right);
	});
	let value = await page
		.locator("#queue tbody td.requested time")
		.first()
		.evaluate(time => Math.round(time.getBoundingClientRect().right));

	expect(label).toBe(value);
});

test("“No changes” ends where the sizes of the other rows end, before the push icon’s slot", async ({
	page,
	github,
}) => {
	detail(github, { C: { additions: 0, deletions: 0 } });
	await open(page);

	let text = await row(page, "C")
		.locator(".since-review")
		.evaluate(cell => {
			let range = document.createRange();
			range.selectNodeContents(cell);
			return range.getBoundingClientRect().right;
		});
	let size = await row(page, "A")
		.locator(".since-review .diffstat")
		.evaluate(diffstat => diffstat.getBoundingClientRect().right);
	expect(text).toBeCloseTo(size, 0);
});
