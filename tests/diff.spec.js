import { test, expect } from "./github.js";

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
