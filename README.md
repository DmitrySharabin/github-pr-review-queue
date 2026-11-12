# GitHub PR review queue

A web page that shows which pull requests in a GitHub repo wait for your review, and what changed since you last looked.
It runs in the browser, with no build step and no server of its own.

## Features at a glance

- **Your review queue**: the open PRs in one repo that wait for your review. You can also open another user’s queue.
- **Your own PRs**: the author view shows whose turn each PR is and what to do next. A button opens the GitHub page for that step. The view also shows how long each PR has waited and which approvals came before your last commit.
- **Only what is new to you**: each PR shows the changes since your last review, so a re-review starts where you left off.
- **Review history**: how many times you were asked to review again, when the last request came, and what the other reviewers did.
- **Labels and filters**: click a label to show only its PRs, or filter the queue with any GitHub search terms.
- **Authors**: pick whose PRs to show, by name or all the repo’s collaborators at once.
- **Exclude from counts**: leave out files such as tests or lockfiles. Each size then shows the code left to read, with the total under it.
- **Sorting**: sort by any column except the pull request and the reviewers. The page remembers the sort for each view.
- **Changes since the last refresh**: new PRs and changed values stay marked. A counter shows how many PRs came and went.
- **Fast start**: on the next visit, the page shows the last queue at once and loads the fresh one.
- **Recent repos and users**: the page offers the ones you opened before.

## Quick start

1. Serve the folder with any static web server:

   ```sh
   python3 -m http.server 8123
   ```

2. Open <http://localhost:8123/>.
3. Sign in with GitHub, or paste a token. See [Sign in](#sign-in).
4. Enter a repo, such as `foo/bar`, and open the queue.

## Examples

The page takes its settings from the URL, so you can save and share a link to a queue.

The PRs in `foo/bar` that wait for your review:

```
http://localhost:8123/?repo=foo/bar
```

The PRs that wait for your review, with tests and lockfiles excluded from counts:

```
http://localhost:8123/?repo=foo/bar&exclude=test|\.lock$
```

The PRs that wait for `baz`’s review, without the `bar` label:

```
http://localhost:8123/?repo=foo/bar&user=baz&filter=-label:bar
```

Your own open PRs in `foo/bar`, with what every reviewer did:

```
http://localhost:8123/?repo=foo/bar&role=author
```

## URL parameters

| Parameter | Required | Value |
| --- | --- | --- |
| `repo` | Yes | The repo, as `owner/name`. Without it, the page asks for it. |
| `user` | No | Whose queue to show. Defaults to you. |
| `role` | No | `author` shows the PRs `user` wrote. Without it, the page shows the PRs that wait for `user`’s review. |
| `filter` | No | More [GitHub search terms](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), e.g. `label:foo -label:bar` or words from the title. As on GitHub’s pulls page, `author:` in the author view and `review-requested:` in the reviewer view choose the user. If there are several, the last one wins. In the reviewer view, `author:` picks the authors instead, as the Author button does. The search ignores `repo:`, `org:`, `user:`, `is:closed` and `is:issue`. |
| `exclude` | No | A regular expression for the paths of files to exclude from counts, e.g. `test\|\.lock$`. Their lines count only in the total. A size that adds up the commits since the review, or the size of a PR of over 3000 files, shows only the total. Not in the author view. |
| `authors` | No | Whose PRs to show, as logins separated by commas, e.g. `foo,bar`. `@collaborators` stands for the repo’s owners, organization members and collaborators, including later ones. The page hides the other rows, so no search runs. `author:` terms in the filter replace them. In the author view, the last one becomes `user`. |

You can change the repo, the user and the view above the table too.

## Sign in

GitHub’s API needs a token even for public repos. There are two ways to give one:

- **Sign in with GitHub** through [Madata](https://madata.dev) and its auth server, `auth.madata.dev`.
  This asks for access to every repo you can reach.
- **Paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=PR+review+queue&expires_in=90)** to grant less.
  The link opens GitHub’s form set to read-only access to public repos.
  For a private repo:
  1. Set “Resource owner” to the repo’s owner.
  2. Choose “Only select repositories” and pick the repo.
  3. Add read-only access to “Pull requests” and “Contents”.

The page keeps the token in your browser’s `localStorage`.
To switch between the two ways, sign out. Signing out also forgets the stored queues.

## Tests

The tests open the page in Chromium, Firefox and WebKit with [Playwright](https://playwright.dev) and fake GitHub’s answers, so they need no token.

```sh
npm install
npx playwright install
npm test
```

To run the tests in one engine, give `chromium`, `firefox` or `webkit` to `--project`.

```sh
npm test -- --project=firefox
```

To watch the tests run, step by step, use `npm test -- --ui`.

## Browser support

Chrome or Edge 135, Firefox 144, or Safari 26.2.

- In older browsers, the columns do not sort.
- Before Firefox 147, a filter or a view switch reloads the page.

## License

[MIT](LICENSE)
