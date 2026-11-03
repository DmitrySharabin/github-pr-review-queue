# GitHub PR review queue

The open pull requests awaiting someone’s review in one GitHub repo.
Each one shows its diff size, the diff since that person’s last review, how many times they were asked to review, and when they were last asked.
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

For example: `?repo=foo/bar&user=baz`.
Without `repo`, or after an error, the page shows a form that opens that URL, so it can be copied and reused.

Sign-in goes through [Madata](https://madata.dev) and its auth server, `auth.madata.dev`.
GitHub’s GraphQL API needs a token even for public repos.
