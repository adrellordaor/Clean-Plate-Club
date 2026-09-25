# Daily Task Tracker — Product Spec (v1)

**App title: "Clean Plate Club"** (fits the Daily Plate / Fridge / Fire-Ice
theme, and matches the "finish what's on your plate" goal the app is
actually built around).
Shown wherever the app displays its name (browser tab title, header, etc.).

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
- **Subtasks are excluded from the matrix entirely.** A task with
  `parent_task_id` set doesn't get its own independent importance,
  urgency, `priority_score`, or quadrant, and is exempt from the
  Deadline requirement, none of that machinery applies below the
  top-level task. For display (e.g. heat-map coloring if a subtask is
  ever shown standalone), a subtask simply inherits its parent's
  `priority_score` and quadrant rather than being scored on its own.
  This keeps subtasks as what they actually are, checklist items under a
  real task, not independent citizens of the Eisenhower system.
- title, notes
- created_at, last_touched_at
- deadline (nullable) — the real consequence date, drives the urgency
  engine, Overdue callout, and Calendar Red. **Not required on
  subtasks**, the Deadline requirement only ever applies to top-level
  tasks.
- do_date (nullable) — self-chosen "I intend to tackle this on this day."
  Set two ways: manually (typed directly, or dragged from the main List
  view into the Now window, in either case set to today, prompting for a
  deadline if none exists yet, see Deadline requirement below); or
  **defaulted from `deadline`**: whenever a deadline gets set on a task
  (however it came to be set), `do_date` defaults to that same date
  unless already set to something else. Now's membership is a live
  union, `do_date == today` OR current live quadrant is Do or Clear, so
  a genuinely urgent task always shows regardless of `do_date`, no
  separate write is needed to guarantee that, see the Now window section.
  **Deprioritizing** (dragging a task out of Now) is the one place
  `do_date` gets touched deliberately, and it splits on *why* the task is
  currently urgent:
  - **Deadline is the true driver** (its deadline-branch urgency alone,
    ignoring the floor below, already crosses `quadrant_split_score`):
    dragging out prompts for a new deadline before it will actually
    leave, no silent "I'll get to it," you have to commit to a real new
    due date. Choosing one still close enough to independently qualify
    just means it honestly reappears, the live recalculation makes that
    obvious immediately, no separate validation needed.
  - **Not deadline-driven** (staleness, or purely floor-boosted with
    nothing urgent underneath): this is a genuine, deliberate edit, so it
    legitimately bumps `last_touched_at` (unlike passive rollover, which
    must never touch it), resetting the staleness clock. `do_date` resets
    to `deadline` if one exists, or `null` if not (an undated, stale
    Clear task, where staleness check-ins remain the ongoing safety net).
    Because this is a real change, not an override, the task's live
    quadrant genuinely settles into Plan or Backlog afterward, so Later's
    plain quadrant-based membership picks it up correctly with no special
    case needed.
  **Rollover**: an incomplete `do_date` task silently advances to the next
  day, no confirmation needed, this is safe specifically because other
  independent signals keep surfacing a neglected task regardless: dated
  tasks keep escalating toward the Overdue callout on their own real
  schedule, and undated tasks keep getting staleness check-ins on theirs.
  Critically, **rollover must never update `last_touched_at`**, only a
  genuine edit (like deprioritizing above) should, otherwise it would
  silently reset the staleness clock every day and quietly disable that
  safety net. Each rollover also increments `do_date_rollover_count` (see
  below), this one also excluded from `last_touched_at`, it's the same
  passive event, not an edit.
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
  circumstance, only an explicit user action changes it (the deprioritize
  prompt above is exactly such an action; Evening Review may also surface
  extending one as an option, but never does it silently).
- is_quick_win: bool — **no stated label or marker on either state**, on
  cards this is pure size differentiation, a smaller card and nothing
  else, no chip, tag, or icon indicating the state either way. This was
  originally a stated "Bite-size" marker, but since it defaulted true for
  every task, the mark carried no real information (nearly everything
  had it), removed entirely rather than flipping which state gets
  marked, size alone is obvious enough. Purely
  a display/organization property, no effect on scoring. **Defaults to
  false for every newly created task**, reversed from the earlier
  universal-true default based on real usage, most tasks turned out not
  to be bite-size, defaulting true just meant toggling it off constantly.
  A weekly-recurring "sort field" also treats
  daily
  RecurringTasks as equivalent to `true` for sort placement only (see
  Size sort under the Now/Fridge sections), without giving them the
  field or any marker, they're a different entity entirely. In the
  task form, this is still a **toggle, not a checkbox**, labeled "Bite-
  size" as the field's own name (a form label, not a card tag), its
  **visual state** (filled/highlighted when on, muted/outline when off)
  shows the boolean. Bite-size
  tasks render as a smaller card, with the further distinctions described
  in the Now window section.
- do_date_rollover_count: int, default 0 — counts consecutive silent
  rollovers, closing a real gap where nothing previously distinguished a
  task just added today from one that's been quietly dodged for a week,
  since the escalating tag is purely deadline-driven and staleness
  check-ins only cover undated tasks, neither actually watches `do_date`
  itself. Incremented by each rollover (excluded from `last_touched_at`,
  same passive-event reasoning as rollover itself). Reset to 0 by any
  genuine, explicit `do_date` write: manual drag-in, a bucket-specific
  add, a direct field edit, or deprioritizing. Shown as a small, plain
  tag whenever count ≥ 1 (e.g. "Rolled 3x"), just the number, no color
  tiers or thresholds, kept intentionally simple.
- was_ever_in_plan: bool, default false — set true the first time this
  task's live quadrant computes to Plan, stays true afterward even once
  urgency later pushes it into Do. Drives the Calendar's big win marker
  (see Calendar view section), one of two independent paths to a big
  win, the other being completion after the task's own `deadline` had
  passed. Never reset once true.
- **Week-calendar do_date picker**: wherever `do_date` is set in the task
  form, show 7 boxes, today first, labeled with weekday letters, one tap
  picks a day, this is what makes scheduling something for tomorrow
  genuinely frictionless instead of opening a full date picker for a
  single-day choice. The full calendar/date input for anything further
  out than a week is **always visible alongside the 7 boxes**, not
  behind a "More dates" click, both are just there together.
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
- **Deletion is true removal, no history preserved.** A completed Task
  stays in the Completed Today folder for the rest of the day it was
  finished, then hides from every active view the next day, only
  reachable afterward through the Calendar's day-repository, that's the
  completion path. Deleting is different: it removes the row entirely,
  including from Calendar history, nothing lingers. There's no separate
  log for regular Tasks, `completed_at` lives directly on the one row
  that exists, so deleting it has nothing left to preserve, by design,
  not an oversight.

**RecurringTask** (no importance/urgency/deadline/quadrant, lives outside
the Eisenhower matrix, but still assigned to a Folder for grouping)
- id, folder_id, title, cadence: daily | weekly(+weekday) |
  monthly(+day-of-month)
- The weekday for weekly cadence is optional at creation, no forced
  choice, defaults to Sunday if left empty. This weekday doubles as the
  task's "do date" equivalent for Now inclusion, see the Now window
  section, not a separate field. **Monthly works identically**: the
  day-of-month is optional, defaulting to the last day of the month if
  left empty (the direct monthly analog of Sunday). If a specific day is
  chosen and a given month is shorter than that day number, clamp to
  that month's actual last day (e.g. day 31 in a 30-day month lands on
  the 30th).
- last_completed_date (nullable) — checking it off sets this to today; a
  daily scan compares against today (or the current week/month, for
  weekly/monthly) and unchecks anything whose last_completed_date has
  lapsed. The task itself is singular and resets, it never spawns new
  instances.
- skipped_date (nullable) — a per-occurrence "not today" state, distinct
  from completion, for exactly the "rest day" case: you don't want it
  marked done (that would falsely record it as completed in
  CompletionLog), but you also don't want to delete the habit (you still
  want reminded next time). Set to today (or the current period, for
  weekly/monthly) via a distinct action separate from the completion
  checkbox, never the checkbox itself. Writes nothing to CompletionLog.
  Resets automatically the same way `last_completed_date` already does,
  once the period rolls over, `skipped_date` no longer matches "today"
  and the habit shows normally again, fully un-skipped, no manual reset
  needed. While `skipped_date == today`, the habit is treated as resolved
  for today (not actively nagging), same visibility effect as being
  complete, without actually being marked complete.
- missed_last_period: bool — set at the reset boundary (day/week/month
  turnover) if the *previous* period's instance was never completed
  **and never skipped either** (e.g. neither `last_completed_date` nor
  `skipped_date` falls within last week for a weekly task). A deliberate
  skip counts the same as a completion here, a rest day is a real choice,
  not neglect, and shouldn't later flag as "missed." Shown as a small
  flag ("Missed yesterday" / "Missed last week" /
  "Missed last month" depending on cadence), and clears the moment the
  *current* period's instance gets completed or skipped, it's a nudge to
  get back on track, not a permanent mark.
- **Deletion preserves history, unlike regular Tasks.** Deleting a
  RecurringTask removes the definition, title, cadence, schedule, so it
  stops recurring and stops surfacing anywhere going forward. But its
  `CompletionLog` rows are never deleted alongside it, they're
  independent historical facts, not something tied to the definition
  still existing. Calendar's day-repository and the Weekly panel keep
  correctly showing past completions from a habit you've since deleted.

**CompletionLog**
- id, recurring_task_id, completed_date, **title** (snapshot of the
  RecurringTask's title at the moment of completion, same reasoning as
  `plannedHistory`'s stored titles: if the parent RecurringTask is later
  deleted, a log row needs to remain fully self-sufficient and correctly
  labeled on its own, not dependent on a row that may no longer exist)
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
| daily_capacity_points | 6 |
| calendar_display_mode | pace |
| weekly_recurring_now_days | 3 |
| monthly_recurring_now_days | 5 |
| list_display_mode | windows |

`last_touched_at` updates whenever the task is edited, commented on, or
manually "bumped" — this is what lets an important, deadline-less task
still climb the matrix if it's being ignored. **Bump only shows on
undated tasks**, hidden entirely on any task with a deadline, since
staleness (what Bump resets) never factors into deadline-driven urgency
at all, showing it everywhere made it a dead affordance on most rows.

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
   quadrant, and `priority_score` per task. `do_date` is excluded from
   this general set specifically because its changes are often automatic
   via silent rollover or the deadline default, including it here would
   falsely classify an ordinary day as "you edited this", but it does get
   its own narrow, separate tracking below for the "became Do Today"
   signal specifically.
   - **Primary (automatic drift)**: today's live computed values vs.
     yesterday's stored snapshot. Quadrant/score shifted while all fields
     are unchanged, meaning the shift came purely from time
     passing overnight. This is the digest's core purpose, shown
     prominently with a one-line reason (e.g. "Do: deadline in 2 days" /
     "Plan: untouched 9 days"). When the cause is specifically a task's
     `deadline` reaching 0 days or going negative, phrase the reason using
     the escalating tag names directly, "became Due Today" / "became
     Overdue", rather than generic day-count language, one consistent
     vocabulary with the tag shown everywhere else. No new detection
     needed here, `deadline` is already tracked in this snapshot and
     never changes on its own, so this is purely a wording choice on an
     existing signal.
   - **Secondary (what you edited yesterday)**: yesterday's snapshot vs.
     the day-before-yesterday's snapshot. Any of the three fields differ,
     meaning you made an edit during yesterday's session. Comparing
     today's live values against yesterday's snapshot would miss this
     entirely, yesterday's snapshot already bakes the edit in, so this
     needs its own snapshot-to-snapshot comparison, not a live-vs-snapshot
     one. Shown de-emphasized (e.g. smaller text, collapsed by default).
   - **"Became Do Today"**: a third, narrow case, since `do_date` is
     deliberately excluded from the general snapshot fields above (to
     avoid rollover looking like an edit), it needs its own specific
     comparison rather than reuse of either tier. Track `do_date` in the
     snapshot for this one purpose only: report "became Do Today" if
     today's `do_date == today` and yesterday's stored `do_date` was
     `null`. If yesterday's `do_date` was already set to anything, even a
     past date, today's value is mechanically just rollover advancing it
     by one day, not new information, and must not be reported, this is
     the same rollover-isn't-a-change principle applied narrowly rather
     than by excluding the field outright.

Brand-new tasks (no snapshot at all in yesterday's baseline) and tasks
that finished (done/dropped since yesterday) are tracked separately from
the two tiers above, but only "finished" is surfaced on the card — a task
showing up for the first time isn't a quadrant *change* the way a drift,
an edit, or a finish is, and on a heavy capture day it drowned out the
actual drift signal the digest exists to surface.

**Weekly digest, retired.** Considered as a weekly rollup of the same
drift signal, but dropped: "stuck in Plan too long" is already surfaced
per-task by the Overview's staleness check-ins below, and a second weekly
summary would overlap with the Calendar's Weekly Accomplishments panel
without adding a genuinely new signal.

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
  - Each dot carries the same escalating tag (Do Today/Due Today/
    Overdue) from the Now window section, one visual language across the
    whole app rather than a scatter-specific one.
- **Priority summary panel** (right side): shows top tasks by
  `priority_score` for the day. Inclusion rule: a task shows if its rank
  is within `overview_top_n` (default 3), OR its score is ≥
  `overview_flag_threshold` (default 80), whichever is broader. So 3 tasks
  scoring 70/60/50 all show (top-3 rule); 5 tasks scoring 90/90/90/80/70
  show the first four, the 70 is excluded (outside top-3 and below 80).
  Same escalating tag shown per task here too. Directly beneath it in the
  same sidebar column: the Staleness check-ins card (see Daily Digest),
  teal-tiered, its own card rather than folded into the "what changed"
  digest below.
  - **Expandable into a full priority list**: clicking/expanding the
    panel opens every active regular Task, not just the top-N, sorted by
    `priority_score`, scrollable, with basic inline editing. This is a
    third access point, distinct from both List modes below, "just show
    me the raw ranking, regardless of window or folder."
- **Display mode toggle** (`overview_display_mode`, default `scatter`),
  positioned **top-right of the page**: switches between the scatter view above and the quadrant-list style
  already built (four boxes, tasks listed inside each, same tag shown per
  task here as well), same Do/Plan/Clear/Backlog corner layout either
  way. Both modes are worth keeping, the list is better for scanning
  within one quadrant. This top-right position is the shared convention
  all three display-mode toggles use (List and Calendar match it too),
  one consistent location across every page rather than each view
  placing its toggle wherever felt convenient.
- "What changed since yesterday" line(s), unchanged from before
- Read-only glance, no checking things off here

**2. List view** (primary, where work actually happens)
- **Display mode toggle** (`list_display_mode`, default `windows`),
  positioned **top-right**, matching Overview's convention: the
  third of three views with this same two-mode pattern
  (`overview_display_mode`, `calendar_display_mode`). **"windows"**
  (labeled just **"Plate"** in the UI, shorter than spelling out both
  window names) is the Daily Plate/Fridge layout described below.
  **"full"** (labeled just **"List"** in the UI) is the original
  folder/category-based list (category tabs, heat-map rows, Recurring
  habit boxes, everything else in this section as originally specified),
  kept fully intact as a secondary page, not removed, since Now/Later
  cards now show nested subtasks too, "full" is no longer required for
  everyday use, just still available whenever you want the complete
  folder-organized picture. The Overdue callout stays visible regardless
  of mode, it's a safety signal, not something that should disappear
  while browsing List mode. **List mode uses the same icon-only add
  philosophy established for Plate**: no "+ Add task" text links
  anywhere, plain "+" icons throughout (adding a task, adding a folder,
  adding within a category), one consistent minimalist visual language
  across the whole app rather than two different conventions in two
  different views.
- Tabs are Categories ("All" plus one per category); within a category tab,
  tasks are grouped into collapsible Folder sections (e.g. "Finances" and
  "Chores" as two sections inside the Errands tab)
- **Category sections, collapsible with one exception**: when the "All"
  tab is active, each category renders as its own collapsible section
  (folders collapsible within it, same as always). When a single
  category tab is active instead, that category's own section header is
  NOT collapsible, since it's already the sole content on screen,
  collapsing it would just empty the view for no benefit. Folders stay
  collapsible in both cases regardless.
- Nested task list within each folder, with collapsible subtasks
- Checkboxes to mark done, live here
- **Folder count display** (toggleable, `folder_count_display` setting):
  shows either "X active" (counts only top-level tasks, no
  `parent_task_id`, subtasks never inflate it) or "X of Y done" (same
  top-level tasks, framed as completed/total instead). Same underlying
  numbers either way, purely a display choice, switchable so you can see
  which motivates you more.
- **Subtask completion indicator**: any task with subtasks shows a small
  progress bar, computed as completed
  subtasks ÷ total subtasks. **Bar only, no percentage number alongside
  it**, showing both was redundant, one visual signal is enough. Never
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
  *how much*, one formula drives both. Every row also carries the same
  escalating tag (Do Today/Due Today/Overdue) wherever it applies, one
  visual language across the whole app, not something exclusive to Now.
- **Completed tasks hide from the main list starting the next day**: a
  task completed today still shows (struck through) in its folder for
  the rest of today, same as it always has, but from the next day onward
  it's no longer shown here at all. The only remaining way to see it is
  through the Calendar's day-repository (click a day to see everything
  completed that day). This keeps the folder-organized list from slowly
  filling with historical clutter, the Calendar is already the dedicated
  place for looking backward.
- **Overdue callout**: separate from Now, since it answers a different
  question ("act on this exact task right now" vs. "here's what you're
  planning for today"). Membership-based, not ranked: a task qualifies if its
  `deadline` has passed. No new fields or scoring, just a filter on data
  already tracked. A stale, undated task climbing toward "high" urgency
  does not qualify here, staleness alone never reaches critical, only an
  actual missed deadline does. This is the "firefight" window. An
  ad-hoc emergency with no deadline yet is handled by setting `deadline`
  to today, "promote to deadline" in the Now window does exactly this.
  Takes the visual position the now-removed Top banner used to occupy,
  and stays minimal/collapsed when nothing is overdue, only claiming that
  prominent space when it's actually earned it, redundant with sorting
  Now by Do Date in principle, but worth the dedicated, always-visible
  slot precisely because you shouldn't have to remember to switch sort
  modes to notice something overdue with lower priority than the rest.
- **Daily Plate** (renamed from "Now", originally "Do Today"): the companion "intention"
  window, and the actual replacement for the old manual urgent flag, a
  consolidated view of what you're assigning yourself to tackle today,
  independent of the raw urgency number, but still exhaustive of genuine
  urgency. **Membership**: `do_date == today` **OR** current live
  quadrant is Do or Clear, not yet completed, checked live rather than
  relying on any stored write, so a task can never be missed just because
  nothing happened to flag it. Ranking within Now is fully independent of
  `priority_score` for *membership* (though the floor does feed the score
  once `do_date == today` applies). Together with the Overdue callout,
  these are the two independent windows: one for real consequences, one
  for what you told yourself to get done today. **Header count includes
  habits**: the number shown in the window header counts everything
  currently visible there, RecurringTasks included, not just regular
  Tasks, it should reflect the true size of what's on the plate.
  **Cards support adding nested subtasks directly**, a bare "+", not a
  text label, same underlying action the original folder-based list has
  always had, not something that requires opening the full edit form.
  **Completing a parent task cascades down**: checking off a task with
  subtasks marks all of them complete too, one direction only, completing
  a subtask never marks its parent complete, that would be guessing at
  intent the parent hasn't confirmed.
  - **RecurringTasks also surface here**, as a filtered view of the same
    Recurring habit boxes (see Views, "full" List mode below), not a
    second storage location: daily RecurringTasks always show; weekly
    ones show when today matches their weekday, or when today is within
    `weekly_recurring_now_days` (default 3) of the week ending, whichever
    is true. **Monthly works identically**, today matches the scheduled
    day-of-month, or today is within `monthly_recurring_now_days`
    (default 5) of the month ending. A weekly or monthly habit that
    doesn't currently meet its respective condition shows in Fridge
    instead, see that section, the two conditions are
    exact complements so a habit is always in exactly one window, the
    same exhaustiveness principle already governing regular Tasks. They
    participate in none of the scoring/tag system above,
    no importance, urgency, quadrant, or escalating tag, that isolation
    from the matrix stays exactly as originally designed, this is purely
    an additional place they're visible, completion still logs to
    CompletionLog as before.
  - **Cards show nested subtasks**, collapsible, same behavior as the
    original folder-based list. This is what makes the "full" List mode
    below genuinely optional for everyday use rather than something
    you're forced back to just to see subtask structure.
  - **Escalating tag, one slot, most severe wins**: **Do Today**
    (`do_date == today`) < **Due Today** (`deadline == today`) <
    **Overdue** (`deadline < today`, still open). Only the most severe
    applies at any moment, they replace rather than stack, e.g. a task
    that's both `do_date == today` and overdue shows only "Overdue." This
    same tag (see below) is shown everywhere a task appears, not just
    here.
  - **Sorting and view toggle**: a sort-key control offers Priority
    (`priority_score`, default), Urgency, Importance, **Size** (renamed
    from "Quick Win," `is_quick_win` true surfaces first, `priority_score`
    as the secondary tiebreak within each group), or **Do Date**. Five
    options is too many for a segmented toggle, so this is a
    **dropdown**, not the `.view-switch` style used elsewhere. **Both
    this and the flat/by-folder grouping toggle are global**, one shared
    choice across both Daily Plate and Fridge rather than set separately
    per window, changing either in one place updates both. **Positioned
    together**, the sort dropdown sits directly next to the grouping
    toggle in the same shared control strip, rather than living in a
    separate location. The grouping toggle's second option is labeled
    just **"Folder"** (not "by folder"), matching the terse naming
    convention the other options already use.
    - **Which sort keys produce buckets, and why**: Priority and Urgency
      stay flat/unbucketed lists. Urgency's Today/Tomorrow/Later Dates
      bucketing was retired: once the deadline requirement tightened
      (do_date now reliably mirrors deadline in almost every case), it
      ended up landing nearly every task in the same bucket Do Date's
      sort already produces, a real duplication rather than a genuinely
      different view, same reasoning Fridge already applied by keeping
      Urgency flat there. Importance buckets into all **four** levels
      (Low/Medium/
      High/Critical), not just the two used for quadrant placement, a
      finer breakdown than the quadrant split alone. Size buckets into
      **everything else**, no stated name or marker on either state, see
      the Data Model's `is_quick_win` entry, differentiated by card size
      alone. Do Date
      buckets into the same **Today / Tomorrow / Later Dates** scheme,
      but only in Daily Plate, Fridge keeps its own with-date/no-date
      split instead, a day-by-day breakdown doesn't fit
      Fridge's planning-ahead purpose.
    - **Do Date buckets, Daily Plate specifically**: **Today**,
      **Tomorrow**, **Later Dates** (everything from the day after
      tomorrow onward, collapsed into one bucket rather than one group
      per individual date). Fridge keeps its existing **"With date"** /
      **"No date"** split unchanged, a day-by-day breakdown doesn't
      fit Fridge's planning-ahead purpose the way it fits Daily Plate's
      immediate one.
    - **RecurringTasks in the Do Date bucketing**: previously always
      rendered at the bottom regardless of sort mode, which makes sense
      for score-based sorts (they don't participate in scoring at all),
      but not for Do Date, where they have a real, natural day. Daily
      RecurringTasks always go in **Today** (a daily habit's relevant day
      is always today, by definition). Weekly ones go into whichever
      bucket matches their next scheduled occurrence, same as any other
      date would sort.
    - **Drag between Do Date buckets updates `do_date` accordingly**:
      dropping into Tomorrow sets `do_date` to tomorrow; dropping into
      Later Dates sets it to the day after tomorrow, as that bucket's
      representative earliest value.
    - **Per-bucket "+" icon**: in any bucketed sort mode, each
      bucket gets its own add-task affordance that pre-fills whatever
      field values are needed to genuinely belong there (e.g., adding
      from the Tomorrow bucket pre-fills `do_date` to tomorrow; adding
      from the High-importance bucket pre-fills `importance` to High).
      This applies in both Daily Plate and Fridge, for whichever
      bucketing scheme is active in each, and to folder groups too when
      grouped by folder (a folder group is functionally just another
      bucket). **A plain "+" icon**, not a text link, positioned bottom-
      left below the last task in that bucket, the same spot the old
      single "+ Add task" link used to occupy before bucketing existed,
      that one is retired now, its job is fulfilled by one per bucket
      instead of one for the entire window. This establishes the
      app-wide convention: additions are icon-only everywhere, including
      "full"/List mode (see below), one consistent minimalist visual
      language rather than mixing icons and text links.
    - **Drag into any bucket also updates the task's attributes to
      genuinely match it, not just visually relocate it**, provided doing
      so doesn't bypass an existing hard rule, e.g. dragging a task into
      the High-importance bucket without a deadline still triggers the
      Deadline requirement rather than silently violating it. A drag is a
      shortcut for making the underlying change, never a way around a
      rule that would otherwise block it.
    - **Global "+ Add" icon**: a small icon in the
      top-right corner of each window, where the by-folder grouping
      toggle used to sit before it became global, a plain add-task icon
      with no bucket-specific defaults, for when you don't want any of
      the per-bucket pre-fills. Same icon style as the per-bucket ones,
      distinguished by position and job, not by looking different.
    - **Drag across the divider** (Do Date sort mode only): a lighter
      action than deprioritizing below, no reschedule prompt, it just
      toggles whether `do_date == today` and lets the live quadrant
      decide the honest outcome. Dragging a card down past the
      today/future divider clears its "today" status (`do_date` resets
      to `deadline` if one exists, `null` otherwise); if that was the
      only reason it qualified for Now, it correctly leaves, if it's
      still genuinely urgent underneath, it stays, just without the Do
      Today tag. Dragging a card up past the divider sets `do_date` to
      today, same effect as the general drag-in.
    - **Auto-scroll during drag**: dragging a card near the bottom edge
      of the window scrolls it, so a bucket currently out of view can
      actually be reached and dropped into, rather than requiring a
      release, manual scroll, and re-drag.
  - **Drag-and-drop, in**: dragging a task from the main List view into
    Now sets `do_date` to today (applying the urgency floor, which
    reclassifies it into Do or Clear; prompts for a deadline first if
    none exists, see Now-window deadline prompt).
  - **Drag-and-drop, out (deprioritizing)**: splits on *why* the task is
    currently urgent, see the `do_date` entry in the Data Model for the
    full mechanic. In short: if a close deadline is the true driver, a
    prompt requires picking a new one before it leaves, no silent "I'll
    get to it." Otherwise, it's a genuine edit, `do_date` resets (to
    `deadline` if one exists, `null` otherwise) and `last_touched_at`
    legitimately updates, correctly resetting staleness so the task's
    real quadrant settles into Plan or Backlog. This is the heavier
    action, the divider-drag above is the lighter one, both write to the
    same field, they're just two different entry points.
  - **`do_date` is also a plain editable date field** in the shared task
    form (create or edit), not something reachable only through drag
    interactions, same principle as everything else in this app, one
    underlying field, multiple ways to change it.
  - **Adding to Now, form behavior**: no special sync checkbox, the form
    works exactly like the general task intake form, just with different
    defaults depending on how it was opened. Both fields stay
    independently and freely editable afterward, exactly like any other
    field, nothing special to toggle.
    - **General "+ Add to Now"** (the blank, non-bucket-specific icon):
      `do_date` defaults to today, `deadline` also defaults to **today**,
      reversed from the earlier day-after-tomorrow leeway default based
      on real usage, this now matches the Today bucket's own add behavior
      instead of being a special case.
    - **Bucket-specific add** (any Do Date or Urgency bucket's own add
      button): both `do_date` and `deadline` default to that bucket's
      date, adding from Tomorrow sets both to tomorrow, adding from Later
      Dates sets both to the day after tomorrow. This only applies to the
      two date-based bucketing schemes, Importance and Size buckets
      pre-fill their own relevant field (importance level, or
      `is_quick_win`) instead, they have no date to default toward.
    Escalating an existing Now task later ("I really can't miss this
    one") is just editing its `deadline` directly in the full edit form,
    the same plain field edit as anywhere else, no checkbox mechanic
    needed there either. No new scoring logic either way, the existing
    urgency engine already scores a 0-days-out deadline at critical (100),
    so this naturally bumps `priority_score` through the mechanism that
    already exists.
  - **Bite-size distinction, no tag or icon marker**: differentiated by
    **size alone**, a smaller card, and Bite-size cards
    never show the expanded meta line even when the window itself is
    expanded, they're small by definition and don't need the extra
    detail regular cards get. The earlier icon marker was dropped, since
    the state defaults true for nearly every task, a marker on the
    majority state carried no real information, and no replacement
    marker was worth inventing, size is obvious enough on its own. The
    escalating tag names (Do Today/Due
    Today/Overdue) stay plain English, deliberately not themed, adding an
    interpretation step there would work against the clarity those tags
    exist for.
  - **Trash icon**: restore the delete/trash icon to both windows'
    expanded card views, it was dropped somewhere along the way when the
    original main list stopped being the default, and needs to come back
    alongside the pencil icon.
  - **Completing a task, Daily Plate only**: strikethrough immediately on
    check, then after a brief delay it moves into a **"Completed Today"
    folder, collapsed by default, at the bottom of the list**, rather
    than loose items or vanishing entirely. Excluded from the count
    either way, staying there as accomplishment evidence for the rest of
    the day, clearing naturally at the next day boundary. This combines
    an undo grace period (the strikethrough moment) with ongoing "look
    what I did" value (the persisted, tucked-away folder), consistent
    with how this app already treats evidence of completed work elsewhere
    (the Weekly panel's cleared list, the big win marker). This folder exists
    **only in Daily Plate**, not Fridge, "completed today" is inherently
    a Daily Plate concept. Completing a task directly from Fridge doesn't
    create a second folder there, it moves into Daily Plate's Completed
    Today folder instead, there's only ever one canonical place to look
    for everything finished today, regardless of where it was checked
    off. No new storage, `completed_at == today` already identifies this
    set. **Habits follow the same visual resolution, just presented per
    view**: a habit completed today shows crossed out directly in the
    Recurring habit boxes (its permanent home), and if it's currently
    surfacing in Daily Plate as well, it moves into this same Completed
    Today folder alongside regular tasks, rather than a separate habit-
    only version of the concept. Either way it naturally reverts to
    active/uncompleted at the next reset, same as always, this is purely
    about how a completed-today habit displays, not a change to its
    underlying reset behavior.
  - **Pile size indicator, Fire and Ice**: a visual sense of how full
    each window is, dramatic particle accents (not a static icon or
    badge) scaling with count, fire for Daily Plate, ice for Fridge, this
    fits both the literal naming (a hot plate vs. a cold fridge) and the
    elemental pairing at once. Reflects genuine information (how much is
    piling up), not pure decoration. Minimalist plate and fridge icons
    double as each window's expand/focus control, one icon doing both
    the labeling and the functional job rather than a separate generic
    expand affordance.
  - **Compact vs. expanded card detail**: at default (narrower) width, a
    card shows just checkbox, title, and the escalating tag, the minimum
    needed to scan and act. When expanded, cards reveal the fuller meta
    line (folder/context label, quadrant label, the urgency reason text)
    plus an inline quick-win toggle, rather than needing the full edit
    form for small changes.
    - **Daily Plate specifically shows a countdown, not an editable
      date**: "Due in 3 / 2 / 1" for a task with an approaching deadline,
      replaced entirely by the Due Today or Overdue tag once it reaches
      that threshold, never both a "Due in 0" and a tag simultaneously.
      No editable `do_date` field here at all, since anything reaching
      Daily Plate via an explicit action already has `do_date == today`
      trivially, displaying that as an editable value was never adding
      real information. A task with no deadline shows no countdown, just
      whatever tag applies (Do Today, if `do_date == today`) or nothing
      distinctive if present purely via staleness-driven live urgency.
      Seeing or changing the actual `deadline` still happens through the
      full edit form.
  - **Focus mode**: an on-demand overlay, not a persistent third window,
    triggered and dismissed by a single button. **Always vertically
    centered**, regardless of how much content is showing, not just
    centered on open and then free to drift. Background dulled further
    still than the already-heavy dim from the last pass, this should feel
    like real isolation, darker than a typical dim overlay by a wide
    margin. **A soft red glow around the window itself**, a subtle
    accent that reinforces the "this is the urgent stuff" framing without
    being harsh. Filters to
    strictly the Do Today-tagged subset of Now (not all of Now, not
    Later), everything else dimmed/hidden behind it. Reuses the exact
    same drag mechanics as the normal view unchanged, dragging a task out
    (to the dimmed background) triggers the same reschedule prompt if a
    close deadline is the true driver, or the ordinary deprioritize reset
    otherwise. No
    divider needed here, since everything visible already carries the tag
    by definition. This is a rendering mode over existing data, not a new
    membership rule or a new thing to keep in sync, purely a distraction-
    reduction view, the point is focus, not new information. **Should
    reuse the same underlying data function as Do Date sort's Today
    bucket**, not a separate filter implementation, the visible task set
    is intentionally the same, only the presentation (isolation,
    dimming, centering) is genuinely different, no reason to compute it
    twice in two different ways.
- **Fridge** (renamed from "Later", originally "Remember"): **membership is current
  live quadrant Plan or Backlog**, a plain quadrant rule, no special case
  needed, because deprioritizing (above) always forces a real underlying
  change rather than overriding one, a task only ever leaves Now by
  genuinely no longer qualifying, so Later's simple quadrant check always
  lands correctly with no gap between the two windows. Shares the same
  global sort-key dropdown as Daily Plate (Priority/Urgency/Importance/
  Size/Do Date, one choice affecting both windows, see the Daily Plate
  section above for the full bucketing rules, per-bucket add buttons, and
  drag-to-reclassify behavior, all of which apply here too, e.g. the four
  Importance buckets work identically here, letting you see the biggest
  Plan items separated from Backlog at a glance). Do Date's divider splits **"With date"**
  vs. **"No date"** rather than the Today/Tomorrow/Later Dates
  split Daily Plate uses, not every Plan or Backlog task carries a
  `do_date` (only ones with a deadline get one by default), so a
  day-by-day breakdown doesn't fit Fridge's forward-planning purpose the
  way it fits Daily Plate's immediate one. Tasks render with their own
  existing quadrant hue (teal for
  Plan-origin, gray for Backlog-origin), this window doesn't invent a new
  color scheme, it's a filtered view of data that already exists
  elsewhere.
  - **Weekly and Monthly RecurringTasks also surface here**, exactly the
    complement of Daily Plate's own conditions: a weekly habit shows in
    Fridge whenever it does *not* currently match its scheduled weekday
    or fall within `weekly_recurring_now_days` of week's end; a monthly
    one, same logic, its day-of-month or `monthly_recurring_now_days` of
    month's end. This is what makes windows mode fully exhaustive on its
    own, no need to check "full" List mode just to find a habit that
    isn't due soon. Bucket placement mirrors Daily Plate's habit rules
    exactly for both cadences: **Do Date** puts either in **With Date**
    (they always have a scheduled day, even far off). **Size** treats
    them as Bite-size-equivalent, same reasoning as daily habits, no tag,
    sort placement only. **Priority/Urgency/Importance**
    don't bucket habits at all, same as Daily Plate, they render in a
    separate section instead. Habits aren't draggable between buckets,
    unlike regular Tasks, a fixed day is either genuinely required (trash
    day) or deliberately left at the default for anything flexible,
    completing one early is just ticking it off directly, there
    was never a need to reschedule it. Now vs. Later: act on these now, versus don't lose track of
  these. Renders side by side with Daily Plate, both narrower by default;
  either can be focused/expanded to take more width than the other.
  **Expand/collapse behavior**: clicking anywhere non-interactive within
  either window (not a task, button, or dropdown, just empty space
  anywhere in the window, not only the header/sort area) expands that
  window, same action as clicking its plate/fridge icon. Clicking
  anywhere outside both windows collapses them back to the default
  side-by-side state. **Daily Plate is expanded by default** the moment
  you enter this view (windows mode), not a neutral/collapsed starting
  state, it's the one you actually work from.
  - **Inline date editing, expanded only**: when Fridge is the expanded/
    focused panel (not the default narrower width), each card reveals a
    small inline **`do_date` field only**, not `deadline` alongside it,
    same reasoning as Daily Plate: showing both was almost always
    redundant since `do_date` already defaults to `deadline` whenever one
    exists, and it was making cards feel cluttered without adding real
    information. Empty is a legitimate, expected state for a task with no
    scheduled date at all. Collapsed back to default width, cards revert
    to their compact form without this field, keeping the everyday
    side-by-side layout clean. This is the cheaper alternative to a
    separate Planning Mode, same underlying field, just surfaced
    conditionally rather than behind a whole new toggleable state. Fridge
    is where planning actually happens, unlike Daily Plate's countdown
    treatment, a literal editable date makes sense here. **Guard rails,
    both directions**: setting `do_date` to a date after the task's
    `deadline` prompts a warning before allowing it, that combination is
    logically inconsistent, planning to do something after it's already
    due. The reverse also applies: setting `deadline` to a date before
    the existing `do_date` prompts the same warning, **unless `do_date`
    has already rolled over into the past** (`do_date < today`), a stale,
    rolled-over `do_date` isn't a meaningful future commitment anymore,
    just an artifact of the task not being done yet, so it shouldn't
    constrain a new deadline.
  Has its own "+ Add task" affordance, opening the same shared task form
  with no special prefill, unlike Now there's no single default to
  prefill toward, a task's landing in Plan vs. Backlog is derived after
  the fact from importance and urgency, not chosen upfront. The deadline
  requirement still applies automatically if the result would land in
  Plan, that's a global form rule, not something scoped to Now.
- **Empty-Now suggestion**: whenever the Now window has zero tasks (a live
  check each render, not a stored/dismissible flag), the top 3 tasks in
  the Later window (by its default Priority sort) get a visual highlight/
  box around them. They remain individually draggable into Now like any
  other Later task, plus a single "Add all 3" button on the box itself
  that chains the same `addToNow` logic per task (including a deadline
  prompt if any of the three lack one). The highlight disappears the
  moment any task lands in Now, whether via this suggestion or an
  unrelated manual add, since the condition it's based on ("is Now empty")
  is no longer true. This directly serves the app's founding purpose:
  clearing your fires shouldn't mean the important-but-quiet Plan/Backlog
  items get forgotten by default.
- **Recurring habit boxes** (top right, entirely separate from the folder/
  matrix system below): three small boxes, Daily on top, then Weekly,
  then Monthly. Within each box, RecurringTasks are grouped by Folder, collapsible, the
  same pattern as the main List view (e.g. "Work" section listing "Refresh
  report", "Chores" section listing "Dishes", "Cleaning"), just reusing
  the existing Folder grouping rather than a separate system. Each task
  has a checkbox, plus a small, distinct Skip control beside it (never
  styled or positioned so it could be mistaken for the checkbox) that
  sets `skipped_date` instead of completing; each box's completion
  fraction (e.g. "3/5") counts a skipped-for-today task the same as a
  completed one, both are "resolved for today." A task showing
  `missed_last_period` displays its small flag here too ("Missed
  yesterday" / "Missed last week" / "Missed last month"), and a task
  currently skipped shows its own small flag ("Skipped today" /
  "Skipped this week" / "Skipped this month"). Checking one off just sets
  `last_completed_date` and writes a CompletionLog row (also clearing any
  skip already in effect, the completion supersedes it); nothing here
  touches importance, urgency, or the quadrant system, recurring tasks
  never appear in the heat-map or the Overview. This same checkbox +
  Skip pairing appears wherever else a habit surfaces, including the
  Now/Later windows below.

Typical flow: open app → glance at the Overview (10 seconds) → switch
to List view → work through tasks with Daily Plate/Fridge and heat-map colors
carrying the same prioritization without needing to re-check the matrix.
Recurring habits are ticked off separately, in their own boxes, unrelated
to that prioritization flow.

**3. Calendar view** (retrospective, replaces the earlier vague "basic
productivity view")
- Monthly grid, one cell per day
- **Today's day-repository is open by default on load**, not something
  requiring a click. Previously, opening the Calendar (including after a
  refresh) showed nothing expanded until today's date was clicked
  manually, worth fixing since today's own completions are exactly what
  you'd want to see immediately on arriving here, not after an extra
  click.
- **Display mode toggle** (`calendar_display_mode`, default `pace`),
  positioned **top-right**, matching Overview and List's convention:
  switches between the Pace view below (unchanged, still its own thing)
  and a **Capacity view**, which itself splits by whether a day is in the
  past or future, since only one kind of data actually exists for each:
  - **Past days, and today (live)**: effort = sum of `is_quick_win`
    weight (1 point, else 2) over regular Tasks **completed that day**
    (`completed_at` == that day), regardless of whether they were
    planned/do-dated for it, this is deliberately a raw "how much did I
    actually do" volume, not scoped to what was intended. Reads directly
    from `completed_at`, no dependency on the frozen `plannedHistory`
    record. **Plus** a flat 1 point per RecurringTask completion that day
    (via CompletionLog), reusing the same weight quick-win regular Tasks
    get rather than inventing a new number, this closes a real gap,
    recurring habits are genuine effort too.
  - **Future days**: effort = sum of the same weight over regular Tasks
    with `do_date` on that day (not `deadline`), since `do_date`
    represents intended effort distribution, exactly its purpose
    elsewhere in the app, while `deadline` only represents consequence
    timing. This also means proactively moving a task's `do_date` earlier
    than its real deadline correctly lightens the original due day's
    count, since by your own plan there's nothing left pending there,
    that's honest, not a blind spot. Most future tasks show identical
    results either way, since `do_date` defaults to `deadline` when one's
    set, they only diverge when you've deliberately moved something
    earlier. **Plus** a flat 1 point per RecurringTask scheduled that day
    (daily: every future day; weekly: only its scheduled day), same
    signal source as Now's RecurringTask inclusion logic.
  - **Rendering, same for both directions**: `effort / daily_capacity_points`
    as a continuous intensity gradient, one neutral hue, pale → vivid,
    purely descriptive volume with no red/green judgment baked in, same
    non-evaluative principle as the Weekly panel's day-color breakdown.
    A distinct overload marker appears whenever it crosses 100%,
    deliberately not reusing Pace's red hue, since "busy/overloaded" and
    "missed something important" are different claims and shouldn't look
    identical.
  RecurringTasks still don't carry `is_quick_win` themselves, they use
  the flat weight above instead, everything else about their isolation
  from the scoring system (no importance, urgency, or quadrant) stays
  exactly as designed.
- **Color reflects overall day, not habits specifically**, in strict
  priority order (matches the override pattern used elsewhere, e.g. the
  do_date urgency floor):
  1. **Red (rectify)**: a regular Task with a `deadline` on or before
     that day was still open past it (`completed_at` null or later),
     regardless of importance level. This replaces the earlier
     importance-gated Red rule and the separate overdue ring below, any
     genuine deadline miss counts directly now, there's no second tier
     for lower-importance misses.
  2. **Deep blue (good)**: nothing overdue by the Red rule, and
     everything *planned* for that day (RecurringTasks scheduled that
     day, plus regular Tasks with `do_date` exactly that day) got done.
     Uses `do_date`, not `deadline`, a self-chosen task with no deadline
     at all still counts as "planned," so a day full of completed
     undated tasks (gym, cleaning, chores) correctly renders Deep blue
     rather than Gray.
  3. **Pale blue (average)**: nothing overdue by the Red rule, but only
     some of what was planned (same `do_date` definition) got done,
     left for future-you.
  4. **Gray**: nothing was planned at all that day, same "no obligation,
     not a failure" principle as before, not a performance color.
  Red stays fully live-computed always, `deadline` never changes
  retroactively so there's nothing to freeze there. Deep blue/Pale blue/
  Gray for **today** are also computed live. But for **any past day**,
  computing "planned" live from each task's *current* `do_date` breaks
  once rollover exists: a task planned yesterday that wasn't finished
  rolls its `do_date` forward to today, so a live recompute of yesterday
  would show it as never having been planned at all, quietly turning an
  honest Pale-blue day into Deep-blue or Gray after the fact. To prevent
  the calendar from rewriting its own history, freeze each day's planned
  set once, right before daily maintenance rolls incomplete `do_date`s
  forward: record which regular Tasks had `do_date` equal to that day and
  whether each was completed by day's end, plus which RecurringTasks were
  scheduled that day and completed. This is a permanent, append-only
  per-day record (unlike the digest's short 2-3 day rolling window, this
  one persists indefinitely since the calendar can be viewed for any past
  month), captured for free at the exact moment daily maintenance already
  runs, no separate process needed. Once frozen, a day's color never
  changes again regardless of what happens to `do_date` afterward.
- **Big win marker** (independent overlay, layers on any base color,
  replaces the earlier importance-gated "gold glow" and its bite-size-
  exemption-plus-7-day-sitting formula entirely): a new per-task boolean
  `was_ever_in_plan`, set true the first time a task's live quadrant
  computes to Plan, staying true afterward even once urgency later pushes
  it into Do (Plan already implies High/Critical importance by
  construction, no separate importance check needed on this path). On
  completion, a task counts as a big win if EITHER `was_ever_in_plan` is
  true, OR the task was completed after its own `deadline` had already
  passed, a genuine slippage-then-recovery, not just age (this second
  path needs an explicit High/Critical importance check, since a
  Low/Medium deadline miss isn't the same accomplishment and never
  passes through Plan to get the first path's exemption). The marker
  fires on whichever day the qualifying task was completed, independent
  of that day's Red/Deep-blue/Pale-blue/Gray color, a Pale-blue day can
  still show a big win, it doesn't promote the day's tier. A red day can
  still show a big win too, if something important also got cleared.
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
  accented, versus a plain dot for other upcoming deadlines. **Weekly
  RecurringTasks also get a marker** on their scheduled weekday, since
  that's genuinely informative, "Tuesday is laundry day" tells you
  something. **Daily RecurringTasks deliberately don't**, a marker on
  every single day by definition isn't information, it's constant noise,
  and they're already surfaced twice elsewhere (the Recurring habit boxes
  and Now), a third reminder as a calendar dot adds nothing.
- **Click a day** to expand a repository view: every task completed that
  day, regular and recurring, pulled from `completed_at` and CompletionLog
  respectively. No new storage, just a query against data already kept.
- **Weekly Accomplishments panel**: a highlights reel, never a score,
  covering the current (or selected) week:
  - **What you cleared this week**: not a plain list, that's redundant
    with the Calendar's day-repository which already shows exactly that
    detail per day. Instead, a categorical summary of completions across
    the week (e.g. "6 Work, 3 Errands, 2 Recruiting"), descriptive counts
    only, no judgment implied, this genuinely isn't available anywhere
    else since the day-repository is scoped per-day, not aggregated
    across a week.
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
- do_date field (separate from deadline) and the Now window: membership
  is a live union of do_date == today and any task currently in the
  Do/Clear quadrants, exhaustive by construction, no stored write needed
  to guarantee it. A "Do Today" tag marks cards where do_date == today
  specifically. Dragging out deprioritizes rather than just clearing:
  a close deadline forces a reschedule prompt instead of silent "I'll
  get to it," otherwise it's a genuine edit that resets do_date and
  legitimately updates last_touched_at. Sort dropdown offers Priority/
  Urgency/Importance/Size/Do Date, bucketed where a real non-arbitrary
  split exists (Importance, Size, Do Date), flat where it wouldn't
  (Priority, Urgency), with per-bucket add buttons and drag-to-
  reclassify, a global flat/by-folder toggle, editing `deadline` directly
  to escalate a task (no separate checkbox), and size-only Bite-size
  differentiation, no label or marker on either state
- Later window: membership is simply current live quadrant Plan or
  Backlog, no special case needed, since deprioritizing always forces a
  real quadrant change rather than overriding one
- Now/Later cards show nested subtasks, and daily/weekly RecurringTasks
  surface in Now on relevant days (daily always, weekly near week's end
  or on their assigned weekday), without joining the scoring system
- List view display-mode toggle (windows/full), same two-mode pattern as
  Overview and Calendar; "full" keeps the original folder-organized page
  completely intact as a secondary view
- Priority summary panel expands into a full scrollable, editable,
  priority-sorted list of every active task
- Required deadline on High/Critical importance tasks landing in Plan,
  closing the "important but dateless forever" loophole; do_date defaults
  to the deadline so it surfaces at latest by then
- **Quick-capture retired.** The hidden tag-parsing field and its icon
  are gone entirely, no `#folder`/`@date`/`!`/`*` single-line syntax to
  remember for everyday task entry, that friction wasn't worth it for
  how rarely it actually got used. The `N` keyboard shortcut now simply
  opens the regular task form, the same one "+ Add to Now" already
  opens, with the same defaults (do_date and deadline both today). One
  form, one way to add a task, not two competing paths. Bulk Import (see
  below) is unaffected, it's a separate, still-unbuilt v2 feature that
  happens to share the same tag vocabulary for batch-pasting a whole
  list at once, not the same thing as this single-line shortcut.
- Daily digest (snapshot + quadrant changes)
- Weekly digest and Simple daily log, retired: both considered and
  dropped, redundant with signals already covered by the Daily Digest,
  staleness check-ins, and the Calendar's Weekly Accomplishments panel and
  day-repository, Simple daily log in particular was never more than a
  three-word placeholder with no real definition behind it
- Calendar view: day coloring across all tasks (not just habits, red/
  deep-blue/pale-blue/gray), a big win marker, count badge, click-through
  repository, a Capacity view toggle (effort vs. daily_capacity_points,
  using is_quick_win as the effort proxy), and a Weekly Accomplishments
  panel (highlights, never a score)
- Heat-map row coloring in List view, tied to each task's live quadrant

## Visual Design System

Full visual redesign (Overview, Checklist windows and list, Calendar,
modals, Focus mode, light theme, mobile width) is complete as of commit
`30aff16`, editorial/spacious direction inspired by konrad.com's
structural language, cooking motif preserved as functional minimal
line-iconography and naming only, never illustrative.

**Color principle, corrected**: Fire and Ice are reserved for genuine
urgency/quadrant-state signaling (heat-map, Calendar pace coloring, pile
indicators, Focus mode's urgency glow), not the only two colors permitted
anywhere in the app. Other elements that already carried real meaning
through color, habit type, importance badges, the Capacity view, the
"big win" callout, keep distinct color, chosen for coherence with the
new base palette rather than reverting to the old exact hex values. The
rule this replaces ("Fire and Ice are the only two saturated colors")
was read correctly but was underspecified, it meant to block decorative
color creep on chrome/buttons, not strip meaning-bearing color elsewhere.
Each major view (Overview, Checklist, Calendar) also carries a subtle
distinguishing accent, used lightly on that view's typography/framing,
not as a decorative wash.

**Note (this file was edited directly by Claude Code during the initial
visual pass, contrary to the established workflow where only chat edits
this file, worth reconciling manually if any drift remains, and not
repeating going forward).**

**Window borders and fire/ice restored**: Daily Plate's border, icon, and
header text carry fire (amber/red) coloring; Fridge's carry ice (blue),
lost briefly during the color-scope overcorrection above and restored.
The overdue glow (on individual overdue task cards) is likewise restored.

**Window delineation**: Daily Plate, Fridge, the Overview scatter plot,
and the Priority view each carry a subtle boundary (hairline border or a
slightly distinct panel background) so they read as separated, still no
soft drop-shadows, this is separation, not a card treatment.

**Category tabs, built**: the Daily Plate/Fridge windows and the main
List view share one category-tab mechanism (not two separate
implementations), assignable colors per category. In Plate view, these
live in the top banner, same placement as List view, not floating above
the Daily Plate window. The same top-banner category filter extends to
Overview and Calendar as well, one filter row usable everywhere, not
List-view-only.

**Quadrant legend key**: shown consistently in Plate view too, not just
List/Checklist, so both views carry the same "hue = quadrant, intensity =
priority" reference.

**Color system (tabs and categories)**: box-based, not pill-shaped,
consistent with the app's existing rectangular/hairline-border language.
- Inactive: thin underline only, in that tab/category's color. Label
  text and icon stay neutral.
- Hover: a rectangular border (small radius, matching panel corners, not
  a rounded pill) appears in that color. Label text and any adjacent
  icon shift to the same color together, not just the border alone.
- Active: the box fills solid with that color, label text and icon go
  high-contrast for legibility against the fill.
- Applies uniformly to view tabs (Overview/Checklist/Calendar) and
  category tabs, one mechanism, not two.
- Exception: the app title/icon stays neutral always. It's a brand mark,
  not a state indicator, and does not take on any tab's or category's
  color, matching how Konrad's own wordmark stays static through every
  section's color shifts. It keeps its own hover treatment (below) only.
- Folder color-coding (within List/Checklist content, not just the
  top-banner tabs) extends beyond the small dot to font color and/or the
  section-divider lines, the dividers are no longer hardcoded green,
  they carry each folder's own color.

**Toggles**: any toggle control keeps the same screen position across
every view it appears in (switching views shouldn't require re-finding
it). Implemented as a single button-style toggle rather than a
multi-option control; on hover, the button's label text-rolls to preview
the destination state's name, reusing the text-roll mechanism below
rather than a separate hover treatment. The Flat/Folder toggle exists in
both List/Checklist and Plate view, same mechanism in both places.

**Motion system**, one signature easing curve throughout,
`cubic-bezier(0.22, 1, 0.36, 1)`, at different speeds by scale (~0.18s
small UI, ~0.3s medium, ~0.4-0.5s large/full-view transitions). Plain CSS
by default, no animation library, that's a standing CLAUDE.md rule, not
just a one-off choice; an animation library is a deliberate, flagged
exception only when CSS genuinely can't achieve the effect (native
`scroll-behavior: smooth`'s limited curve is the one confirmed case so
far, see Smooth scroll below).
- **Text-roll**: stacked duplicate text in a clipped container,
  translated on hover to swap in the duplicate. Applies to clickable
  text broadly, tabs, toggle labels, and most icons (Daily Plate/Fridge
  icons etc.) as the default icon-hover treatment too.
- **Icon motion exceptions**, where a more specific, shape-appropriate
  gesture fits better than the roll default:
  - Pile-size glyph (see below): scales up from baseline instead, on
    both hover and task-add, not roll.
  - App title icon: hop + rotate per utensil (fork, then plate, then
    knife, staggered ~60-80ms apart), a quick upward translate paired
    with a small rotational wiggle around each piece's own pivot, single
    play on hover, not a loop.
  - Focus mode's trigger icon: "scope in", a quick zoom/scale read as
    looking through a sniper scope, distinct from roll or hop+rotate.
  - A "+" add icon: a quarter turn on click/hover where that reads as
    the more natural gesture for the shape.
  Roll stays the default otherwise, these are named exceptions, not a
  blanket ban, lean toward fully static for icons that repeat densely
  (every list row, every card) so motion still reads as a flourish.
- **Staggered reveal**: category changes and toggle-view changes (not
  the main view-tab switch, see Tab-switch slide below) use a row-rise:
  matching rows fade in and translate up, staggered per row, delay =
  80ms + (index × 60ms), ~280ms per row. Same math for dropdown/menu
  panels generally.
- **Tab-switch slide**: switching between Overview/Checklist/Calendar
  specifically slides content horizontally, direction follows tab order,
  ~0.4-0.5s. Scoped to these three, not category or toggle changes.
- **Scroll reveal**: major section headings/text blocks split into lines,
  each clipped and sliding up into place as it enters the viewport, tied
  to scroll position. Used sparingly, major headers only.
- **Smooth scroll**: an eased, slightly lagged scroll feel throughout,
  and the same motion drives auto-scroll-to-top on tab change. This is
  the one confirmed case where plain CSS (`scroll-behavior: smooth`)
  wasn't enough, its curve is too fixed/limited to reproduce the actual
  lagged feel, so a lightweight scroll library (Lenis) is the flagged
  exception here specifically.
- **Sequencing rule**: auto-scroll-to-top always runs *after* whatever
  entrance transition (slide or row-rise) finishes, never concurrently,
  concurrent horizontal-plus-vertical motion reads as an unwanted
  diagonal, not two clean motions.
- **No snap transitions, standing rule**: every view/filter/screen
  change animates, never cuts instantly. Exception: persistent/shared
  chrome (the Daily Plate/Fridge window frames themselves) stays static
  while only the content inside animates out and in, for content-only
  changes.
- **Reciprocal animations, standing rule**: any entrance animation needs
  a matching exit in reverse, not a plain fade or instant close. Focus
  mode is the worked example: scope-in entry (scale up from ~0.85 to
  1.0, brief vignette that dissipates as the scale-in finishes, no
  vignette lingering) pairs with a scope-out exit.
- **Popup animations**: task form and settings popups (and popups
  generally) get both entrance and exit motion, per the reciprocal rule,
  they previously had none.

**Pile-size glyph** (replaces a plain per-task-count row of triangle
marks): a five-stage threshold indicator, not one mark per task. One
consistent five-triangle composition at every stage (2 back triangles
tallest/flanking, 2 mid triangles shorter/inset, 1 front triangle
shortest/centered, all overlapping on a shared flush baseline, solid
fill per tier, not opacity-shaded, no rotation, apex up), the same
glyph scaled larger per stage rather than redrawn, height scaling faster
than width so it climbs rather than just widening. Stage thresholds are
a tuning question against real usage, not fixed. On hover, and on adding
a task ("stoked"), the glyph scales up from its baseline (not centered/
outward, and not the icon-roll treatment), with an optional soft glow,
then eases back to resting size, this is its own mechanism, separate
from the icon-hover roll.

**Calendar-specific color** is specified in its own section above; this
section covers the shared cross-app color/motion language only.

## Backlog (v2+, not in scope now)
- Bulk import via AI parsing of unstructured pasted text (ongoing API cost
  per use — start with template/tag-based parsing instead, see below)
- (Daily time-capacity limits moved out of Backlog and into the Calendar
  view spec below, using is_quick_win as the effort proxy instead of a
  new estimate field)
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
call, no ongoing cost), pasted directly into a paste box in the app, no
file upload:
- `#folder` — assigns folder (and its parent category)
- `@friday` / `@2026-10-01` — sets deadline
- `!` — sets `deadline` to today (the ad-hoc-fire equivalent, since the
  separate urgent flag was removed, see Urgency Engine)
- `*` — sets `do_date` to today without touching `deadline`, for
  intention-to-tackle-today without a real due date
Tags can combine on one line, folder tag always first if present.
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
6. Calendar view: day coloring (red/deep-blue/pale-blue/gray priority
   rules), big win marker overlay, count badge for regular task
   completions, click-through day repository, Weekly Accomplishments
   panel (cleared list, biggest win only)
7. Polish pass (styling, keyboard shortcuts, quick-capture)

Commit to git after each phase.
