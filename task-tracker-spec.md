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
  safety net.
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
- is_quick_win: bool — "knock it out" (quick win) vs "need to tackle"
  sizing, purely a display/organization tag, no effect on scoring. Defaults
  to true when a task is manually added to Now (dragged or created there
  directly, i.e. `do_date` was explicitly set to today), false otherwise,
  including for tasks that qualify for Now purely via the live quadrant
  check with no `do_date` set. Toggleable either way from the task's
  info. Quick-win tasks render as a smaller card in the Now window.
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
| daily_capacity_points | 6 |
| calendar_display_mode | pace |

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
- **Display mode toggle** (`overview_display_mode`, default `scatter`):
  switches between the scatter view above and the quadrant-list style
  already built (four boxes, tasks listed inside each, same tag shown per
  task here as well), same Do/Plan/Clear/Backlog corner layout either
  way. Both modes are worth keeping, the list is better for scanning
  within one quadrant.
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
  *how much*, one formula drives both. Every row also carries the same
  escalating tag (Do Today/Due Today/Overdue) wherever it applies, one
  visual language across the whole app, not something exclusive to Now.
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
  for what you told yourself to get done today.
  - **Escalating tag, one slot, most severe wins**: **Do Today**
    (`do_date == today`) < **Due Today** (`deadline == today`) <
    **Overdue** (`deadline < today`, still open). Only the most severe
    applies at any moment, they replace rather than stack, e.g. a task
    that's both `do_date == today` and overdue shows only "Overdue." This
    same tag (see below) is shown everywhere a task appears, not just
    here.
  - **Sorting and view toggle**: a sort-key control offers Priority
    (`priority_score`, default), Urgency, Importance, Quick Win
    (`is_quick_win` true surfaces first, `priority_score` as the
    secondary tiebreak within each group), or **Do Date** (chronological
    ascending, `priority_score` as the secondary tiebreak within each
    date, with a thin divider line between date groups). Five options is
    too many for a segmented toggle, so this is a **dropdown**, not the
    `.view-switch` style used elsewhere. A separate toggle still switches
    between a flat sorted list and the existing by-folder grouping, same
    pattern as `overview_display_mode`.
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
  - **Deadline sync in the task form**: not a standalone control on the
    rendered card, a checkbox inside the shared task form (create or
    edit), shown only when the form currently has a `do_date` set (this
    is what naturally excludes Later's intake, which doesn't prefill
    `do_date`, no second form needed). Labeled something like "Same as do
    date," checking it copies `do_date`'s value into the `deadline`
    field, same convenience shape as a "billing address same as
    residential" checkbox. Covers both creating a new task via "+ Add to
    Now" (do_date prefilled to today, one click sets deadline to today
    too) and later editing an existing Now task to escalate it ("I really
    can't miss this one," opened via the pencil icon). No new scoring
    logic, the existing urgency engine already scores a 0-days-out
    deadline at critical (100), so this naturally bumps `priority_score`
    through the mechanism that already exists.
  - **Quick-win sizing**: see `is_quick_win` in the Data Model, renders as
    a smaller card for quick wins.
  - **Compact vs. expanded card detail**, symmetric with Later's inline
    date editing: at default (narrower) width, a card shows just
    checkbox, title, and the escalating tag, the minimum needed to scan
    and act. When Now is the expanded/focused panel, cards reveal the
    fuller meta line (folder/context label, quadrant label, the urgency
    reason text, e.g. "deadline in 2 days" or "untouched 9 days", and due
    date), plus inline editable `do_date` and `deadline` fields and an
    inline quick-win toggle, rather than needing the full edit form for
    small changes. Proactively editing `deadline` inline here before
    dragging a task out sidesteps the reschedule prompt entirely, since
    the deadline's already been dealt with by the time you drag.
  - **Focus mode**: an on-demand overlay, not a persistent third window,
    triggered and dismissed by a single button. Filters to strictly the
    Do Today-tagged subset of Now (not all of Now, not Later), everything
    else dimmed/hidden behind it. Reuses the exact same drag mechanics as
    the normal view unchanged, dragging a task out (to the dimmed
    background) triggers the same reschedule prompt if a close deadline
    is the true driver, or the ordinary deprioritize reset otherwise. No
    divider needed here, since everything visible already carries the tag
    by definition. This is a rendering mode over existing data, not a new
    membership rule or a new thing to keep in sync, purely a distraction-
    reduction view.
- **Later window** (renamed from "Remember"): **membership is current
  live quadrant Plan or Backlog**, a plain quadrant rule, no special case
  needed, because deprioritizing (above) always forces a real underlying
  change rather than overriding one, a task only ever leaves Now by
  genuinely no longer qualifying, so Later's simple quadrant check always
  lands correctly with no gap between the two windows. Same sort-key
  dropdown as Now (Priority/Urgency/Importance/Quick Win/Do Date), useful
  here specifically for spotting the biggest Plan items by Importance,
  what's creeping closest to urgent by Urgency, or what's coming up next
  by Do Date. In Later's case, Do Date's divider splits **with date** vs.
  **without date** rather than chronological groups, not every Plan or
  Backlog task carries a `do_date` (only ones with a deadline get one by
  default), so "chronological" doesn't cleanly apply to the undated ones.
  Tasks render with their own existing quadrant hue (teal for
  Plan-origin, gray for Backlog-origin), this window doesn't invent a new
  color scheme, it's a filtered view of data that already exists
  elsewhere. Now vs. Later: act on these now, versus don't lose track of
  these. Renders side by side with Now, both narrower by default; either
  can be focused/expanded to take more width than the other.
  - **Inline date editing, expanded only**: when Later is the expanded/
    focused panel (not the default narrower width), each card reveals
    small inline `do_date` and `deadline` fields directly, no need to
    open the full edit form for a quick date assignment. Collapsed back
    to default width, cards revert to their compact form without these
    fields, keeping the everyday side-by-side layout clean. This is the
    cheaper alternative to a separate Planning Mode, same underlying
    fields, just surfaced conditionally rather than behind a whole new
    toggleable state.
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
- **Display mode toggle** (`calendar_display_mode`, default `pace`):
  switches between the Pace view below (unchanged, still its own thing)
  and a **Capacity view**, which itself splits by whether a day is in the
  past or future, since only one kind of data actually exists for each:
  - **Past days, and today (live)**: effort = sum of `is_quick_win`
    weight (1 point, else 2) over regular Tasks **completed that day**
    (`completed_at` == that day), regardless of whether they were
    planned/do-dated for it, this is deliberately a raw "how much did I
    actually do" volume, not scoped to what was intended. Reads directly
    from `completed_at`, no dependency on the frozen `plannedHistory`
    record.
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
    earlier.
  - **Rendering, same for both directions**: `effort / daily_capacity_points`
    as a continuous intensity gradient, one neutral hue, pale → vivid,
    purely descriptive volume with no red/green judgment baked in, same
    non-evaluative principle as the Weekly panel's day-color breakdown.
    A distinct overload marker appears whenever it crosses 100%,
    deliberately not reusing Pace's red hue, since "busy/overloaded" and
    "missed something important" are different claims and shouldn't look
    identical.
  RecurringTasks don't carry `is_quick_win` and stay outside this
  entirely, consistent with how they're isolated everywhere else in the
  matrix system.
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
- do_date field (separate from deadline) and the Now window: membership
  is a live union of do_date == today and any task currently in the
  Do/Clear quadrants, exhaustive by construction, no stored write needed
  to guarantee it. A "Do Today" tag marks cards where do_date == today
  specifically. Dragging out deprioritizes rather than just clearing:
  a close deadline forces a reschedule prompt instead of silent "I'll
  get to it," otherwise it's a genuine edit that resets do_date and
  legitimately updates last_touched_at. Sort dropdown offers Priority/
  Urgency/Importance/Quick Win/Do Date, with a flat/by-folder toggle, a
  checkbox to promote to a real deadline, and quick-win vs. need-to-
  tackle sizing
- Later window: membership is simply current live quadrant Plan or
  Backlog, no special case needed, since deprioritizing always forces a
  real quadrant change rather than overriding one
- Required deadline on High/Critical importance tasks landing in Plan,
  closing the "important but dateless forever" loophole; do_date defaults
  to the deadline so it surfaces at latest by then
- Quick-capture box (frictionless add, sort later)
- Daily digest (snapshot + quadrant changes)
- Weekly digest (trend view)
- Simple daily log: completed / rolled over / dropped
- Calendar view: pace-based coloring across all tasks (not just habits),
  gold glow for big wins, count badge, click-through repository, a
  Capacity view toggle (effort vs. daily_capacity_points, using
  is_quick_win as the effort proxy), and a Weekly Accomplishments panel
  (highlights, never a score)
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
