# Cooking Plan

A 12-month cooking schedule: a static site plus weekly email reminders, both driven by one file, `plan.json`.

| File | Purpose |
| --- | --- |
| `index.html` | The site (no build step, no dependencies) |
| `plan.json` | The plan. Edit this and both the site and emails change |
| `reminders.gs` | Email reminders; paste into Google Apps Script |

## Run it locally

Browsers block `fetch()` on `file://` pages, so double-clicking `index.html` asks you to pick `plan.json` by hand. To skip that, run a local server from this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

To preview any date, add `?date=`, for example http://localhost:8000/?date=2026-11-11.

## Deploy the site (GitHub Pages)

1. Create a public GitHub repo and push this folder to it.
2. In the repo, go to **Settings > Pages**, set **Source** to **Deploy from a branch**, and pick `main` and `/ (root)`.
3. Wait a minute, then open `https://<username>.github.io/<repo>/`.

The emails need a public `plan.json`, so a private host won't work for them. The reminder address never goes in this repo; it lives only in Apps Script.

## Set up the email reminders

1. Open [script.google.com](https://script.google.com) and create a new project.
2. Replace the contents of `Code.gs` with `reminders.gs`, and save.
3. Open **Project Settings** (gear icon) and add two **Script Properties**:
   - `EMAIL_TO`: the address that should receive reminders
   - `PLAN_URL`: `https://<username>.github.io/<repo>/plan.json`
4. Back in the editor, select `setup` in the function dropdown and click **Run**.
5. Approve the Gmail and external-request permissions when prompted. Google shows an "unverified app" warning because this is your own script: choose **Advanced**, then **Go to (project name)**.
6. Select `sendTestEmail` and click **Run**. The Week 1 cook-day email should arrive within a minute.

`setup` creates an hourly trigger for `sendDueReminders`. You can run it again safely; it replaces the old trigger.

## Reminder schedule

All times are Pacific/Honolulu.

| When | Email |
| --- | --- |
| Saturday 6 PM | Shopping list (named for that week's store) and Saturday-night tasks for the coming week |
| Sunday 8 AM | Cook-day menu and order of operations |
| Midweek task day, 7 AM | The midweek task and anything to buy fresh |
| Wednesday 8 PM | Move Thu–Fri meals to the fridge |
| Friday 8 PM | Move Sat–Sun meals to the fridge |
| Sunday 7 AM, first week of each 4-week month | Month theme and goals |

The trigger runs once an hour at a minute Google picks, so an email can land any time in its hour. If a run is late, the email goes out in the next hour instead. Sent reminders are recorded in Script Properties, so nothing sends twice.

Once the plan passes its last detailed week, only the monthly email goes out, along with a nudge to plan that month.

Edits to `plan.json` reach the emails within about an hour, because the script caches the plan.

## Add a month

In `plan.json`, change the month's `status` to `"detailed"` and add a `weeks` array of four weeks, using Month 1 as the template. Goals and candidate dishes can stay or go. No code changes are needed.

Weeks display by position within their month, so Month 2's four weeks are Weeks 5–8.

Optional week fields:

| Field | Purpose |
| --- | --- |
| `midweek` | `day`, `title` (short, used in the email subject), `task`, and optional `buyFresh`, `ingredients` and `steps` |
| `ingredients`, `steps` | On a component: adds an expandable full recipe on the site. Emails keep the short `make` text |
| `saturdayNight` | Tasks for the Saturday before this week's cook day, such as thawing or marinating |
| `includesPantry` | `true` adds the pantry list to this week's shopping checklist |
| `store` | Where to shop that week, such as `Foodland Kihei` or `Costco`. Defaults to Costco. The week's list stays in `costcoList` whichever store it is |

Months with `goals` use them in the monthly email; a detailed month without `goals` uses each week's `skill`.

## Calendar

**Ref > Download .ics** exports every cook day and midweek task as all-day events. In Google Calendar, use **Settings > Import & export**. If the plan changes later, download and import the file again; events keep the same IDs.
