/**
 * @typedef {object} Diff
 * @property {number} additions
 * @property {number} deletions
 * @property {string} url - The diff on GitHub
 * @property {string} [range] - `base...head` to compare for an exact count, when the sum of commits is only an estimate
 * @property {"unreviewed" | "force-pushed"} [whole] - Why the diff is the whole PR
 *
 * @typedef {"reviewer" | "author"} Role - Whose view of the PRs: `user` reviews them, or wrote them
 *
 * @typedef {object} View
 * @property {string} repo
 * @property {string} user
 * @property {Role | null} [role]
 * @property {string | null} [filter] - Narrows the search further, e.g. `label:foo -label:bar`
 *
 * @typedef {object} Reviewer
 * @property {string} name - The login
 * @property {string} avatar - The avatar URL
 * @property {"awaiting" | "approved" | "changes-requested" | "commented"} state
 * @property {string} url - Their latest review, or their profile while their review is awaited
 *
 * @typedef {object} Summary
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {string} avatar - The author’s avatar URL
 * @property {Diff} diff - The whole PR
 * @property {Diff} [diffSinceReview] - What the user has left to review, or the whole PR when that is unknown
 * @property {number} [iterations] - How many times review was asked for again after a review
 * @property {Date | null} [waitingSince] - The latest review request to the user, or for an author to anyone
 * @property {Reviewer[]} [reviewers] - Everyone else asked to review it or who reviewed it, but teams
 * The optional ones are `undefined` until {@link details} arrive.
 */

/**
 * GitHub search for the open PRs in `repo` that await a review from `user`, or that `user` wrote, e.g. for github.com/pulls?q=
 * @param {View} options
 * @returns {string}
 */
export function search ({ repo, user, role, filter }) {
	let qualifier = role === "author" ? "author" : "review-requested";
	return `repo:${repo} is:pr is:open ${qualifier}:${user} ${filter ?? ""}`.trim();
}

/**
 * GraphQL query for the PRs {@link search} finds, with the fields that are cheap to get.
 * @param {View} options
 * @returns {string}
 */
export function query ({ repo, user, role, filter }) {
	let [owner, name] = repo.split("/");

	// The search finds nothing for a repo or a user that does not exist, `repository` and `user` fail with an error instead
	// NOTE: Gets only the first 100 PRs
	return `query {
	repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { id }
	user(login: ${JSON.stringify(user)}) { id }
	search(type: ISSUE, first: 100, query: ${JSON.stringify(search({ repo, user, role, filter }))}) {
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
 * @param {{ user: string, role?: Role | null, ids: string[] }} options
 * @returns {string[]}
 */
export function details ({ user, role, ids }) {
	let size = 10;
	let batches = Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));

	// A reviewer needs only their own reviews, an author everyone else’s
	let byUser = role === "author" ? "" : `author: ${JSON.stringify(user)}, `;

	// NOTE: Gets only the last 100 commits, reviews and review requests of each PR, and 20 other reviewers
	return batches.map(batch => `query {
	nodes(ids: ${JSON.stringify(batch)}) {
		... on PullRequest {
			id
			reviews(${byUser}states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED], last: 100) {
				nodes { submittedAt author { login } commit { oid } }
			}
			timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 100) {
				nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on Actor { login } } } }
			}
			commits(last: 100) {
				nodes { commit { oid additions deletions parents { totalCount } } }
			}
			reviewRequests(first: 20) {
				nodes { requestedReviewer { ... on Actor { login avatarUrl(size: 48) } } }
			}
			latestReviews(first: 20) {
				nodes { state url author { login avatarUrl(size: 48) } }
			}
			latestOpinionatedReviews(first: 20) {
				nodes { state url author { login avatarUrl(size: 48) } }
			}
		}
	}
}`);
}

/**
 * Summarize a PR from the point of view of its reviewer or its author.
 * @param {object} pr - A node from {@link query}, with the fields from {@link details} once they arrive
 * @param {string} user - The reviewer’s or the author’s login
 * @param {Role | null} [role]
 * @returns {Summary}
 */
export function summarize (pr, user, role) {
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

	let authorView = role === "author";
	let isUser = login => login?.toLowerCase() === user.toLowerCase();
	// An author waits on everyone they asked. NOTE: Requests to a team are not counted
	let requests = pr.timelineItems.nodes.filter(event => authorView ? event.requestedReviewer?.login : isUser(event.requestedReviewer?.login));
	// The author’s own reviews are replies to the others
	let reviews = authorView ? pr.reviews.nodes.filter(review => !isUser(review.author?.login)) : pr.reviews.nodes;
	let waitingSince = requests.length > 0 ? new Date(requests.at(-1).createdAt) : null;
	let commits = pr.commits.nodes.map(node => node.commit);
	// A review clears the request, so a reviewer’s one after the latest request is only a reply in a thread
	let reviewed = reviews.findLast(review => authorView || !waitingSince || new Date(review.submittedAt) < waitingSince)?.commit.oid;
	// NOTE: -1 also when the reviewed commit is older than the last 100, which then reads as a force push
	let index = commits.findIndex(commit => commit.oid === reviewed);
	let since = commits.slice(index + 1);
	// Merges of the base branch bring in other PRs’ changes, e.g. +32,997 lines on a +729 PR
	let own = since.filter(commit => commit.parents.totalCount === 1);
	// Comparing up to the author’s last commit is exact while no merge comes before it
	let last = own.at(-1);
	let exact = last && since.indexOf(last) === own.length - 1;

	return {
		...summary,
		diffSinceReview: index === -1 ? { ...summary.diff, whole: reviewed ? "force-pushed" : "unreviewed" } : {
			...sum(own),
			url: `${pr.url}/changes/${reviewed}..${commits.at(-1).oid}`,
			range: exact ? `${reviewed}...${last.oid}` : undefined,
		},
		// A round is a request that follows a review: requests with no review between them add none
		iterations: requests.filter((request, i) => reviews.some(review =>
			review.submittedAt < request.createdAt && review.submittedAt > (requests[i - 1]?.createdAt ?? ""))).length,
		waitingSince,
		reviewers: reviewers(pr).filter(reviewer => !isUser(reviewer.name)),
	};
}

const states = { APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", COMMENTED: "commented" };

/**
 * The latest say of everyone on a PR, from {@link details}.
 * @param {object} pr
 * @returns {Reviewer[]}
 */
function reviewers (pr) {
	let found = new Map();

	// Later entries win: an approval outranks a comment after it, and a pending request outranks any review
	let reviews = [...pr.latestReviews.nodes, ...pr.latestOpinionatedReviews.nodes];
	for (let { state, url, author } of reviews) {
		// A dismissed review says nothing anymore. A deleted account has no author
		if (states[state] && author) {
			found.set(author.login, { name: author.login, avatar: author.avatarUrl, state: states[state], url });
		}
	}

	for (let { requestedReviewer: reviewer } of pr.reviewRequests.nodes) {
		// NOTE: Skips teams: their fields need the read:org scope, which the sign-in doesn’t ask for
		if (reviewer?.login) {
			found.set(reviewer.login, { name: reviewer.login, avatar: reviewer.avatarUrl, state: "awaiting", url: `https://github.com/${reviewer.login}` });
		}
	}

	return [...found.values()];
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
