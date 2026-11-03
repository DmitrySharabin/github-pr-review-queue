/**
 * @typedef {{ additions: number, deletions: number, url: string }} Diff
 *
 * @typedef {object} Summary
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {string} avatar - The author’s avatar URL
 * @property {Diff} diff - The whole PR
 * @property {Diff | null} diffSinceReview - `null` when the user has not reviewed it
 * @property {number} iterations - How many times the user was asked to review it
 * @property {Date | null} waitingSince - The latest review request to the user
 */

/**
 * GraphQL query for the open PRs in `repo` that await a review from `user`.
 * @param {{ repo: string, user: string }} options
 * @returns {string}
 */
export function query ({ repo, user }) {
	let search = `repo:${repo} is:pr is:open review-requested:${user}`;
	let [owner, name] = repo.split("/");

	// The search finds nothing in a repo that does not exist, `repository` fails with an error instead
	// NOTE: Gets only the first 100 PRs, and the last 100 commits and review requests of each
	return `query {
	repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { id }
	search(type: ISSUE, first: 100, query: ${JSON.stringify(search)}) {
		nodes {
			... on PullRequest {
				number title url additions deletions
				author { login avatarUrl(size: 64) }
				reviews(author: ${JSON.stringify(user)}, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED], last: 1) {
					nodes { commit { oid } }
				}
				timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 100) {
					nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
				}
				commits(last: 100) {
					nodes { commit { oid additions deletions parents { totalCount } } }
				}
			}
		}
	}
}`;
}

/**
 * Summarize a PR returned by {@link query} from the point of view of its reviewer.
 * @param {object} pr - A search result node
 * @param {string} user - The reviewer’s login
 * @returns {Summary}
 */
export function summarize (pr, user) {
	// NOTE: Requests to a team the user is in are not counted
	let requests = pr.timelineItems.nodes.filter(event => event.requestedReviewer?.login?.toLowerCase() === user.toLowerCase());
	let commits = pr.commits.nodes.map(node => node.commit);
	let reviewed = pr.reviews.nodes[0]?.commit.oid;
	// NOTE: -1 also when a force push removed the reviewed commit
	let index = reviewed ? commits.findIndex(commit => commit.oid === reviewed) : -1;

	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		author: pr.author?.login ?? "ghost",
		avatar: pr.author?.avatarUrl ?? "https://github.com/ghost.png",
		diff: { additions: pr.additions, deletions: pr.deletions, url: `${pr.url}/changes` },
		diffSinceReview: index === -1 ? null : {
			...sum(commits.slice(index + 1)),
			url: `${pr.url}/changes/${reviewed}..${commits.at(-1).oid}`,
		},
		iterations: requests.length,
		waitingSince: requests.length > 0 ? new Date(requests.at(-1).createdAt) : null,
	};
}

/**
 * Total diff of the author’s own commits.
 * Merge commits are skipped: merging the base branch brings in other PRs’ changes,
 * e.g. one merge of `main` added +32,997 lines to a +729 PR.
 * @param {object[]} commits
 * @returns {Omit<Diff, "url">}
 */
function sum (commits) {
	let diff = { additions: 0, deletions: 0 };

	for (let commit of commits) {
		if (commit.parents.totalCount === 1) {
			diff.additions += commit.additions;
			diff.deletions += commit.deletions;
		}
	}

	return diff;
}
