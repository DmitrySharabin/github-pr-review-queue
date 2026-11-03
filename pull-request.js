/**
 * @typedef {object} Diff
 * @property {number} additions
 * @property {number} deletions
 * @property {string} url - The diff on GitHub
 * @property {string} [range] - `base...head` to compare for an exact count, when the sum of commits is only an estimate
 *
 * @typedef {object} Summary
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {string} avatar - The author’s avatar URL
 * @property {Diff} diff - The whole PR
 * @property {Diff | null} [diffSinceReview] - `null` when the user has not reviewed it
 * @property {number} [iterations] - How many times the user was asked to review it
 * @property {Date | null} [waitingSince] - The latest review request to the user
 * The optional ones are `undefined` until {@link details} arrive.
 */

/**
 * GitHub search for the open PRs in `repo` that await a review from `user`, e.g. for github.com/pulls?q=
 * @param {{ repo: string, user: string }} options
 * @returns {string}
 */
export function search ({ repo, user }) {
	return `repo:${repo} is:pr is:open review-requested:${user}`;
}

/**
 * GraphQL query for the PRs {@link search} finds, with the fields that are cheap to get.
 * @param {{ repo: string, user: string }} options
 * @returns {string}
 */
export function query ({ repo, user }) {
	let [owner, name] = repo.split("/");

	// The search finds nothing for a repo or a user that does not exist, `repository` and `user` fail with an error instead
	// NOTE: Gets only the first 100 PRs
	return `query {
	repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { id }
	user(login: ${JSON.stringify(user)}) { id }
	search(type: ISSUE, first: 100, query: ${JSON.stringify(search({ repo, user }))}) {
		nodes {
			... on PullRequest {
				id number title url additions deletions
				author { login avatarUrl(size: 64) }
			}
		}
	}
}`;
}

/**
 * GraphQL queries for the rest of what {@link summarize} needs, a few PRs each:
 * GitHub stops a query that runs too long, and these fields are the slow ones.
 * @param {{ user: string, ids: string[] }} options
 * @returns {string[]}
 */
export function details ({ user, ids }) {
	let size = 10;
	let batches = Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));

	// NOTE: Gets only the last 100 commits, reviews and review requests of each PR
	return batches.map(batch => `query {
	nodes(ids: ${JSON.stringify(batch)}) {
		... on PullRequest {
			id
			reviews(author: ${JSON.stringify(user)}, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED], last: 100) {
				nodes { submittedAt commit { oid } }
			}
			timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 100) {
				nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
			}
			commits(last: 100) {
				nodes { commit { oid additions deletions parents { totalCount } } }
			}
		}
	}
}`);
}

/**
 * Summarize a PR from the point of view of its reviewer.
 * @param {object} pr - A node from {@link query}, with the fields from {@link details} once they arrive
 * @param {string} user - The reviewer’s login
 * @returns {Summary}
 */
export function summarize (pr, user) {
	let summary = {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		author: pr.author?.login ?? "ghost",
		avatar: pr.author?.avatarUrl ?? "https://github.com/ghost.png",
		diff: { additions: pr.additions, deletions: pr.deletions, url: `${pr.url}/changes` },
	};

	if (!pr.commits) {
		return summary;
	}

	// NOTE: Requests to a team the user is in are not counted
	let requests = pr.timelineItems.nodes.filter(event => event.requestedReviewer?.login?.toLowerCase() === user.toLowerCase());
	let waitingSince = requests.length > 0 ? new Date(requests.at(-1).createdAt) : null;
	let commits = pr.commits.nodes.map(node => node.commit);
	// A review clears the request, so one after the latest request is only a reply in a thread
	let reviewed = pr.reviews.nodes.findLast(review => !waitingSince || new Date(review.submittedAt) < waitingSince)?.commit.oid;
	// NOTE: -1 also when a force push removed the reviewed commit
	let index = commits.findIndex(commit => commit.oid === reviewed);
	let since = commits.slice(index + 1);
	// Merges of the base branch bring in other PRs’ changes, e.g. +32,997 lines on a +729 PR
	let own = since.filter(commit => commit.parents.totalCount === 1);
	// Comparing up to the author’s last commit is exact while no merge comes before it
	let last = own.at(-1);
	let exact = last && since.indexOf(last) === own.length - 1;

	return {
		...summary,
		diffSinceReview: index === -1 ? null : {
			...sum(own),
			url: `${pr.url}/changes/${reviewed}..${commits.at(-1).oid}`,
			range: exact ? `${reviewed}...${last.oid}` : undefined,
		},
		iterations: requests.length,
		waitingSince,
	};
}

/**
 * Total of several diffs, e.g. of commits or of the files in a comparison.
 * Over commits, it is an estimate: a line that two commits change counts twice.
 * @param {{ additions: number, deletions: number }[]} diffs
 * @returns {Pick<Diff, "additions" | "deletions">}
 */
export function sum (diffs) {
	let total = { additions: 0, deletions: 0 };

	for (let diff of diffs) {
		total.additions += diff.additions;
		total.deletions += diff.deletions;
	}

	return total;
}
