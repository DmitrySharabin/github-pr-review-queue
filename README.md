# GitHub PR review queue

The open pull requests awaiting someone’s review in one GitHub repo.
Each one shows its diff size, the diff since that person’s last review, how many times they were asked to review again after reviewing, when they were last asked, and what every other reviewer did.
When that person has not reviewed it yet, or a force push removed the reviewed commit, the column shows the whole diff, grayed out.
GitHub’s push icon marks a PR whose reviewed commit a force push removed.
A PR’s labels follow its title, up to five before a button for the rest. A label filters the queue by it, in place of the labels the filter asked for.
When the filter asked for no labels, the queue narrows at once to the PRs with that label, while the queue loads again.
An author’s avatar opens their profile, and another reviewer’s opens their latest review, or their profile while it is awaited.
The figure columns sort, and the page remembers the last sort.
After a refresh, the PRs it found and the cells it changed stay marked until the next load, or until a link in that row is opened.
Next to the count above the table, “+3” in red over “−2” in green says how many PRs the refresh found and how many left the list, e.g. once merged or reviewed.
A zero shows in gray, e.g. “−0” under “+3”, and a refresh that changes neither shows nothing. During the next refresh both dim.

The page keeps the last queue of each view on this device and shows it at once on the next visit, while it loads again.
A load asks GitHub for the slow details only of the PRs that changed since, and signing out forgets the stored queues.

The author view lists someone’s own open PRs instead.
There, the columns count everyone else’s reviews and requests, and the switch above the table goes back.

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
| `role` | Optional. `author` lists the open PRs `user` wrote, with what every reviewer did. Otherwise, the PRs awaiting `user`’s review. The switch above the table changes it. |
| `filter` | Optional. More [GitHub search terms](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), e.g. `label:foo -label:bar` or `in:title` words. |

For example: `?repo=foo/bar&user=baz&filter=-label:bar`.
Without `repo`, or after an error, the page shows a form that opens that URL, so it can be copied and reused.
Its fields offer the repos and users of the stored queues, the latest first: a click or ↓ opens them, and typing narrows them.
Removing one, with its × or Shift+Delete, forgets its stored queues too.
The pencil next to the repository or the user above the table changes it in place, keeping the other parameters.

Sign-in goes through [Madata](https://madata.dev) and its auth server, `auth.madata.dev`.
GitHub’s GraphQL API needs a token even for public repos.

The sign-in asks for access to every repo you can reach.
To grant less, paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=PR+review+queue&expires_in=90) instead.
The link opens GitHub’s form set to read-only access to public repos.
For a private repo, set “Resource owner” to the repo’s owner, choose “Only select repositories”, pick the repo, and add read-only “Pull requests” and “Contents”.
To switch between the sign-in and a token, sign out.
The page keeps the token in `localStorage`.

## Browser support

The page uses features that reached every browser in 2025–2026.
It needs Chrome or Edge 135, Firefox 144, or Safari 26.2. In older browsers the column headers do not sort the table.
Before Firefox 147, a filter or a role switch reloads the page instead of updating it in place, and the recent repos and users open away from their field.
