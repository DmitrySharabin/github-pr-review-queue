/**
 * @import { Diff } from "./pull-request.js"
 * @import { Row } from "./row.js"
 * @import { Queue } from "./screen.js"
 */
import { details, pattern, sizes, split, sum, summarize } from "./pull-request.js";
import { nodes, rest } from "./github.js";
import { fill, unmark } from "./row.js";
import { showProgress } from "./status.js";

/**
 * Fill in the slow fields of these rows, a few PRs per query, and count them on the progress bar.
 * A failed query leaves its rows as they were, and the others fill in still.
 * @param {Row[]} stale
 * @param {Queue} queue - The load’s
 * @param {AbortSignal} signal - The load’s
 * @returns {Promise<PromiseRejectedResult | undefined>} The first failure, if any
 */
export async function fillDetails (stale, { view: { repo, role, exclude }, user }, signal) {
	// Rows with details on screen already are rechecked, e.g. on a refresh
	let task = stale.some(row => row.detailed) ? "rechecked" : "loaded";
	if (stale.length > 0) {
		showProgress(task, 0, stale.length);
	}

	// An author’s view counts no lines.
	// NOTE: A pattern that isn’t a regular expression, e.g. typed into the URL, ignores nothing.
	// One that backtracks a lot, e.g. `(.+)+x$`, freezes the tab, as it runs on every path
	let ignore = role === "author" ? undefined : pattern(exclude);
	let done = 0;
	// GitHub stops a query that runs too long, so each asks for a few PRs
	let size = 10;
	let batches = Array.from({ length: Math.ceil(stale.length / size) }, (_, i) =>
		stale.slice(i * size, (i + 1) * size));

	// Each row settles apart, e.g. one whose commit sizes failed. A batch that failed fails each of its rows
	let results = await Promise.allSettled(
		batches.flatMap(batch => {
			let prs = nodes(
				ids => details({ user, role, exclude: ignore && exclude, ids }),
				batch.map(row => row.pr.id),
				signal,
			);
			return batch.map(async row => {
				let pr = (await prs).find(pr => pr?.id === row.pr.id);
				// Rows a newer load owns, e.g. after a role switch
				if (signal.aborted) {
					return;
				}

				// GitHub answers null for a PR deleted since the search. Its row has nothing to fill, and the next search drops it
				if (!pr) {
					showProgress(task, ++done, stale.length);
					return;
				}

				pr = { ...row.pr, ...pr };
				await listFiles(repo, pr, signal);
				let summary = summarize(pr, user, role, ignore);
				await count(repo, summary.diffSinceReview, signal, ignore);
				// A newer load may have started during the count
				if (signal.aborted) {
					return;
				}

				// The search may have refreshed the cheap fields during the count, e.g. a new title.
				// Undimmed first, the row equals its render when nothing changed, and keeps focus
				if (row.tr.classList.contains("stale")) {
					unmark(row.tr);
				}
				fill(row, { ...summary, ...summarize(row.pr, user, role) });
				row.detailed = row.pr;
				showProgress(task, ++done, stale.length);
			});
		}),
	);
	return results.find(result => result.status === "rejected");
}

/**
 * Count a diff that summarize() left uncounted, if any. An author’s summary has none. One with ranges to compare counts closer to exact, others by the sizes of their commits.
 * @param {string} repo
 * @param {Diff} [diff]
 * @param {AbortSignal} signal - The load’s
 * @param {RegExp} [ignore] - The paths of files whose lines a comparison counts apart. The sizes of commits can’t
 */
async function count (repo, diff, signal, ignore) {
	let { ranges } = diff ?? {};
	if (ranges) {
		// The ranges go before the try. A failure sets `failed` below, so the next load compares again. A comparison of 300 files does not
		delete diff.ranges;
		try {
			// NOTE: A failed comparison leaves the PR’s others running until they answer or time out
			let comparisons = await Promise.all(
				ranges.map(range => rest(`repos/${repo}/compare/${range}`, signal)),
			);
			// GitHub lists at most 300 files, so a comparison of 300 may leave some out
			if (comparisons.every(({ files }) => files.length < 300)) {
				let files = comparisons.flatMap(({ files }) => files);
				Object.assign(diff, ignore ? split(files, ignore) : sum(files));
				delete diff.commits;
				return;
			}
		}
		catch (error) {
			signal.throwIfAborted();
			// One failed comparison should not hide the queue, so the commits’ sizes estimate the count instead
			// NOTE: A refresh whose comparison fails, or succeeds after one that failed, marks the cell as changed
			console.warn(
				`Couldn’t compare ${ranges.join(", ")}, adding up its commits instead.`,
				error,
			);
			diff.failed = true;
		}
	}

	if (diff?.commits) {
		// Commits don’t list their files
		Object.assign(
			diff,
			sum(await nodes(sizes, diff.commits, signal)),
			ignore && { unsplit: "commits" },
		);
		delete diff.commits;
	}
}

/**
 * List all files of a PR whose details hold only the first 100, so its lines split by a pattern.
 * GitHub lists at most 3000 files of a PR, so a PR of more keeps the 100 and counts every file.
 * @param {string} repo
 * @param {object} pr - A node from details(), with the PR’s `number` from the search
 * @param {AbortSignal} signal - The load’s
 */
async function listFiles (repo, pr, signal) {
	let { totalCount, nodes } = pr.files ?? {};
	if (!(nodes?.length < totalCount && totalCount <= 3000)) {
		return;
	}

	// NOTE: A failed page leaves the PR’s others running until they answer or time out
	try {
		// Pages by number, not by the next one’s link, so they load at once
		let pages = await Promise.all(
			Array.from({ length: Math.ceil(totalCount / 100) }, (_, i) =>
				rest(`repos/${repo}/pulls/${pr.number}/files?per_page=100&page=${i + 1}`, signal)),
		);
		pr.files.nodes = pages.flat();
	}
	catch (error) {
		signal.throwIfAborted();
		// The first 100 files can’t split the lines, so the cell counts every file instead
		console.warn(`Couldn’t list the files of #${pr.number}, counting all of them.`, error);
	}
}
