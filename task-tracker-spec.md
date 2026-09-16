# Daily Task Tracker — Product Spec (v1)

## Overview
A local-first web app for managing tasks across three categories (Work, Errands,
Recruiting), organized around a **dynamic Eisenhower Matrix**: tasks shift
urgency automatically over time instead of relying on static due-date
reminders. Runs in the browser on personal laptop and PC only (not the work
laptop), no backend, no accounts. Data syncs between devices via a plain
file in an OneDrive-backed folder.

## Tech Stack
- Plain HTML/CSS/JS or lightweight React (no build complexity needed for v1)
- Storage: File System Access API, saving data as a plain file inside a
  folder pointed at OneDrive, shared between the personal laptop and PC.
  App is not installed or run on the work laptop at all, so no separate
  local-only mode is needed, there's only one storage path.
- If the browser doesn't support the File System Access API, fall back to
  IndexedDB automatically (not a user-facing choice, just a safety net)
- Recommended browser: Edge, to avoid a known Opera GX crash bug tied to
  reloading a previously-granted folder permission

## Data Model

**Category** (top-level, drives the tabs)
- id, name. Seeded with Work / Errands / Recruiting; user can add more via
  "+ Category"

**Folder** (a grouping within a category, e.g. "Finances" or "Chores" inside Errands)
- id, category_id, name

**Task**
- id, folder_id, parent_task_id (nullable — enables nesting)
- title, notes
- created_at, last_touched_at
- deadline (nullable) — the real consequence date, drives the urgency
  engine, Overdue callout, and Calendar Red
- do_date (nullable) — self-chosen "I intend to tackle this on this day."
  Set three ways: manually (typed directly, or dragged from the main List
  view into the Now window, in either case set to today, prompting for a
  deadline if none exists yet, see Deadline requirement below); once
  automatically, on the day a task's urgency transitions into the
  High/Critical bucket (Do or Clear quadrant, whichever importance lands
  it in, reusing the digest's existing drift-detection); or **defaulted
  from `deadline`**: whenever a deadline gets set on a task (however it
  came to be set), `do_date` defaults to that same date unless already set
  to something else, so a task at minimum surfaces in Now on its deadline
  day even if never moved earlier.
  **Rollover**: an incomplete `do_date` task silently advances to the next
  day, no confirmation needed, this is safe specifically because other
  independent signals keep surfacing a neglected task regardless: dated
  tasks keep escalating toward the Overdue callout on their own real
  schedule, and undated tasks keep getting staleness check-ins on theirs.
  Critically, **rollover must never update `last_touched_at`**, only a
  genuine edit should, otherwise it would silently reset the staleness
  clock every day and quietly disable that safety net. Dragging a task out
  of the Now window back to the main list clears `do_date` entirely.
  `do_date == today` applies a floor to that task's computed urgency
  (`do_today_urgency_floor`, default 65, deliberately set just above
  `quadrant_split_score` so it actually crosses into the High/Critical
  urgency bucket, not just raising the continuous score) — moving
  something into Now is meant to genuinely reclassify it as Do (if high
  importance) or Clear (if low importance), not just look more urgent
  while staying in Plan or Backlog. A rolled-over task can simultaneously
  appear in the Overdue callout if its `deadline` has separately passed,
  the two are fully independent.
  Note: `deadline` itself never rolls or changes automatically under any
  circumstance, only an explicit user action changes it (Evening Review
  may surface extending one as an option, but never does it silently).
- is_quick_win: bool — "knock it out" (quick win) vs "need to tackle"
  sizing, purely a display/organization tag, no effect on scoring. Defaults
  to true when a task is manually added to Now (dragged or created there
  directly), false when auto-populated via the urgency-bucket transition
  above. Toggleable either way from the task's info. Quick-win tasks
  render as a smaller card in the Now window.
- **Deadline requirement**: a High/Critical importance task that would
  otherwise land in Plan (i.e., its urgency isn't already High/Critical
  through some other means, e.g. staleness reaching "high") must have a
  `deadline` set, the app blocks saving importance at High/Critical
  without one. This is the actual fix for the app's founding problem, an
  important task can no longer sit dateless forever, it forces a real
  target, even a generous one. Backlog tasks (Low/Medium importance) are
  exempt, they can stay dateless or carry long deadlines indefinitely,
  being unimportant is precisely why that's fine. **Backfill**: on first
  load after this ships, any existing task that already violates the rule
  (High/Critical importance, no deadline, currently in Plan) surfaces in
  a one-time backfill list, requiring a deadline be set for each before
  it can be dismissed, same rule applied retroactively rather than
  silently grandfathered in.
- **Now-window deadline prompt** (separate from the requirement above,
  applies regardless of importance): a task manually added to the Now
  window without an existing `deadline` prompts to set one, defaulting to
  today + `deadline_high_days` (reusing the existing setting, no new one
  needed) but editable before confirming. This is what makes silent
  `do_date` rollover safe even for a low-importance task, it closes the
  one gap that would otherwise let something drift in Now with nothing
  else eventually forcing it to surface.
- importance: Low | Medium | High | Critical (manual, user-set), mapped to
  25 / 50 / 75 / 100 for scoring purposes. Bucketed as Low/Medium → "Low
  importance" and High/Critical → "High importance" for quadrant placement,
  the same pattern urgency uses.
- status: active | done | dropped
- completed_at (nullable)

**RecurringTask** (no importance/urgency/deadline/quadrant, lives outside
the Eisenhower matrix, but still assigned to a Folder for grouping)
- id, folder_id, title, cadence: daily | weekly(+weekday)
- last_completed_date (nullable) — checking it off sets this to today; a
  daily scan compares against today (or the current week, for weekly) and
  unchecks anything whose last_completed_date has lapsed. The task itself
  is singular and resets, it never spawns new instances.

**CompletionLog**
- id, recurring_task_id, completed_date
- One row written each time a recurring task is checked off. This is the
  only thing that accumulates, the task itself stays a single row. Feeds
  the productivity view's history without needing old completed instances
  kept around.

## Urgency Engine (core mechanic)

Urgency is a computed score (0–100), recalculated daily, not a static field.
All day thresholds below are **user-configurable settings**, not hardcoded
constants — see Settings below.

1. **Has a deadline:** score scales up as the deadline nears, based on
   `deadline_low_days` / `deadline_medium_days` / `deadline_high_days`.
   - ≥ deadline_low_days out → low (~10)
   - ≥ deadline_medium_days out → medium (~40)
   - ≥ deadline_high_days out → high (~75)
   - 0 days / overdue → critical (100)
2. **No deadline:** score creeps up based on days since `last_touched_at`,
   using `staleness_low_days` / `staleness_medium_days` / `staleness_high_days`.
   - < staleness_low_days → low
   - < staleness_medium_days → medium
   - ≥ staleness_high_days → high (task is "going stale")
3. **do_date = today:** score floored at `do_today_urgency_floor` (default
   65, just above `quadrant_split_score`), whichever is higher between this
   and rules 1-2 above. This is deliberate: moving something into Now
   should genuinely reclassify it as Do or Clear, not just look more
   urgent while its quadrant stays put. Never lowers a score that's
   already higher from a real deadline or staleness. This also covers what
   `manual_urgent_flag` used to handle, "promote to deadline" (deadline =
   today) already scores at critical (100) via rule 1 above, and stays
   critical every day it remains overdue, so a separate override flag was
   redundant.

## Settings

A single settings object, editable from a Settings screen in the app,
persisted in IndexedDB alongside tasks. Defaults are the values proposed
earlier; changing a setting reruns the urgency calculation immediately for
all tasks (no data migration needed since urgency is always derived, never
stored).

| Setting | Default |
|---|---|
| deadline_low_days | 14 |
| deadline_medium_days | 7 |
| deadline_high_days | 3 |
| staleness_low_days | 3 |
| staleness_medium_days | 7 |
| staleness_high_days | 8 |
| priority_importance_weight | 0.5 |
| folder_count_display | active |
| quadrant_split_score | 62.5 |
| overview_top_n | 3 |
| overview_flag_threshold | 80 |
| overview_display_mode | scatter |
| staleness_reminder_interval_days | 7 |
| staleness_reminder_low_days | 7 |
| staleness_reminder_medium_days | 14 |
| staleness_reminder_high_days | 28 |
| do_today_urgency_floor | 65 |

`last_touched_at` updates whenever the task is edited, commented on, or
manually "bumped" — this is what lets an important, deadline-less task
still climb the matrix if it's being ignored.

## Priority Score & Eisenhower Quadrant Mapping

`priority_score = priority_importance_weight × importance + (1 -
priority_importance_weight) × urgency`, both already 0-100 scales. Default
weight 0.5 (equal), configurable in Settings as you live with the app,
same pattern as every other threshold here. This is what solves the
"cliff at the bucket boundary" problem: two tasks near each other in
importance/urgency get near-identical scores even if they land in
different quadrants.

Quadrant (still bucketed, since it's answering a different question, "why
is this a priority" rather than "how much"):

| Importance \ Urgency | Low/Medium | High/Critical |
|---|---|---|
| **High/Critical** | Plan | Do |
| **Low/Medium** | Backlog | Clear |

Quadrant and priority_score are both derived, not stored, recalculated
every time the matrix or list renders.

## Daily Digest

Generated fresh each day, entirely mechanical — no AI/API call, no ongoing
cost, works offline. Two parts:
1. **Current snapshot:** tasks grouped by quadrant, right now.
2. **What changed since yesterday**, split into two tiers, compared
   against different snapshot pairs since the digest is meant to be
   checked first thing each morning, before any edits happen that day.
   Keep a rolling window of the last 2-3 daily snapshots (not unbounded
   history), each recording `deadline`, `importance`, `last_touched_at`,
   quadrant, and `priority_score` per task (`do_date` is deliberately
   excluded here, its changes are often automatic via silent rollover or
   auto-population, including it would falsely classify an ordinary day as
   "you edited this").
   - **Primary (automatic drift)**: today's live computed values vs.
     yesterday's stored snapshot. Quadrant/score shifted while all fields
     are unchanged, meaning the shift came purely from time
     passing overnight. This is the digest's core purpose, shown
     prominently with a one-line reason (e.g. "Do: deadline in 2 days" /
     "Plan: untouched 9 days").
   - **Secondary (what you edited yesterday)**: yesterday's snapshot vs.
     the day-before-yesterday's snapshot. Any of the three fields differ,
     meaning you made an edit during yesterday's session. Comparing
     today's live values against yesterday's snapshot would miss this
     entirely, yesterday's snapshot already bakes the edit in, so this
     needs its own snapshot-to-snapshot comparison, not a live-vs-snapshot
     one. Shown de-emphasized (e.g. smaller text, collapsed by default).

Brand-new tasks (no snapshot at all in yesterday's baseline) and tasks
that finished (done/dropped since yesterday) are tracked separately from
the two tiers above, but only "finished" is surfaced on the card — a task
showing up for the first time isn't a quadrant *change* the way a drift,
an edit, or a finish is, and on a heavy capture day it drowned out the
actual drift signal the digest exists to surface.

Weekly digest = same idea, rolled up: what's trending toward Do, what's been
sitting in Plan too long. Same primary/secondary split applies.

**Staleness check-ins** (undated tasks only, softer tone than the drift
tiers above, own card in the Overview sidebar underneath the Priority
summary panel — not part of the "what changed" digest itself, this is a
different kind of signal): the primary-drift tier only fires once, when a
task first crosses into "high" urgency around day 7-8, staleness has
nowhere higher to go after that, so a task ignored for 30 days would
otherwise go quiet after its one initial flag. To fix this, compare
days-untouched today vs. yesterday (same technique as the drift diff
above) and flag the task again whenever that count crosses a new multiple
of `staleness_reminder_interval_days` (default 7). Message stays low-key,
e.g. "Just so you know: untouched for 21 days", not escalating language.
Deadline tasks are excluded, their urgency is already actively climbing
toward the deadline and they're covered by the Overdue callout once it
passes.

Each check-in is also color-tiered by days-untouched, separate from the
urgency engine's own staleness thresholds (which run on a faster 3/7/8-day
cadence for scoring purposes, not display):
- `staleness_reminder_low_days` (7) → mild teal
- `staleness_reminder_medium_days` (14) → medium teal
- `staleness_reminder_high_days` (28) → strong teal
Teal specifically because it's the Plan quadrant's hue: an undated
task quietly aging is exactly the "important, not urgent, don't forget it"
case Plan exists for. The reminder still fires every
`staleness_reminder_interval_days`, the color just reflects which of these
three bands the task currently sits in at the time it fires.

## Views

The app has three views:

**1. Overview** (orientation, not execution — renamed from Matrix/Digest)
- **Primary display: continuous scatter.** Urgency on the x-axis, importance
  on the y-axis (both 0-100), each task rendered as a dot at its exact
  coordinates, colored with the same hue+intensity system as the List
  view's heat-map. Background quadrant regions split at
  `quadrant_split_score` (default 62.5, the midpoint between the existing
  Medium(50) and High(75) importance values, reused identically for the
  urgency axis) — this is the same boundary Phase 4's bucketing already
  uses, just now stated as an explicit number instead of implied by the
  Low/Medium vs High/Critical labels.
  - Layout: Do (top-left), Plan (top-right), Clear (bottom-left),
    Backlog (bottom-right)
- **Priority summary panel** (right side): shows top tasks by
  `priority_score` for the day. Inclusion rule: a task shows if its rank
  is within `overview_top_n` (default 3), OR its score is ≥
  `overview_flag_threshold` (default 80), whichever is broader. So 3 tasks
  scoring 70/60/50 all show (top-3 rule); 5 tasks scoring 90/90/90/80/70
  show the first four, the 70 is excluded (outside top-3 and below 80).
  Directly beneath it in the same sidebar column: the Staleness check-ins
  card (see Daily Digest), teal-tiered, its own card rather than folded
  into the "what changed" digest below.
- **Display mode toggle** (`overview_display_mode`, default `scatter`):
  switches between the scatter view above and the quadrant-list style
  already built (four boxes, tasks listed inside each), same Do/Plan/
  Clear/Backlog corner layout either way. Both modes are worth keeping,
  the list is better for scanning within one quadrant.
- "What changed since yesterday" line(s), unchanged from before
- Read-only glance, no checking things off here

**2. List view** (primary, where work actually happens)
- Tabs are Categories ("All" plus one per category); within a category tab,
  tasks are grouped into collapsible Folder sections (e.g. "Finances" and
  "Chores" as two sections inside the Errands tab)
- Nested task list within each folder, with collapsible subtasks
- Checkboxes to mark done, live here
- **Folder count display** (toggleable, `folder_count_display` setting):
  shows either "X active" (counts only top-level tasks, no
  `parent_task_id`, subtasks never inflate it) or "X of Y done" (same
  top-level tasks, framed as completed/total instead). Same underlying
  numbers either way, purely a display choice, switchable so you can see
  which motivates you more.
- **Subtask completion percentage**: any task with subtasks shows a small
  progress indicator (e.g. a thin bar or "67%"), computed as completed
  subtasks ÷ total subtasks, rounded to the nearest whole number. Never
  shown on tasks with zero subtasks. Purely visual, no setting, no
  threshold, nothing to configure.
- **Heat-map coloring**: hue is set by quadrant (Do = red family, Plan =
  teal, Clear = amber, Backlog = gray), and saturation/
  lightness within that hue is set continuously by `priority_score`, low
  score → pale, high score → vivid. One task barely qualifying as "Do"
  reads as soft red; a 95/95 task reads as vivid, alarming red. Backlog
  works the same way with lightness alone (no hue), so a task climbing in
  urgency visibly darkens well before it ever crosses into another
  quadrant. Hue tells you *why* a task is prioritized, intensity tells you
  *how much*, one formula drives both.
- **Overdue callout**: separate from the Top banner, since it answers a
  different question ("act on this exact task right now" vs. "here's
  today's ranking"). Membership-based, not ranked: a task qualifies if its
  `deadline` has passed. No new fields or scoring, just a filter on data
  already tracked. A stale, undated task climbing toward "high" urgency
  does not qualify here, staleness alone never reaches critical, only an
  actual missed deadline does. This is the "firefight" window. An
  ad-hoc emergency with no deadline yet is handled by setting `deadline`
  to today, "promote to deadline" in the Now window does exactly this.
- **Now window** (renamed from "Do Today"): the companion "intention"
  window, membership-based on `do_date == today` and not yet completed,
  fully independent of `priority_score` ranking for *membership* (though
  the floor above does feed the score once a task is in). Together with
  the Overdue callout, these are the two independent windows: one for
  real consequences, one for what you told yourself to get done today.
  - **Auto-population**: any task whose urgency transitions into the
    High/Critical bucket (landing it in Do or Clear, whichever importance
    dictates) gets `do_date` set to today automatically, once, on the
    transition day (see the Data Model note on `do_date`). This is the
    payoff of the matrix actually informing your daily plan rather than
    sitting separate from it.
  - **Sorting and view toggle**: a sort-key control offers Priority
    (`priority_score`, default), Urgency, Importance, or Quick Win
    (`is_quick_win` true surfaces first, `priority_score` as the
    secondary tiebreak within each group), tasks re-sort by whichever is
    selected, all values already exist, no new computation needed. A
    separate toggle switches between a flat sorted list and the existing
    by-folder grouping, same pattern as `overview_display_mode`.
  - **Drag-and-drop**: dragging a task from the main List view into Now
    sets `do_date` to today (applying the urgency floor, which now
    reclassifies it into Do or Clear; prompts for a deadline first if none
    exists, see Now-window deadline prompt). Dragging a task out of Now
    back to the main list clears `do_date` entirely (removing the floor,
    since it only applies when `do_date == today`).
  - **Promote to deadline**: a checkbox on any Now task sets `deadline`
    to today, "I really can't miss this one." No new logic needed here,
    the existing urgency engine already scores a 0-days-out deadline at
    critical (100), so this naturally bumps `priority_score` through the
    mechanism that already exists.
  - **Quick-win sizing**: see `is_quick_win` in the Data Model, renders as
    a smaller card for quick wins.
- **Later window** (renamed from "Remember"): the long-view counterpart
  to Now, aggregating Plan (important, not yet urgent) and Backlog
  (unimportant) tasks together, both are genuinely "not needed today,"
  just for different reasons. Same sort-key control as Now (Priority/
  Urgency/Importance/Quick Win), useful here specifically for spotting
  the biggest Plan items by Importance or what's creeping closest to
  urgent by Urgency. Tasks render with their own existing quadrant hue
  (teal for
  Plan-origin, gray for Backlog-origin), this window doesn't invent a new
  color scheme, it's a filtered aggregate view of data that already
  exists elsewhere. Now vs. Later: act on these now, versus don't lose
  track of these. Renders side by side with Now, both narrower by
  default; either can be focused/expanded to take more width than the
  other.
- **Top banner**: always-visible strip showing the top 3-5 tasks by
  `priority_score` across all folders, regardless of which folder filter
  is active, so the highest-priority items are never scrolled out of view.
- **Recurring habit boxes** (top right, entirely separate from the folder/
  matrix system below): two small boxes, Weekly on top and Daily below it.
  Within each box, RecurringTasks are grouped by Folder, collapsible, the
  same pattern as the main List view (e.g. "Work" section listing "Refresh
  report", "Chores" section listing "Dishes", "Cleaning"), just reusing
  the existing Folder grouping rather than a separate system. Each task
  has a checkbox; each box shows a completion fraction (e.g. "3/5").
  Checking one off just sets `last_completed_date` and writes a
  CompletionLog row, nothing here touches importance, urgency, or the
  quadrant system, recurring tasks never appear in the heat-map, the top
  banner, or the Overview.

Typical flow: open app → glance at the Overview (10 seconds) → switch
to List view → work through tasks with the top banner and heat-map colors
carrying the same prioritization without needing to re-check the matrix.
Recurring habits are ticked off separately, in their own boxes, unrelated
to that prioritization flow.

**3. Calendar view** (retrospective, replaces the earlier vague "basic
productivity view")
- Monthly grid, one cell per day
- **Color reflects overall pace**, not just habits, in strict priority
  order (matches the override pattern used elsewhere, e.g. the do_date
  urgency floor):
  1. **Red**: something **High/Critical importance** is overdue as of
     that day — a regular task bucketed High importance (same bucket as
     quadrant placement) with a `deadline` before that day that was still
     open past it (`completed_at` null or later). A Low/Medium importance
     overdue task does not trigger this, see the ring indicator below
     instead. This is purely about `deadline` (real consequences),
     `do_date` has no role in Red.
  2. **Green**: nothing High-importance overdue, and everything *planned*
     for that day (RecurringTasks scheduled that day, plus regular Tasks
     with `do_date` exactly that day) got done. Note this uses `do_date`,
     not `deadline` — a self-chosen task with no deadline at all still
     counts as "planned," fixing the earlier flaw where a day full of
     completed undated tasks (gym, cleaning, chores) would incorrectly
     render Gray since nothing had a real due date that day.
  3. **Blue**: nothing High-importance overdue, but only some of what was
     planned (by the same `do_date` definition) got done.
  4. **Gray**: nothing was planned at all that day, same "no obligation,
     not a failure" principle as before.
  Red and the overdue ring stay fully live-computed always, `deadline`
  never changes retroactively so there's nothing to freeze there. Green/
  Blue/Gray for **today** are also computed live. But for **any past day**,
  computing "planned" live from each task's *current* `do_date` breaks
  once rollover exists: a task planned yesterday that wasn't finished
  rolls its `do_date` forward to today, so a live recompute of yesterday
  would show it as never having been planned at all, quietly turning an
  honest Blue day into Green or Gray after the fact. To prevent the
  calendar from rewriting its own history, freeze each day's planned set
  once, right before daily maintenance rolls incomplete `do_date`s
  forward: record which regular Tasks had `do_date` equal to that day and
  whether each was completed by day's end, plus which RecurringTasks were
  scheduled that day and completed. This is a permanent, append-only
  per-day record (unlike the digest's short 2-3 day rolling window, this
  one persists indefinitely since the calendar can be viewed for any past
  month), captured for free at the exact moment daily maintenance already
  runs, no separate process needed. Once frozen, a day's color never
  changes again regardless of what happens to `do_date` afterward.
- **Overdue ring** (independent overlay, separate from the base fill
  color): a thin outline on the cell when a Low/Medium importance task is
  overdue as of that day, without forcing Red. Keeps minor overdue items
  visible without giving them veto power over the day's actual color.
- **Gold glow** (independent overlay, layers on any base color): fires
  when a High/Critical importance task got completed that day (same
  importance bucket as the Red rule above, no new setting). A red day can
  still glow gold if something important also got cleared.
- **Secondary count badge**: number of regular (non-recurring) tasks
  completed that day, regardless of whether they were "due" that day,
  raw context alongside the color, never blended into it.
- **Future due-date markers**: the pace coloring above only applies to
  past/today, a future day hasn't happened yet so there's nothing to
  evaluate. Instead, any regular Task with `deadline` on a future date
  shows a small marker on that cell, a live read of the `deadline` field,
  nothing new stored. Tasks meeting the same inclusion rule as the
  Overview's priority summary panel (rank within `overview_top_n` OR score
  ≥ `overview_flag_threshold`, same definition of "top priority" used
  everywhere else in the app) get a visually distinct marker, larger or
  accented, versus a plain dot for other upcoming deadlines.
- **Click a day** to expand a repository view: every task completed that
  day, regular and recurring, pulled from `completed_at` and CompletionLog
  respectively. No new storage, just a query against data already kept.
- **Weekly Accomplishments panel**: a highlights reel, never a score,
  covering the current (or selected) week:
  - **What you cleared this week**: plain list of completed task titles,
    regular and recurring, no framing, just the evidence.
  - **Biggest win**: the single highest-`priority_score` task completed
    that week, called out specifically, this is the important-but-not-
    urgent task finally getting done, exactly the case this whole app
    exists for.

## Feature List (v1)

- Categories (Work / Errands / Recruiting, extensible) containing folders
  (e.g. Finances, Chores), both collapsible
- Nested tasks (subtasks under tasks, also collapsible)
- Recurring habit checklist (Daily/Weekly boxes, separate from the matrix):
  tasks reset rather than pile up, with a completion fraction and history
  log
- Deadline field with the dynamic urgency engine above (also covers
  ad-hoc fires, "promote to deadline" sets it to today)
- do_date field (separate from deadline) and the Now window: auto-
  populated from the Do/Clear quadrants (harsher urgency bucket, both
  count now) plus your own manual additions, priority-sorted with a
  flat/by-folder toggle, drag-and-drop in and out (now reclassifying
  quadrant, not just score), silent daily rollover, a checkbox to promote
  to a real deadline, and quick-win vs. need-to-tackle sizing
- Later window: aggregates Plan and Backlog quadrant tasks, the
  long-view counterpart to Now
- Required deadline on High/Critical importance tasks landing in Plan,
  closing the "important but dateless forever" loophole; do_date defaults
  to the deadline so it surfaces at latest by then
- Quick-capture box (frictionless add, sort later)
- Daily digest (snapshot + quadrant changes)
- Weekly digest (trend view)
- Simple daily log: completed / rolled over / dropped
- Calendar view: pace-based coloring across all tasks (not just habits),
  gold glow for big wins, count badge, click-through repository, and a
  Weekly Accomplishments panel (highlights, never a score)
- Evening review: no longer gates `do_date` rollover (that's now silent,
  see Data Model), instead flags Now-window tasks that have rolled over
  repeatedly, and can surface extending a deadline as an option, never
  automatically, on tasks that are overdue but still relevant
- Someday/Maybe list: undated, low-importance tasks that age via the same
  staleness engine as any other undated task, using a separate
  `someday_review_days` setting (default 14) so they resurface in the
  weekly review rather than being forgotten
- Heat-map row coloring in List view, tied to each task's live quadrant
- Top banner in List view: top 3-5 priority tasks, visible across all folders

## Backlog (v2+, not in scope now)
- Bulk import via AI parsing of unstructured pasted text (ongoing API cost
  per use — start with template/tag-based parsing instead, see below)
- Daily time-capacity limits (estimate + total hours available, flag overload)
- Native mobile app (browser works fine on phone)
- Collaboration/sharing
- Notifications outside the browser
- Two-minute/quick-win tag, focus mode, time-boxing timer
- Duplicate detection on capture
- AI narrative wrap-up (opt-in): a short written paragraph generated from
  the mechanical digest data, e.g. Haiku via the user's own API key
  (separate billing from any chat subscription, small but real ongoing
  cost — estimate under $1/month at daily use)

## Bulk Import (v1, lightweight)
One task per line, with optional inline tags parsed mechanically (no AI
call, no ongoing cost):
- `#folder` — assigns folder (and its parent category)
- `@friday` / `@2026-10-01` — sets deadline
- `!` — sets `deadline` to today (the ad-hoc-fire equivalent, since the
  separate urgent flag was removed, see Urgency Engine)
Unrecognized lines still import as plain tasks in an Inbox folder (under an
Inbox category) for manual sorting.

## Build Phases (for Claude Code, one phase at a time)
1. List view skeleton: folders, collapsible nested tasks, add/edit/delete,
   category tabs (All plus one per category)
2. Storage: File System Access API pointed at an OneDrive folder, with
   automatic IndexedDB fallback if unsupported
3. Recurring habit checklist: RecurringTask + CompletionLog, the Weekly/
   Daily boxes, reset-on-schedule logic (this replaces the earlier
   instance-regeneration approach from the first Phase 3 build, the
   underlying mechanic changed)
4. Urgency engine + quadrant derivation (read thresholds from Settings, not
   hardcoded); apply as heat-map coloring on List view rows
5. Overview: continuous scatter (urgency × importance, quadrant
   backgrounds split at quadrant_split_score), priority summary panel
   (top_n + flag_threshold rule), display-mode toggle to the existing
   quadrant-list style, with change-tracking since yesterday
6. Calendar view: pace-based coloring (red/green/blue/gray priority rules),
   gold glow overlay for big wins, count badge for regular task
   completions, click-through day repository, Weekly Accomplishments
   panel (cleared list, biggest win only)
7. Polish pass (styling, keyboard shortcuts, quick-capture)

Commit to git after each phase.
