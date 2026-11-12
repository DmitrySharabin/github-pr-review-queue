/**
 * @typedef {object} Diff
 * @property {number} additions
 * @property {number} deletions
 * @property {string} url - The diff on GitHub
 * @property {string[]} [ranges] - `base...head` comparisons that add up to a count closer to exact than the sum of commits.
 * One per run of the author’s commits between merges of the base branch, which bring in other PRs’ changes
 * @property {string[]} [commits] - The commits to add up for the estimate, with {@link sizes}, until then no `additions` and `deletions`
 * @property {"unreviewed" | "force-pushed" | "older"} [whole] - Why the diff is the whole PR
 * @property {Pick<Diff, "additions" | "deletions">} [ignored] - With a pattern of ignored files, their lines, which `additions` and `deletions` leave out
 * @property {"too-many-files" | "unlisted" | "commits"} [unsplit] - With a pattern of ignored files, why they can’t be told apart, so `additions` and `deletions` count every file
 *
 * @typedef {"reviewer" | "author"} Role - Whose view of the PRs: `user` reviews them, or wrote them
 *
 * @typedef {object} View
 * @property {string} repo
 * @property {string} user
 * @property {Role | null} [role]
 * @property {string | null} [filter] - Narrows the search further, e.g. `label:foo -label:bar`
 * @property {string | null} [exclude] - A regular expression for the paths of files whose lines count apart, e.g. `test|\.lock$`
 *
 * @typedef {object} Reviewer
 * @property {string} name - The login
 * @property {string} avatar - The avatar URL
 * @property {"awaiting" | "approved" | "changes-requested" | "commented"} state
 * @property {string} url - Their latest review, or their profile while their review is awaited
 * @property {boolean} [earlier] - Approved an earlier version than the author’s last commit, which only the author’s view tells
 *
 * @typedef {object} Label
 * @property {string} name
 * @property {string} color - A hex color without `#`, e.g. `d73a4a`
 * @property {string | null} description
 *
 * @typedef {object} Summary
 * @property {number} number
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {string} avatar - The author’s avatar URL
 * @property {string} [association] - How the author relates to the repo, as GitHub’s `authorAssociation`, e.g. `MEMBER`
 * @property {Label[]} labels
 * @property {Date} [opened] - When the PR was opened, in the author’s view, where it says that instead of by whom
 * @property {boolean} [draft] - Whether the PR is a draft, in the author’s view, where an icon says so in place of the avatar
 * @property {Step} [step] - What the PR waits for, in the author’s view
 * @property {Diff} [diff] - The whole PR
 * @property {Diff} [diffSinceReview] - What the user has left to review, or the whole PR when that is unknown
 * @property {number | null} [iterations] - How many times review was asked for again after a review, `null` when unknown
 * @property {Date | null} [waitingSince] - The latest review request to the user, or for an author since when the PR waits for its {@link Step}
 * @property {Reviewer[]} [reviewers] - Everyone else asked to review it or who reviewed it, but teams
 * The optional ones are `undefined` until {@link details} arrive.
 *
 * @typedef {object} Step - Whose turn a PR is, and what they have to do
 * @property {"draft" | "request-review" | "await-review" | "resolve-conflicts" | "fix-checks" | "make-changes" | "re-request" | "reply" | "waiting" | "queued" | "auto-merge" | "checks-running" | "approved" | "await-merge"} name -
 * Stored with the queue, so a renamed step loses the queues stored before, which then wait for their load, e.g. `approved` for “Merge pull request”
 * @property {"author" | "others" | "nobody"} whose
 * @property {string[]} [logins] - The reviewers it names, e.g. those to ask for a review again
 * @property {number} [count] - How many conversations to reply to, or reviews to wait for
 * @property {string} [url] - Where on GitHub to do it, unless on the PR’s own page, e.g. its checks
 */

/**
 * GitHub search for the open PRs in `repo` that await a review from `user`, or that `user` wrote, e.g. for github.com/pulls?q=
 * @param {View} options
 * @returns {string}
 */
export function search ({ repo, user, role, filter }) {
	return `repo:${repo} is:pr is:open ${roleQualifier(role)}:${user} ${filter ?? ""}`.trim();
}

/** The qualifier that names a view’s user in its search, e.g. `author` in the author view */
function roleQualifier (role) {
	return role === "author" ? "author" : "review-requested";
}

/**
 * The user and filter of a view as GitHub’s pulls page shows them, e.g. `{ user: "b", filter: null }` for `{ user: "a", role: "author", filter: "author:b" }`.
 * The search joins the repeats of a qualifier with an OR, e.g. the PRs of both authors.
 * GitHub’s page keeps the last one instead. On a repo’s page, it ignores other repos.
 * In the reviewer view, `author:` picks the authors as the Author button does, e.g. `authors: "a,b"` for `author:a author:b`, in place of the picks before.
 * In the author view, the last picked author is the user
 * @param {Pick<View, "user" | "role" | "filter"> & { authors?: string | null }} view
 * @returns {Pick<View, "user" | "filter"> & { authors?: string | null }}
 */
// NOTE: A value that isn’t a login, e.g. `author:app/foo`, becomes the user all the same
export function normalize ({ user, role, filter, authors }) {
	let { values, rest } = qualifier(filter, roleQualifier(role));
	if (values.length > 0) {
		// `@me` is the signed-in user, as is no `user`
		user = values.at(-1) === "@me" ? null : values.at(-1);
	}

	// The author view’s PRs are all the user’s, so a picked author becomes the user, the last one as with `author:`, e.g. after a role switch.
	// A filter’s own `author:` is the newer choice
	if (role === "author") {
		let last = authors
			?.split(",")
			.filter(author => !author.startsWith("@"))
			.at(-1);
		if (last && values.length === 0) {
			user = last;
		}
		authors = null;
	}
	else {
		let found = qualifier(rest, "author");
		rest = found.rest;
		// A bot’s PRs name it without `app/`, e.g. `foo` for `author:app/foo`
		let logins = found.values.map(value => value.replace(/^app\//, ""));
		if (logins.length > 0) {
			authors = logins
				.filter((login, i) => logins.findIndex(other => isLogin(login, other)) === i)
				.join(",");
		}
	}

	// Other repos, closed PRs and issues, which the queue of open PRs in its repo leaves out
	for (let [name, value] of [["repo"], ["org"], ["user"], ["is", "closed|issue"]]) {
		rest = qualifier(rest, name, value).rest;
	}

	return { user, filter: rest || null, authors };
}

/**
 * The values of a qualifier in a filter, and the rest of the filter, e.g. `["a"]` and `-label:b is:draft` for `label` in `label:a -label:b is:draft`.
 * A negated one, e.g. `-label:b`, only narrows the search, so it stays in the rest.
 * @param {string | null} [filter]
 * @param {string} name
 * @param {string} [value] - A regular expression for the values to take, e.g. `closed|issue` for `is`, so `is:draft` stays
 * @returns {{ values: string[], rest: string }}
 */
// NOTE: A name inside a quoted phrase counts too, e.g. `label:a` in `"fix label:a"`, and a value with `"` in it breaks the term
function qualifier (filter, name, value = `"[^"]*"|\\S+`) {
	let values = [];
	let rest = (filter ?? "")
		.replace(new RegExp(`(^|\\s)${name}:(${value})`, "g"), (term, space, found) => {
			values.push(found.replace(/^"(.*)"$/, "$1"));
			return "";
		})
		.trim();
	return { values, rest };
}

/**
 * The regular expression a view’s `exclude` spells, e.g. `/test|\.lock$/` for `test|\.lock$`.
 * @param {string | null} [exclude]
 * @returns {RegExp | undefined} None for no pattern, or for one that isn’t a regular expression, e.g. `test(`
 */
export function pattern (exclude) {
	try {
		return exclude ? new RegExp(exclude) : undefined;
	}
	catch {}
}

/**
 * The filter for PRs with the label `name` instead of the labels it asks for, keeping the rest, e.g. `-label:wip label:"needs review"`.
 * @param {string | null} [filter]
 * @param {string} name
 * @returns {string}
 */
// NOTE: A name with `"` in it makes a broken term
export function withLabel (filter, name) {
	return `${qualifier(filter, "label").rest} label:"${name}"`.trim();
}

/**
 * The label that `next` adds to `filter`, when it changes nothing else, e.g. `bug` from `-label:wip` to `-label:wip label:"bug"`.
 * The PRs of `next` are then those of `filter` that have the label.
 * @param {string | null} [filter]
 * @param {string | null} [next]
 * @returns {string | undefined}
 */
export function addedLabel (filter, next) {
	let name = next?.match(/label:"([^"]*)"$/)?.[1];
	let narrowed = `${filter ?? ""} label:"${name}"`.trim();

	// withLabel() drops the labels `filter` asks for, which widens it, e.g. from `label:a` to `label:"b"`
	if (next === narrowed && withLabel(filter, name) === narrowed) {
		return name;
	}
}

/**
 * Whether a PR from {@link query} has the label `name`, which GitHub’s search matches in any case, e.g. `Bug` for `label:bug`.
 * @param {object} pr
 * @param {string} name
 * @returns {boolean}
 */
export function hasLabel (pr, name) {
	return pr.labels.nodes.some(label => label.name.toLowerCase() === name.toLowerCase());
}

/**
 * Whether the {@link details} of an earlier copy of a PR from {@link query} may be out of date:
 * a review, a review request or a force push changes `updatedAt`, a push the head commit.
 * @param {object} earlier
 * @param {object} pr
 * @returns {boolean}
 */
export function outdated (earlier, pr) {
	return earlier.updatedAt !== pr.updatedAt || earlier.headRefOid !== pr.headRefOid;
}

/**
 * GraphQL query for the PRs {@link search} finds, with the fields that are cheap to get.
 * @param {View} options
 * @returns {string}
 */
export function query ({ repo, user, role, filter }) {
	let [owner, name] = repo.split("/");

	// The search finds nothing for a repo or a user that does not exist, `repository` and `user` fail with an error instead.
	// `repository` also tells what the signed-in user may do in it, see turn()
	// NOTE: Gets only the first 100 PRs and their first 100 labels
	return `query {
	repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { viewerPermission }
	user(login: ${JSON.stringify(user)}) { id }
	search(type: ISSUE, first: 100, query: ${JSON.stringify(search({ repo, user, role, filter }))}) {
		nodes {
			... on PullRequest {
				id number title url createdAt updatedAt headRefOid isDraft authorAssociation
				author { login avatarUrl(size: 64) }
				labels(first: 100) { nodes { name color description } }
			}
		}
	}
}`;
}

/**
 * GraphQL query for the rest of what {@link summarize} needs, for a few PRs. These fields are the slow ones.
 * @param {{ user: string, role?: Role | null, exclude?: string | null, ids: string[] }} options
 * @returns {string}
 */
export function details ({ user, role, exclude, ids }) {
	// A reviewer needs their own reviews, to count what changed since. An author needs what decides whose turn it is, see turn(). The permission comes once, from query()
	let fields =
		role === "author"
			? `mergeable isInMergeQueue
			autoMergeRequest { enabledAt }
			statusCheckRollup { state }
			reviewThreads(last: 100) {
				nodes { isResolved comments(last: 1) { nodes { createdAt url author { __typename login } } } }
			}`
			: `reviews(author: ${JSON.stringify(user)}, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED], last: 100) {
				nodes { submittedAt author { login } commit { oid } }
			}`;

	// Only to tell ignored files apart, since they slow the query, e.g. 3.1 s instead of 1.4 s for 30 PRs.
	// `filename`, as a comparison names it, so split() reads both
	if (exclude) {
		fields += `
			files(first: 100) { totalCount nodes { filename: path additions deletions } }`;
	}

	// NOTE: Gets only the last 100 commits, review requests and conversations of each PR, the last 100 reviews of a reviewer, and 20 other reviewers
	return `query {
	nodes(ids: ${JSON.stringify(ids)}) {
		... on PullRequest {
			id additions deletions
			${fields}
			timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 100) {
				nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on Actor { login } } } }
			}
			commits(last: 100) {
				totalCount
				nodes { commit { id oid parents { totalCount } } }
			}
			reviewRequests(first: 20) {
				nodes { requestedReviewer { __typename ... on Actor { login avatarUrl(size: 48) } } }
			}
			latestReviews(first: 20) {
				nodes { state url submittedAt author { __typename login avatarUrl(size: 48) } }
			}
			latestOpinionatedReviews(first: 20) {
				nodes { state url submittedAt commit { oid } author { __typename login avatarUrl(size: 48) } }
			}
		}
	}
}`;
}

/**
 * GraphQL query for the sizes of commits, e.g. of a {@link Diff}’s `commits`.
 * They are apart from {@link details}, since their sizes are the slowest field, e.g. 1–2 s for the last 100 commits of a PR, and a PR needs few of them.
 * @param {string[]} ids - At most 100
 * @returns {string}
 */
export function sizes (ids) {
	return `query {
	nodes(ids: ${JSON.stringify(ids)}) { ... on Commit { additions deletions } }
}`;
}

/**
 * Summarize a PR from the point of view of its reviewer or its author.
 * @param {object} pr - A node from {@link query}, with the fields from {@link details} once they arrive
 * @param {string} user - The reviewer’s or the author’s login
 * @param {Role | null} [role]
 * @param {RegExp} [ignore] - The paths of files whose lines count apart, see {@link Diff}’s `ignored`
 * @returns {Summary}
 */
export function summarize (pr, user, role, ignore) {
	let summary = {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		author: pr.author?.login ?? "ghost",
		avatar: pr.author?.avatarUrl ?? "https://github.com/ghost.png",
		association: pr.authorAssociation,
		labels: pr.labels.nodes,
	};
	if (role === "author") {
		summary.opened = new Date(pr.createdAt);
		summary.draft = pr.isDraft;
	}

	if (!pr.commits) {
		return summary;
	}

	let others = reviewers(pr).filter(reviewer => !isLogin(reviewer.name, user));
	return {
		...summary,
		reviewers: others,
		...(role === "author" ? forAuthor(pr, user, others) : forReviewer(pr, user, ignore)),
	};
}

/** Most comparisons a PR’s count since a review takes, one per run of the author’s commits. More add up the sizes of the commits instead */
const compareLimit = 5;

/** What a reviewer sees of a PR: what is left to review, and since when it waits for them. */
function forReviewer (pr, user, ignore) {
	let isUser = login => isLogin(login, user);
	// A reviewer whom no pending request names found the PR through a team, whose requests need the read:org scope.
	// Then the user’s requests in the timeline are older ones, answered by a review or withdrawn.
	// NOTE: Reads only the first 20 pending requests, so on a PR with more the user’s may be missed
	let viaTeam = !pr.reviewRequests.nodes.some(node => isUser(node.requestedReviewer?.login));
	let requests = viaTeam
		? []
		: pr.timelineItems.nodes.filter(event => isUser(event.requestedReviewer?.login));
	let reviews = pr.reviews.nodes;
	let waitingSince = requests.length > 0 ? new Date(requests.at(-1).createdAt) : null;
	let commits = pr.commits.nodes.map(node => node.commit);
	// A review clears the request, so a reviewer’s one after the latest request is only a reply in a thread
	let review = reviews.findLast(
		review => !waitingSince || new Date(review.submittedAt) < waitingSince,
	);
	// GitHub answers no commit for one it no longer has, e.g. after a force push
	let reviewed = review?.commit?.oid;
	let index = commits.findIndex(commit => commit.oid === reviewed);
	let since = commits.slice(index + 1);
	// Merges of the base branch bring in other PRs’ changes, e.g. +32,997 lines on a +729 PR
	let own = since.filter(commit => commit.parents.totalCount === 1);
	// Each run of the author’s commits compares from the commit before it, the reviewed one or a merge.
	// A sum of commits counts a line again each time a commit rewrites it, e.g. +734 −680 for runs of +97 −43
	let runs = [];
	for (let [i, commit] of since.entries()) {
		let before = since[i - 1];
		if (commit.parents.totalCount > 1) {
			continue;
		}

		if (before?.parents.totalCount === 1) {
			runs.at(-1).head = commit.oid;
		}
		else {
			runs.push({ base: before?.oid ?? reviewed, head: commit.oid });
		}
	}

	let diff = { additions: pr.additions, deletions: pr.deletions, url: `${pr.url}/changes` };
	if (ignore) {
		// NOTE: A PR of over 3000 files counts them all, as GitHub lists no more, see listFiles()
		Object.assign(
			diff,
			pr.files && pr.files.totalCount === pr.files.nodes.length
				? split(pr.files.nodes, ignore)
				: { unsplit: pr.files?.totalCount > 3000 ? "too-many-files" : "unlisted" },
		);
	}

	return {
		diff,
		diffSinceReview:
			index === -1
				? {
						...diff,
						whole: !review
							? "unreviewed"
							: reviewed && pr.commits.totalCount > commits.length
								? "older"
								: "force-pushed",
					}
				: {
						...(own.length > 0
							? { commits: own.map(commit => commit.id) }
							: { additions: 0, deletions: 0 }),
						url: `${pr.url}/changes/${reviewed}..${commits.at(-1).oid}`,
						ranges:
							runs.length > 0 && runs.length <= compareLimit
								? runs.map(run => `${run.base}...${run.head}`)
								: undefined,
					},
		// A round is a request that follows a review. Requests with no review between them add no round
		iterations: viaTeam
			? null
			: requests.filter((request, i) =>
					reviews.some(
						review =>
							review.submittedAt < request.createdAt &&
							review.submittedAt > (requests[i - 1]?.createdAt ?? ""),
					)).length,
		waitingSince,
	};
}

/** What an author sees of a PR: its next step, since when it waits for it, and which approvals predate the author’s last commit. */
function forAuthor (pr, user, others) {
	let { since = null, ...step } = turn(pr, user);
	step.whose = whose[step.name] ?? "author";
	let earlier = pr.latestOpinionatedReviews.nodes
		.filter(review => review.state === "APPROVED" && pushedSince(pr, review.commit?.oid))
		.map(review => review.author?.login);

	return {
		step,
		waitingSince: since,
		reviewers: others.map(reviewer =>
			reviewer.state === "approved" && earlier.includes(reviewer.name)
				? { ...reviewer, earlier: true }
				: reviewer),
	};
}

/** GitHub’s repository permissions, each with more access than the one before */
const permissions = ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"];

/** Whose turn each step is, where it isn’t the author’s */
const whose = {
	draft: "nobody",
	"await-review": "others",
	waiting: "others",
	queued: "others",
	"auto-merge": "others",
	"checks-running": "others",
	"await-merge": "others",
};

/**
 * What a PR’s author or others have to do next, from {@link details} for its author and the repository’s permission from {@link query}. One step per PR, the first of these that applies.
 * A pending review request decides the turn, not the order of events. A reviewer asked again after they requested changes has the turn.
 * @param {object} pr
 * @param {string} user - The author’s login
 * @returns {Omit<Step, "whose"> & { since?: Date | null }} With `since`, when the PR started to wait for it. Only reviews and requests give that time, so a conflict has none
 */
function turn (pr, user) {
	// Bots, e.g. Copilot, review when asked and never wait for the author. A deleted account has no login
	let human = actor =>
		Boolean(actor?.login) && actor.__typename !== "Bot" && !isLogin(actor.login, user);
	// A step that names the reviewers of these reviews, and waits since the oldest
	let naming = (name, reviews) => ({
		name,
		logins: reviews.map(review => review.author.login),
		since: oldest(reviews.map(review => review.submittedAt)),
	});

	if (pr.isDraft) {
		return { name: "draft" };
	}

	// GitHub lets triage access request reviewers, and write access merge. An author without them waits for a maintainer.
	// NOTE: The permission is the signed-in user’s, so someone else’s view shows the steps as if that user wrote the PRs
	let access = permissions.indexOf(pr.repository.viewerPermission);

	// A team the token can’t see comes as `null`, or with no login, so its request counts but names no one
	let requested = pr.reviewRequests.nodes
		.map(node => node.requestedReviewer)
		.filter(reviewer => reviewer?.__typename !== "Bot");
	let asked = requested.map(reviewer => reviewer?.login).filter(Boolean);
	let unasked = actor => human(actor) && !asked.includes(actor.login);
	// Everyone who reviewed has a latest review, a dismissed one too. Its reviewer is asked again below
	let reviewed = pr.latestReviews.nodes.some(review => human(review.author));

	if (requested.length === 0 && !reviewed) {
		return {
			name: access >= permissions.indexOf("TRIAGE") ? "request-review" : "await-review",
		};
	}

	// UNKNOWN, while GitHub still computes it, counts as no conflict. The next Refresh asks again
	if (pr.mergeable === "CONFLICTING") {
		return { name: "resolve-conflicts" };
	}

	let checks = pr.statusCheckRollup?.state;
	if (checks === "FAILURE" || checks === "ERROR") {
		return { name: "fix-checks", url: `${pr.url}/checks` };
	}

	let opinions = pr.latestOpinionatedReviews.nodes.filter(review => unasked(review.author));
	let changes = opinions.filter(review => review.state === "CHANGES_REQUESTED");
	let unchanged = changes.filter(review => !pushedSince(pr, review.commit?.oid));
	// Links to a review that asks for the changes, as GitHub has no page to make them on
	if (unchanged.length > 0) {
		return {
			name: "make-changes",
			url: unchanged[0].url,
			since: oldest(unchanged.map(review => review.submittedAt)),
		};
	}

	// A dismissed review no longer counts, so its reviewer is asked again, as after changes pushed since a request
	let dismissed = pr.latestReviews.nodes.filter(
		review => review.state === "DISMISSED" && unasked(review.author),
	);
	if (changes.length + dismissed.length > 0) {
		return naming("re-request", [...changes, ...dismissed]);
	}

	// A conversation waits for the author when someone else spoke last. A reviewer who is asked to review again answers it in that review
	let unanswered = pr.reviewThreads.nodes
		.filter(thread => !thread.isResolved)
		.map(thread => thread.comments.nodes.at(-1))
		.filter(comment => unasked(comment?.author));
	if (unanswered.length > 0) {
		return {
			name: "reply",
			count: unanswered.length,
			url: unanswered[0].url,
			since: oldest(unanswered.map(comment => comment.createdAt)),
		};
	}

	if (requested.length > 0) {
		// A team’s request matches the latest event that names no one either
		let requestedAt = login =>
			pr.timelineItems.nodes.findLast(
				event => (event.requestedReviewer?.login ?? null) === login,
			)?.createdAt;
		return {
			name: "waiting",
			logins: asked,
			count: requested.length,
			since: oldest(requested.map(reviewer => requestedAt(reviewer?.login ?? null))),
		};
	}

	if (pr.isInMergeQueue) {
		return { name: "queued" };
	}

	// NOTE: Without reviewDecision, which is slow to ask for, the app can’t tell how many approvals the repo requires, so GitHub may still refuse the merge
	let approvals = opinions.filter(review => review.state === "APPROVED");
	// GitHub merges it on its own once the checks pass. Without an approval, the steps below decide, e.g. a review to ask for again
	if (approvals.length > 0 && pr.autoMergeRequest) {
		return { name: "auto-merge", since: new Date(pr.autoMergeRequest.enabledAt) };
	}

	// Before an approval, since GitHub merges only once the checks pass
	if (checks === "PENDING" || checks === "EXPECTED") {
		return { name: "checks-running" };
	}

	if (approvals.length > 0) {
		// Waits since the last of them approved
		return {
			name: access >= permissions.indexOf("WRITE") ? "approved" : "await-merge",
			since: new Date(Math.max(...approvals.map(review => new Date(review.submittedAt)))),
		};
	}

	// Reviewers who only commented, e.g. after the author replied to their conversations
	return naming(
		"re-request",
		pr.latestReviews.nodes.filter(review => unasked(review.author)),
	);
}

/**
 * Whether the author pushed a commit after `oid`, e.g. after a review of it. Merges of the base branch bring in others’ commits, so they don’t count.
 * A commit the PR no longer has, e.g. after a force push, or one before the last 100, counts as pushed since.
 */
function pushedSince (pr, oid) {
	let commits = pr.commits.nodes.map(node => node.commit);
	let index = commits.findIndex(commit => commit.oid === oid);
	return index === -1 || commits.slice(index + 1).some(commit => commit.parents.totalCount === 1);
}

/** The earliest of these times from GitHub, e.g. `createdAt`, or `null` when none is known. */
function oldest (times) {
	let dates = times.filter(Boolean).map(time => new Date(time));
	return dates.length > 0 ? new Date(Math.min(...dates)) : null;
}

/** Whether two logins are the same, which GitHub matches in any case. */
export function isLogin (login, other) {
	return login?.toLowerCase() === other.toLowerCase();
}

const states = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
};

/**
 * The latest say of everyone on a PR, from {@link details}.
 * @param {object} pr
 * @returns {Reviewer[]}
 */
function reviewers (pr) {
	let found = new Map();

	// Later entries win. So an approval outranks a comment after it, and a pending request outranks any review
	let reviews = [...pr.latestReviews.nodes, ...pr.latestOpinionatedReviews.nodes];
	for (let { state, url, author } of reviews) {
		// A dismissed review says nothing anymore. A deleted account has no author
		if (states[state] && author) {
			found.set(author.login, {
				name: author.login,
				avatar: author.avatarUrl,
				state: states[state],
				url,
			});
		}
	}

	for (let { requestedReviewer: reviewer } of pr.reviewRequests.nodes) {
		// NOTE: Skips teams, whose fields need the read:org scope. The sign-in doesn’t ask for it
		if (reviewer?.login) {
			found.set(reviewer.login, {
				name: reviewer.login,
				avatar: reviewer.avatarUrl,
				state: "awaiting",
				url: `https://github.com/${reviewer.login}`,
			});
		}
	}

	return [...found.values()];
}

/**
 * Total of several diffs, e.g. of commits or of the files in a comparison.
 * Over commits, it is an estimate, since a line that two commits change counts twice.
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

/**
 * The lines of these files, the ones whose paths match `ignore` apart, e.g. of a comparison or of a PR’s {@link details}.
 * @param {{ filename: string, additions: number, deletions: number }[]} files
 * @param {RegExp} ignore
 * @returns {Pick<Diff, "additions" | "deletions" | "ignored">}
 */
export function split (files, ignore) {
	return {
		...sum(files.filter(file => !ignore.test(file.filename))),
		ignored: sum(files.filter(file => ignore.test(file.filename))),
	};
}

/**
 * How many lines a diff changes, e.g. 12 for +10 −2.
 * @param {Diff} diff
 * @returns {number}
 */
export function size (diff) {
	return diff.additions + diff.deletions;
}
