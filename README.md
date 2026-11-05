# GitHub PR review queue

A web page that shows which pull requests in a GitHub repo wait for your review, and what changed since you last looked.
It runs in the browser, with no build step and no server of its own.

## Features at a glance

- **Your review queue**: the open PRs in one repo that wait for your review, or for anyone else’s.
- **Your own PRs**: switch to the author view to see who reviewed your open PRs and who still has to.
- **What is new for you**: each PR shows only the changes since your last review, so a re-review starts where you left off.
- **Review history**: how many times you were asked again, when you were last asked, and what the other reviewers did.
- **Labels and filters**: narrow the queue by a label with one click, or by any GitHub search terms.
- **Sorting** by any number column. The page remembers your choice.
- **What changed since the last refresh**: new PRs and changed values stay marked, and a counter shows how many PRs came and went.
- **Fast start**: the last queue shows at once on the next visit, while the fresh one loads.
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

The page takes its settings from the URL, so a link to a queue can be saved and shared.

The PRs in `foo/bar` that wait for your review:

```
http://localhost:8123/?repo=foo/bar
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
| `filter` | No | More [GitHub search terms](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), e.g. `label:foo -label:bar` or words from the title. |

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

The tests open the page in Chromium with [Playwright](https://playwright.dev) and fake GitHub’s answers, so they need no token.

```sh
npm install
npx playwright install chromium
npm test
```

To watch them run, step by step, use `npm test -- --ui`.

## Browser support

Chrome or Edge 135, Firefox 144, or Safari 26.2.

- In older browsers, the columns do not sort.
- Before Firefox 147, a filter or a view switch reloads the page.
