# GitHub PR review queue

The open pull requests awaiting someone’s review in one GitHub repo.
Each one shows its diff size, the diff since that person’s last review, how many times they were asked to review, and when they were last asked.
Every column except the title sorts.

## Run

```sh
python3 -m http.server 8123
```

Then open <http://localhost:8123/>.

## Configure

Use URL parameters:

| Parameter | Default |
| --- | --- |
| `repo` | `DmitrySharabin/github-pr-review-queue` |
| `user` | The signed-in user |

For example: `?repo=DmitrySharabin/github-pr-review-queue&user=DmitrySharabin`.

Sign-in goes through [Madata](https://madata.dev) and its auth server, `auth.madata.dev`.
GitHub’s GraphQL API needs a token even for public repos.
