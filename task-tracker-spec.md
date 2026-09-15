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
- deadline (nullable)
- importance: Low | Medium | High | Critical (manual, user-set), mapped to
  25 / 50 / 75 / 100 for scoring purposes. Bucketed as Low/Medium → "Low
  importance" and High/Critical → "High importance" for quadrant placement,
  the same pattern urgency uses.
- manual_urgent_flag: bool (ad-hoc fire override)
- recurrence: none | daily | weekly(+weekday)
- status: active | done | dropped
- completed_at (nullable)

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
3. **manual_urgent_flag = true:** score forced to 100 regardless of the above.

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
| near_extreme_threshold | 80 |

`last_touched_at` updates whenever the task is edited, commented on, or
manually "bumped" — this is what lets an important, deadline-less task
still climb the matrix if it's being ignored.

## Eisenhower Quadrant Mapping

| Importance \ Urgency | Low/Medium | High/Critical |
|---|---|---|
| **High/Critical** | Q2 — Plan | Q1 — Do Now |
| **Low/Medium** | Q4 — Eliminate | Q3 — Delegate/Quick Win |

Quadrant is derived, not stored — recalculated from importance (bucketed)
and current urgency score every time the matrix is rendered.

## Daily Digest

Generated fresh each day, entirely mechanical — no AI/API call, no ongoing
cost, works offline. Two parts:
1. **Current snapshot:** tasks grouped by quadrant, right now.
2. **What changed since yesterday:** any task whose quadrant shifted, with a
   one-line reason (e.g., "→ Do Now: deadline in 2 days" / "aging in Q2:
   untouched 9 days"). Requires storing yesterday's quadrant per task to diff
   against.

Weekly digest = same idea, rolled up: what's trending toward Q1, what's been
sitting in Q2 too long.

## Views

The app has two views, not one combined screen:

**1. Matrix / Digest view** (orientation, not execution)
- The 2x2 Eisenhower grid, current snapshot
- "What changed since yesterday" line(s)
- Read-only glance, no checking things off here

**2. List view** (primary, where work actually happens)
- Tabs are Categories ("All" plus one per category); within a category tab,
  tasks are grouped into collapsible Folder sections (e.g. "Finances" and
  "Chores" as two sections inside the Errands tab)
- Nested task list within each folder, with collapsible subtasks
- Checkboxes to mark done, live here
- **Active count** (shown per folder, e.g. "4 active"): counts only
  top-level tasks (no `parent_task_id`), never subtasks. Subtask count is a
  documentation-granularity choice, not additional workload, so it must
  never inflate this number.
- **Subtask completion percentage**: any task with subtasks shows a small
  progress indicator (e.g. a thin bar or "67%"), computed as completed
  subtasks ÷ total subtasks, rounded to the nearest whole number. Never
  shown on tasks with zero subtasks. Purely visual, no setting, no
  threshold, nothing to configure.
- **Heat-map coloring**: each task row is tinted by its current quadrant
  (e.g. Do Now = warm/coral, Plan = teal, Quick win = amber, low-priority =
  neutral gray). This carries the matrix concept into the view where you're
  actually working, instead of requiring a second screen to know what
  matters.
- **Near-extreme flag** (independent of quadrant color): a task also gets a
  distinct visual marker whenever *either* its urgency score or its
  importance score alone crosses `near_extreme_threshold` (default 80),
  regardless of the other axis. This catches the two cases a single
  quadrant color hides: an urgent-but-unimportant task climbing toward
  critical (easy to write off as "not important"), and an
  important-but-not-urgent task sitting at high importance (easy to miss
  because nothing feels time-pressured). One threshold, checked against
  each axis independently, no combined logic needed.
- **Top banner**: always-visible strip showing the top 3-5 most urgent/
  important tasks across all folders, regardless of which folder filter is
  active, so the highest-priority items are never scrolled out of view.

Typical flow: open app → glance at Matrix/Digest view (10 seconds) → switch
to List view → work through tasks with the top banner and heat-map colors
carrying the same prioritization without needing to re-check the matrix.

## Feature List (v1)

- Categories (Work / Errands / Recruiting, extensible) containing folders
  (e.g. Finances, Chores), both collapsible
- Nested tasks (subtasks under tasks, also collapsible)
- Daily and weekly recurrence
- Manual urgent flag for true ad-hoc fires
- Deadline field with the dynamic urgency engine above
- Quick-capture box (frictionless add, sort later)
- Daily digest (snapshot + quadrant changes)
- Weekly digest (trend view)
- Simple daily log: completed / rolled over / dropped
- Basic productivity view: completion rate by category over time
- Evening review: incomplete tasks require a conscious choice to roll to
  tomorrow, drop, or push to Someday/Maybe — never a silent auto-carry
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
- `!` — sets manual_urgent_flag
Unrecognized lines still import as plain tasks in an Inbox folder (under an
Inbox category) for manual sorting.

## Build Phases (for Claude Code, one phase at a time)
1. List view skeleton: folders, collapsible nested tasks, add/edit/delete,
   folder filter + "All" top banner
2. Storage: File System Access API pointed at an OneDrive folder, with
   automatic IndexedDB fallback if unsupported
3. Recurrence logic (daily/weekly task generation)
4. Urgency engine + quadrant derivation (read thresholds from Settings, not
   hardcoded); apply as heat-map coloring on List view rows
5. Matrix/Digest view (2x2 grid) with change-tracking since yesterday
6. Daily log + productivity view
7. Polish pass (styling, keyboard shortcuts, quick-capture)

Commit to git after each phase.
