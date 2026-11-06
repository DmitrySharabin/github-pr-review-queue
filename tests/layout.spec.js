import { test, expect, commit } from "./github.js";

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
	await expect(page.locator("progress")).toBeHidden();

	return [before, await measure()];
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
	github.details = answer => {
		for (let pr of answer.data.nodes) {
			pr.files = {
				totalCount: 2,
				nodes: [
					{ filename: "src/a.js", additions: 10, deletions: 0 },
					{ filename: "test/a.test.js", additions: 500, deletions: 0 },
				],
			};
		}
	};

	let [before, after] = await starts(page, github, "#queue tbody tr", {
		url: "/?repo=foo/bar&files=test",
		edge: "bottom",
	});

	expect(after).toEqual(before);
});

test("On a phone, the ring of a focused name too long for its cell stays inside the cell", async ({
	page,
	github,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/?repo=foo/bar");
	let link = page.locator("#summary .user");
	await expect(link).toHaveText("DmitrySharabin");

	await link.focus();

	// Whichever draws the ring, the link or the cell that scrolls it, e.g. `{ ring: 330, cell: 342 }`
	let { ring, cell } = await link.evaluate(link => {
		let owner = [link, link.parentElement].find(
			element => getComputedStyle(element).outlineStyle !== "none",
		);
		return {
			ring: owner.getBoundingClientRect().right,
			cell: link.closest("#summary > div").getBoundingClientRect().right,
		};
	});
	expect(ring).toBeLessThanOrEqual(cell);
});

test("The field that edits the user is as tall as the name it replaces, so the strip doesn’t move", async ({
	page,
	github,
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
	github,
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
