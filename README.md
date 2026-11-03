# GitHub PR review queue

The open pull requests awaiting someone’s review in one GitHub repo.
Each one shows its diff size, the diff since that person’s last review, how many times they were asked to review, and when they were last asked.
When there is no diff since that person’s last review, the column shows the whole diff, grayed out.
A “force-pushed” tag marks a PR whose reviewed commit a force push removed.
Every column except “Pull request” sorts.

## Run

There is no build step. Serve the folder with any static web server, for example:

```sh
python3 -m http.server 8123
```

Then open <http://localhost:8123/>.

## Configure

Use URL parameters:

| Parameter | Value |
| --- | --- |
| `repo` | Required. Without it, the page asks for it. |
| `user` | Optional. Defaults to the signed-in user. |
| `filter` | Optional. More [GitHub search terms](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), e.g. `label:foo -label:bar` or words in the title. |

For example: `?repo=foo/bar&user=baz&filter=-label:bar`.
Without `repo`, or after an error, the page shows a form that opens that URL, so it can be copied and reused.

Sign-in goes through [Madata](https://madata.dev) and its auth server, `auth.madata.dev`.
GitHub’s GraphQL API needs a token even for public repos.

The sign-in asks for access to every repo you can reach.
To grant less, paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=PR+review+queue&expires_in=90) instead.
The link opens GitHub’s form set to read-only access to public repos.
For a private repo, set “Resource owner” to the repo’s owner, choose “Only select repositories”, pick the repo, and add read-only “Pull requests” and “Contents”.
To switch between the sign-in and a token, sign out.
The page keeps the token in `localStorage`.
