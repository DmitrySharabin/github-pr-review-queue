import { test, expect } from "./github.js";

let commit = id => ({ commit: { id, oid: id, parents: { totalCount: 1 } } });
// The user’s review of the commit `oid`. GitHub answers `null` for a commit it no longer has
let review = oid => ({
	submittedAt: "2026-11-01T12:00:00Z",
	author: { login: "DmitrySharabin" },
	commit: oid ? { oid } : null,
});

/** Give PRs their details from `fields`, e.g. `{ A: { additions: 1 } }`. */
function detail (github, fields) {
	github.details = answer => {
		for (let pr of answer.data.nodes) {
			Object.assign(pr, fields[pr.id]);
		}
	};
}

/** The row of a PR, e.g. of A, #65. */
function row (page, id) {
	return page.locator("#queue tbody tr").filter({ hasText: `#${id.charCodeAt(0)}` });
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
	detail(github, { A: { additions: 1, deletions: 1 }, B: { additions: 3, deletions: 3 } });
	await page.goto("/?repo=foo/bar");
	await expect(page.locator("progress")).toBeHidden();

	expect([
		await squares(row(page, "A").locator(".diff .diffstat")),
		await squares(row(page, "B").locator(".diff .diffstat")),
	]).toEqual(["adnnn", "aaddn"]);
});

test("A review of a commit GitHub no longer has counts the whole PR, as after a force push", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: { nodes: [commit("N")] }, reviews: { nodes: [review(null)] } },
	});
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review .force-pushed")).toBeVisible();
});

test("A review of a commit before the last 100 isn’t called a force push", async ({
	page,
	github,
}) => {
	detail(github, {
		A: {
			commits: { totalCount: 101, nodes: [commit("N")] },
			reviews: { nodes: [review("L")] },
		},
	});
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".since-review a")).toHaveAttribute(
		"title",
		/older than the last 100 commits/,
	);
});

test("A comparison of 300 files, as many as GitHub lists, gives way to the sizes of the commits", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: { nodes: [commit("L"), commit("N")] }, reviews: { nodes: [review("L")] } },
	});
	github.compare = answer => {
		answer.files = Array(300).fill({ additions: 1, deletions: 0 });
	};
	await page.goto("/?repo=foo/bar");

	// N’s own size
	await expect(row(page, "A").locator(".since-review")).toContainText("+780");
});

test("A refresh doesn’t compare 300 files again, since GitHub would list as many", async ({
	page,
	github,
}) => {
	detail(github, {
		A: { commits: { nodes: [commit("L"), commit("N")] }, reviews: { nodes: [review("L")] } },
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

test("A PR asked of the user’s team only shows no count of rounds, since the team’s requests are unknown", async ({
	page,
	github,
}) => {
	// No one asked the user by name, so GitHub’s search found the PR through a team
	await page.goto("/?repo=foo/bar");

	await expect(row(page, "A").locator(".iterations")).toHaveText("—");
});
