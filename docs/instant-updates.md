# Instant updates: let the calendar trigger the sync

**Step-by-step setup.** For *whether* you want this and why the alternatives
lose, see [Instant updates](../README.md#instant-updates-let-the-calendar-trigger-the-sync)
in the README — this file assumes you've decided and covers the mechanics.

About fifteen minutes, once.

Throughout, the example site is **John Doe's** at `johndoe.com`, its repository
is `johndoe/johndoe.com`, and his calendar is `john.doe@gmail.com`. Substitute
your own.

---

## What you end up with

```
John saves an event in Google Calendar
        │
        ▼
Apps Script onEventUpdated trigger  (Google, ~1 min)
        │  repository_dispatch: calendar-changed
        ▼
your sync workflow ──▶ gcal-sync ──▶ changed? ──▶ build ──▶ deploy
        ▲
        └── nightly cron — still required, see "Keeping it alive"
```

Without it, the site is only as fresh as the cron: an event added at 09:00
appears the next morning. With it, a minute or two.

## Before you start

- [ ] A working [nightly sync](../README.md#nightly-sync-with-github-actions) —
      `gcal.config.json`, the `GCAL_API_KEY` secret, and a workflow that runs
      green. Set this up **first**. Adding a trigger to a sync that doesn't work
      yet just gives you two things to debug at once.
- [ ] Admin on the repository, so you can add a secret and merge a workflow change.
- [ ] The Google account that owns or subscribes to the calendar.

---

## Step 1 — Create the GitHub token

The script authenticates to GitHub as you. That needs a personal access token,
and GitHub only issues these through the web UI — there's no CLI or API path.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** → **Generate new token**.
   Direct link: <https://github.com/settings/personal-access-tokens/new>

2. Fill it in:

   | Field | Value |
   |---|---|
   | Token name | `johndoe.com calendar trigger` |
   | Resource owner | the account or org that owns the repo |
   | Repository access | **Only select repositories** → `johndoe/johndoe.com` |
   | Expiration | as long as you'll actually remember to rotate |

3. Under **Repository permissions**, set **Contents** to **Read and write**.
   Leave everything else alone.

   That single permission is what `POST /repos/{owner}/{repo}/dispatches`
   requires. A classic token with `repo` scope also works but grants far more
   than this needs — prefer fine-grained.

4. **Generate token**, then copy it. GitHub shows it exactly once.

> **Put the expiry date in a calendar now.** When the token lapses, dispatches
> start failing and the site quietly goes back to being up to a day stale. The
> nightly cron keeps it *correct* — which is the good news, and precisely why
> nobody notices for weeks. See [Keeping it alive](#keeping-it-alive).

### Fine-grained tokens on an organisation

If the repo belongs to an org, fine-grained tokens may need the org to approve
them: **Organisation settings → Personal access tokens → Settings**. If your
token shows as `pending`, an owner has to approve it before the first dispatch
will work. A `403` on step 6 with an approval-related message is this.

---

## Step 2 — Create the Apps Script project

1. Go to <https://script.google.com> → **New project**.

2. Name it something you'll find in a year — `johndoe.com — Calendar Trigger`.
   The default `Untitled project` is genuinely hard to identify later.

3. Delete the stub `myFunction`, and paste this in:

```js
/**
 * Tells GitHub the calendar changed, so the site rebuilds now instead of
 * overnight.
 *
 * The trigger reports only THAT something changed, never what — which suits
 * us, because the sync refetches the whole calendar regardless.
 */

var PROP_REPO  = 'GITHUB_REPO';       // "johndoe/johndoe.com"
var PROP_TOKEN = 'GITHUB_TOKEN';      // fine-grained PAT, Contents: read+write
var EVENT_TYPE = 'calendar-changed';  // must match the workflow's `types:`

/** The trigger handler. Posts one repository_dispatch to GitHub. */
function notifyGitHub() {
  var props = PropertiesService.getScriptProperties();
  var repo  = props.getProperty(PROP_REPO);
  var token = props.getProperty(PROP_TOKEN);

  if (!repo || !token) {
    // Throw rather than return quietly: a missing property means setup was
    // never finished, and a silent no-op looks exactly like "nobody edited
    // the calendar".
    throw new Error('Missing Script Property ' + (repo ? PROP_TOKEN : PROP_REPO));
  }

  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify({ event_type: EVENT_TYPE }),
    // Read the status ourselves, so the error names the real problem
    // (401 = token expired, 404 = token can't see the repo) instead of
    // Apps Script's generic fetch exception.
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code !== 204) {
    // 204 No Content is success for this endpoint. Anything else throws, so it
    // lands in the execution log and in the failure mail Google sends the
    // script's owner. This has to be loud: the cron still covers the site
    // while it's broken, so the only symptom is the site quietly going back
    // to being a day late.
    throw new Error('GitHub dispatch failed: ' + code + ' ' + res.getContentText());
  }

  console.log('Dispatched ' + EVENT_TYPE + ' to ' + repo);
}

/**
 * Run ONCE by hand to install the trigger. Safe to re-run.
 * CALENDAR_ID is the same value as `calendarId` in gcal.config.json.
 */
function installTrigger() {
  var CALENDAR_ID = 'john.doe@gmail.com';

  // Clear ours before creating a new one. Without this, every run of this
  // function stacks another trigger and a single calendar edit fires N
  // dispatches — N queued workflow runs, of which the first does the work and
  // the rest burn Actions minutes finding nothing changed.
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'notifyGitHub') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('notifyGitHub')
    .forUserCalendar(CALENDAR_ID)
    .onEventUpdated()
    .create();

  console.log('Trigger installed for ' + CALENDAR_ID);
}

/** Optional smoke test — dispatches now, without touching the calendar. */
function testDispatch() {
  notifyGitHub();
}
```

4. Set `CALENDAR_ID` in `installTrigger` to your calendar — the same value as
   `calendarId` in `gcal.config.json`. Save (⌘S / Ctrl+S).

> **Keep a copy in your repo.** The executing copy lives in a Google account
> with no version history and no review trail. Commit the script alongside your
> site (`scripts/calendar-trigger.gs` or similar) and treat that as the source
> — then paste changes into Apps Script. If you don't, the only copy of a piece
> of your deployment pipeline is in a web editor nobody can diff.

### Whose Google account?

If you're setting this up for a client, prefer **your own** account: subscribe
to their public calendar and point `forUserCalendar()` at it. They then never
touch a script, a token, or a consent screen.

**Verify the trigger actually fires for a subscribed rather than owned calendar
before relying on it** — test it at step 6 with a real edit. If it doesn't, the
script has to live in the calendar owner's account instead, which is a one-time
setup (screen-share, ten minutes) rather than an ongoing burden.

---

## Step 3 — Add the credentials

In the Apps Script editor: **Project Settings** (the gear) → scroll to
**Script Properties** → **Add script property**, twice:

| Property | Value |
|---|---|
| `GITHUB_REPO` | `johndoe/johndoe.com` |
| `GITHUB_TOKEN` | the token from step 1 |

**Save script properties.**

Not constants in the file: Script Properties keep the token out of the source,
so pasting the script into a repo or a chat doesn't leak it.

---

## Step 4 — Install the trigger

1. In the editor, pick **`installTrigger`** from the function dropdown at the top.
2. **Run**.
3. Google asks for authorisation the first time. Approve:
   - *See, edit, share and permanently delete all the calendars you can access* — reading the calendar for the trigger
   - *Allow this application to run when you are not present* — trigger management
   - *Connect to an external service* — the GitHub call

   You'll pass an "unverified app" screen: **Advanced → Go to \<project name\>
   (unsafe)**. That warning is about apps published to other people; this is
   your own script in your own account.

4. Confirm it took: the **Triggers** icon (alarm clock) in the left sidebar
   should list one `notifyGitHub` trigger, event source *From calendar*.

Re-running `installTrigger` is safe — it clears its own triggers first.

---

## Step 5 — Wire the workflow

Add `repository_dispatch` to your sync workflow. Keep the cron.

```yaml
# .github/workflows/sync-calendar.yml
name: Sync calendar
on:
  repository_dispatch:
    types: [calendar-changed]   # must match EVENT_TYPE in the script
  schedule:
    - cron: '0 1 * * *'         # NOT optional — see "Keeping it alive"
  workflow_dispatch:            # manual re-run

jobs:
  sync:
    uses: copperdesign/gCal/.github/workflows/sync.yml@v0.5.0
    with:
      config: gcal.config.json
    secrets:
      api-key: ${{ secrets.GCAL_API_KEY }}

  deploy:
    needs: sync
    if: needs.sync.outputs.changed == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          # REQUIRED, and easy to miss. Under repository_dispatch, github.sha
          # is the branch as it was BEFORE the sync's commit. A bare checkout
          # here builds the calendar as it stood before the edit that
          # triggered this run — and looks perfectly healthy doing it.
          ref: ${{ github.event.repository.default_branch }}
      # …your build and deploy
```

**This must be merged to your default branch before it does anything.**
`repository_dispatch` only fires workflows present on the default branch, so a
trigger sitting on a feature branch is inert — a common half hour of confusion.

**Gate the deploy on `changed` even here.** It's tempting to deploy
unconditionally on the grounds that the run only exists because the calendar
changed, but a dispatched run producing an identical artifact is *common*: the
trigger fires on any calendar edit, while the artifact carries only eight
fields. Adding a guest, changing an event's colour, setting a reminder, editing
something outside the fetch window — all dispatch a run that changes nothing.

---

## Step 6 — Test it

**Smoke test first.** Run `testDispatch` from the Apps Script editor. Within a
few seconds a run should appear in your repository's **Actions** tab. It will
find nothing changed and skip the build and deploy — that's the correct result,
and it proves the token, the repo name and the `types:` match.

**Then the real test.** Change an event title in Google Calendar, wait a minute
or two, and watch for a second run. This is the one that proves the trigger
itself works — and, if you're using a subscribed calendar, that it fires at all.

If the smoke test passes but the real one doesn't, the problem is the trigger,
not the credentials. Check the **Triggers** panel and the **Executions** log.

---

## Keeping it alive

### Do not remove the nightly cron

Having set the trigger up, deleting the cron feels like the obvious tidy-up.
Don't. There are two reasons to keep it, and the first isn't a safety
argument at all.

**1. Past events expire by time passing, not by an edit.** `gcal-sync` floors
`timeMin` to the start of today, so an event that has already happened falls
out of the fetch window on its own — the artifact changes with no calendar
edit at all. The trigger only fires on *edits*. Delete the cron and last
week's concert stays on the page until somebody next happens to touch the
calendar, which on a stable calendar can be months. Nothing else expires past
events.

**2. Both moving parts fail silently.** Neither announces itself:

- **Apps Script disables triggers that error repeatedly**, mailing only the
  script's *owner*. If that's a client's account, you will never see it.
- **Fine-grained PATs expire** — a year at most.

In both cases dispatches simply stop. The site reverts to being up to a day
stale, nothing goes red, and the failure mode is "it quietly got slower
again".

Trigger for speed, cron for correctness. They do different jobs.

### Routine upkeep

Worth doing:

- Calendar reminder for the token expiry, a week ahead
- Occasional glance at the **Executions** log in Apps Script
- If it's a client's account, make sure failure mail reaches *you* somehow

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401` in the execution log | Token expired or revoked. Reissue, update the Script Property. |
| `403` | Fine-grained token pending org approval, or Contents permission not set to read **and write**. |
| `404` | The token can't see the repo — created under the wrong account, or the repository wasn't selected under *Only select repositories*. A 404 rather than 403 is deliberate on GitHub's part: it doesn't confirm private repos exist to tokens that can't read them. |
| `422` | Malformed payload — usually `event_type` missing. |
| Dispatch succeeds, no workflow run | The workflow isn't on the **default branch** yet, or `types:` doesn't match `EVENT_TYPE`. |
| Nothing fires on a calendar edit | Check the Triggers panel — Google may have disabled it. Also confirm the trigger fires for a *subscribed* calendar if that's your setup. |
| Runs fire but the site never changes | Expected when the edit touched nothing the artifact carries. The log says `Calendar unchanged`. |
| Site deploys the *old* calendar | Missing `ref:` on the deploy checkout — see step 5. |

---

## Cost

A dispatch-driven run costs the same as a nightly one, and there are only as
many as there are calendar edits — typically ten to twenty a month, so twenty
to forty Actions minutes.

Compare with simply polling harder. GitHub Free includes 2,000 Actions minutes
a month on private repositories (public repos are unmetered), billed per run
and rounded up:

| Approach | Runs/month | Minutes | Staleness |
|---|---|---|---|
| Nightly cron | ~30 | 30–60 | up to 24 h |
| Hourly cron | ~730 | 730–1,460 | up to 1 h |
| Every 15 min | ~2,900 | 2,900–5,800 | up to 15 min |
| **Trigger + nightly cron** | **~40** | **50–100** | **~1 min** |

Polling is the expensive architecture — it spends the quota on *asking*. Being
told is both faster and cheaper, which is the whole argument for this setup.

---

## Alternative: a Cloudflare Worker

If the Apps Script trigger proves unreliable — or you'd rather not depend on a
Google account you don't control — a Worker on a cron trigger can poll the
Calendar API directly, hash the result into KV, and `POST` the dispatch only
when the hash changes. Free tier, and zero Actions minutes for the polling.

It's more moving parts and puts the API key in a second place, so it's the
fallback rather than the recommendation. Note the README's "not recommended:
Workers Cron Trigger" warning doesn't apply — that's about *serving* from KV at
request time. Using a Worker purely as a trigger keeps it out of the request
path entirely.
