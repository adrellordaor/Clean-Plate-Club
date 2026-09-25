// List view — categories, folders, nested tasks, add/edit/delete, category filter, the
// Overdue callout, and the windows/full display-mode toggle (the Now/Later windows themselves
// are in windows.js). Data is persisted through storage.js (folder file via File System
// Access API, IndexedDB fallback).

// Random ids so tasks created on two devices before a OneDrive sync can't collide.
function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DATA_VERSION = 8; // v3: settings object; v4: quadrantHistory (daily digest); v5: quadrantHistory
// records enriched with deadline/importance/last_touched_at/priority_score, for the primary
// (automatic drift) vs secondary (manual edit) digest split; v6: manual_urgent_flag removed
// (migrated to deadline = today / do_date = today), do_date + is_quick_win added to Task,
// plannedHistory (permanent per-day frozen "planned" sets for the Calendar) added; v7: Now
// window rebuilt as a live union (do_date == today OR quadrant Do/Clear) — the old
// transition-detection auto-population is gone, so quadrantHistory and every do_date written
// under that design are discarded once (resetToV7), not migrated; snapshot records gain a
// do_date key for the digest's "became Do Today" check; v8: CompletionLog rows gain a title
// snapshot (so a completion outlives its parent RecurringTask being deleted) — existing rows
// are backfilled once from their still-existing parent, if any (migrateCompletionLogToV8)

// Minimalist outline icons (stroke = currentColor, so they inherit button text color).
const SVG_ATTRS = 'viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  pencil: `<svg ${SVG_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  trash: `<svg ${SVG_ATTRS}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
  sun: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>`,
  moon: `<svg ${SVG_ATTRS}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`,
  gear: `<svg class="icon-gear" ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  bump: `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`,
  focus: `<svg class="icon-focus" ${SVG_ATTRS}><circle cx="12" cy="12" r="8"/><circle class="icon-focus-dot" cx="12" cy="12" r="2.5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>`,
  close: `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  plus: `<svg class="icon-plus" ${SVG_ATTRS}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  // Skip: double-chevron "skip forward," distinct from the checkbox and from edit/delete.
  skip: `<svg ${SVG_ATTRS}><path d="m5 4 6 8-6 8"/><path d="m13 4 6 8-6 8"/></svg>`,
  // Bite-size marker: a small apple with a bite out of it, drawn at 12px on cards.
  bite: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-1.5-1.5-4.5-1.5-6 1-2 3-1 8 1.5 11 1.2 1.5 3 1.5 4.5.5 1.5 1 3.3 1 4.5-.5a10 10 0 0 0 2.2-4.5c-2.5-.2-4.2-2.3-3.7-4.8-1-.3-2-1.5-3-2.7Z"/><path d="M12 6c0-2 1-3 3-3.5"/></svg>`,
  // Bulk import: an arrow dropping into a tray.
  import: `<svg class="icon-import" ${SVG_ATTRS}><g class="icon-import-arrow"><path d="M12 3v11"/><path d="m7 10 5 5 5-5"/></g><path d="M4 21h16"/></svg>`,
  // Previous / next (Calendar month and week navigation).
  prev: `<svg class="icon-prev" ${SVG_ATTRS}><path d="m15 5-7 7 7 7"/></svg>`,
  next: `<svg class="icon-next" ${SVG_ATTRS}><path d="m9 5 7 7-7 7"/></svg>`,
};

// Roll: two icon states stacked in a clipped box (.roll in style.css); hovering the button the
// roll sits in slides the stack up one step, so the second state rolls into view. `back`
// defaults to the same icon (a plain roll); pass a different one to preview what a click does
// (the Plate/Fridge expand icons). Roll is the fallback hover for prominent standalone icon
// buttons: an icon whose shape suggests its own minimal gesture gets that instead (the "+"
// turns, arrows nudge, the gear turns, the theme toggle flips, Focus mode's reticle scopes in —
// "Shape gestures" in style.css). Not used on the small hover-revealed actions on cards and
// rows, which already appear on hover.
function rollIcon(front, back = front) {
  return `<span class="roll" aria-hidden="true">${front}${back}</span>`;
}

// Text roll: the same roll for clickable text and tab labels. The label becomes a clipped track
// (.text-roll) holding the text plus a stacked duplicate just below it (.text-roll-face and its
// ::after in style.css, which copies data-text); hovering or keyboard-focusing the control
// slides the track up one step, so the duplicate rolls into view. Applied automatically to every
// matching control — including ones re-rendered later, via the observer — as long as its whole
// content is one plain text label; single-character controls ("+", "×") are left alone. The
// duplicate lives in CSS, so the control's text (and what screen readers hear) is unchanged. A
// control with data-roll-to rolls to that text instead of a copy of its own (the mode toggles).
const TEXT_ROLL_SELECTOR = ".view-switch-btn, .mode-toggle, .folder-tab, .link-btn, .btn, .size-toggle, .window-chip, .window-bucket-add-labeled > span";

function applyTextRoll(el) {
  if (el.childNodes.length !== 1 || el.firstChild.nodeType !== Node.TEXT_NODE) return;
  const text = el.textContent;
  if (text.trim().length < 2) return;
  const track = document.createElement("span");
  track.className = "text-roll";
  const face = document.createElement("span");
  face.className = "text-roll-face";
  face.dataset.text = el.dataset.rollTo || text; // a mode toggle rolls to the mode it switches to
  face.textContent = text;
  track.appendChild(face);
  el.replaceChildren(track);
}

function applyTextRollWithin(root) {
  if (root.matches(TEXT_ROLL_SELECTOR)) applyTextRoll(root);
  root.querySelectorAll(TEXT_ROLL_SELECTOR).forEach(applyTextRoll);
}

applyTextRollWithin(document.body);
new MutationObserver(mutations => {
  for (const m of mutations) {
    // A control whose label was just replaced (e.g. textContent set again on re-render)...
    if (m.target.nodeType === Node.ELEMENT_NODE && m.target.matches(TEXT_ROLL_SELECTOR)) applyTextRoll(m.target);
    // ...and any newly rendered controls.
    m.addedNodes.forEach(n => { if (n.nodeType === Node.ELEMENT_NODE) applyTextRollWithin(n); });
  }
}).observe(document.body, { childList: true, subtree: true });

// Flip: a two-sided icon (.flip in style.css) for an on/off toggle — hovering its button turns
// it over like a card to show its other side (the theme toggle's sun and moon).
function flipIcon(front, back) {
  return `<span class="flip" aria-hidden="true">${front}${back}</span>`;
}

// Daily Plate / Fridge icons: bigger than the rest of the icon set (this pair doubles as each
// window's expand/focus control, so they need to read as more than a generic small glyph) and
// state-aware — the plate's lid comes off when Daily Plate is expanded, the fridge door opens
// when Fridge is expanded, covered/closed otherwise, the same on/off-through-appearance language as
// the Bite-size toggle rather than a text or icon-shape swap for "expand" vs. "shrink".
const PLACE_ICON_ATTRS = 'viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

// Daily Plate: a covered dish (cloche over a plate line) at rest; expanded, the lid is off and
// steam rises from what's on the plate — "served hot", which also ties it to the Fire pile.
function plateIcon(served) {
  if (served) {
    return `<svg ${PLACE_ICON_ATTRS}>`
      + '<path d="M3 18.5h18"/>'
      + '<path d="M6.5 18.5c1-2.4 3-3.5 5.5-3.5s4.5 1.1 5.5 3.5"/>'
      + '<path d="M8.5 11.5c-1-1.3 1-2.2 0-3.6"/><path d="M12 10.5c-1-1.3 1-2.2 0-3.6"/><path d="M15.5 11.5c-1-1.3 1-2.2 0-3.6"/>'
      + "</svg>";
  }
  return `<svg ${PLACE_ICON_ATTRS}>`
    + '<path d="M3 18.5h18"/>'
    + '<path d="M5 18.5a7 7 0 0 1 14 0"/>'
    + '<path d="M12 11.5V10"/><circle cx="12" cy="8.8" r="1"/>'
    + "</svg>";
}

// Fridge: an upright two-door fridge (freezer divide, two handle ticks) at rest; expanded, the
// door swings open to the left and the shelves show — the same "revealed" state as the plate.
function fridgeIcon(open) {
  if (open) {
    return `<svg ${PLACE_ICON_ATTRS}>`
      + '<rect x="9" y="2" width="11" height="20" rx="1.5"/>'
      + '<path d="M9 2.5 4 4.5v15l5 2"/>'
      + '<path d="M11.5 9h6"/><path d="M11.5 15h6"/>'
      + "</svg>";
  }
  return `<svg ${PLACE_ICON_ATTRS}>`
    + '<rect x="6" y="2" width="12" height="20" rx="1.5"/>'
    + '<path d="M6 9h12"/>'
    + '<path d="M9 4.5v2"/><path d="M9 11.5v4"/>'
    + "</svg>";
}

let categories = []; // Category: top-level grouping, drives the tabs.
let folders = [];    // Folder: a named grouping within a category (e.g. "Finances" inside Errands).
let tasks = [];
let recurringTasks = []; // RecurringTask: singular, resets on schedule, outside the Eisenhower matrix.
let completionLog = [];  // CompletionLog: one row per recurring-task check-off, feeds future history views.
let settings = normalizeSettings(null); // Urgency thresholds etc. (see urgency.js); synced with the data file.
let quadrantHistory = {}; // "YYYY-MM-DD" -> { taskId: record }, a short rolling window of daily snapshots (see digest.js).
let plannedHistory = {};  // "YYYY-MM-DD" -> { tasks: [{id,title,done}], recurring: [...] }, frozen once per past day,
// kept forever (the Calendar looks back indefinitely). See runDailyMaintenance and calendar.js.

function seedDefaults() {
  categories = [
    { id: "c-work", name: "Work" },
    { id: "c-errands", name: "Errands" },
    { id: "c-recruiting", name: "Recruiting" },
  ];
  folders = [
    { id: "f-work", category_id: "c-work", name: "Work" },
    { id: "f-errands-chores", category_id: "c-errands", name: "Chores" },
    { id: "f-errands-finances", category_id: "c-errands", name: "Finances" },
    { id: "f-recruiting", category_id: "c-recruiting", name: "Recruiting" },
  ];
  tasks = [];
  recurringTasks = [];
  completionLog = [];
  settings = normalizeSettings(null);
  quadrantHistory = {};
  plannedHistory = {};
}

function loadState(data) {
  if (!data) {
    seedDefaults();
    persist();
    return;
  }
  categories = data.categories || [];
  folders = data.folders || [];
  tasks = data.tasks || [];
  recurringTasks = data.recurringTasks || [];
  completionLog = data.completionLog || [];
  settings = normalizeSettings(data.settings); // older files without settings get the defaults
  quadrantHistory = data.quadrantHistory && typeof data.quadrantHistory === "object" ? data.quadrantHistory : {};
  sanitizeQuadrantHistory(quadrantHistory); // drop any pre-v5 day stored as a bare quadrant-key string
  plannedHistory = data.plannedHistory && typeof data.plannedHistory === "object" ? data.plannedHistory : {};
  const version = Number(data.version) || 0;
  if (version < 6) migrateTasksToV6(tasks, todayISODate());
  if (version < 7) quadrantHistory = resetToV7(tasks);
  if (version < 8) migrateCompletionLogToV8(completionLog, recurringTasks);
  tasks.forEach(normalizeTaskFields);
  recurringTasks.forEach(normalizeRecurringFields);
}

// One-time v8 backfill, gated on the file's version: every CompletionLog row written before
// the title snapshot existed gets one now, read off its parent RecurringTask while that's
// still possible. A row whose parent was already deleted before this ran has no title to
// recover from and is left as-is (displayed with a fallback label; see calendar.js).
function migrateCompletionLogToV8(log, recurringTaskList) {
  log.forEach(entry => {
    if (entry.title === undefined) {
      const rt = recurringTaskList.find(r => r.id === entry.recurring_task_id);
      entry.title = rt ? rt.title : null;
    }
  });
}

// One-time v7 reset, gated on the file's version. The pre-v7 Now window auto-populated
// do_date = today from stored urgency-bucket transitions; that design is gone, and the data it
// wrote is discarded rather than carried forward:
//  - quadrantHistory is emptied (its records were also the transition detector's memory).
//    The digest simply has no baseline until tomorrow. Records written from here on carry a
//    do_date key, which the "became Do Today" check relies on.
//  - every do_date is reset to the spec's deadline-default (deadline if set, else null),
//    wiping any auto-populated "today". A past deadline rolls forward in runDailyMaintenance
//    as usual, so overdue work still lands in Now on the same load.
// plannedHistory (the Calendar's frozen record) is deliberately left alone.
// Returns the fresh quadrantHistory.
function resetToV7(taskList) {
  taskList.forEach(task => {
    task.do_date = task.deadline || null;
  });
  return {};
}

// One-time v6 migration, gated on the file's version so it can't re-run on a later load
// (which would, for instance, re-default a do_date the user had deliberately cleared):
//  - manual_urgent_flag is gone. A flagged task keeps its "fire" status through the fields
//    that replace it: no deadline -> deadline = today (scores Critical via the deadline
//    path, and stays there while overdue); has a deadline -> do_date = today (in Now today).
//  - Existing dated tasks get the spec's deadline-default (do_date = deadline) applied once,
//    so they surface in Now on their deadline day; past deadlines roll forward to today in
//    the same load (runDailyMaintenance), putting overdue work in Now straight away.
function migrateTasksToV6(taskList, today) {
  taskList.forEach(task => {
    if (task.manual_urgent_flag === true) {
      if (!task.deadline) task.deadline = today;
      else task.do_date = today;
    }
    delete task.manual_urgent_flag;
    if (task.do_date === undefined) task.do_date = null;
    if (task.deadline && !task.do_date) task.do_date = task.deadline;
  });
}

// Fills in the v6 fields on any task that lacks them (a task written by the pre-v6 app on the
// other device, or a hand-edited file), without touching anything already set.
function normalizeTaskFields(task) {
  if (task.do_date === undefined) task.do_date = null;
  if (typeof task.is_quick_win !== "boolean") task.is_quick_win = false;
  if (!Number.isInteger(task.do_date_rollover_count) || task.do_date_rollover_count < 0) task.do_date_rollover_count = 0;
  if ("manual_urgent_flag" in task) delete task.manual_urgent_flag;
}

// Same for RecurringTasks: the monthly / missed-flag fields on a habit written before they
// existed. created_at stays null for those (read as "existed before tracking started").
function normalizeRecurringFields(rt) {
  if (rt.day_of_month === undefined) rt.day_of_month = null;
  if (typeof rt.missed_last_period !== "boolean") rt.missed_last_period = false;
  if (rt.created_at === undefined) rt.created_at = null;
  if (rt.skipped_date === undefined) rt.skipped_date = null;
}

function serializeState() {
  return {
    version: DATA_VERSION,
    saved_at: new Date().toISOString(),
    settings,
    categories,
    folders,
    tasks,
    recurringTasks,
    completionLog,
    quadrantHistory,
    plannedHistory,
  };
}

// Refreshes today's quadrant snapshot from the live tasks. Returns true if the history
// changed (new day, or a task moved/entered/left since the last save).
function recordTodaySnapshot() {
  return recordQuadrantSnapshot(quadrantHistory, tasks, settings, todayISODate());
}

// Every save also rewrites today's snapshot, so the last save of the day is that day's
// end-of-day state — nothing has to be running at midnight for the digest to work.
function persist() {
  recordTodaySnapshot();
  storage.save(serializeState());
}

// For loads and the midnight rollover: only write if the snapshot actually changed, so two
// synced devices opening the same file don't rewrite it back and forth.
function persistIfSnapshotChanged() {
  if (recordTodaySnapshot()) persist();
}

// ---------- Daily maintenance (do_date) ----------
// Runs on every load (first open of the day, a synced change from the other device) and at
// midnight. Two steps, in this order:
//  1. Freeze the "planned" set of every past day that hasn't been frozen yet, into
//     plannedHistory, so the Calendar's Green/Blue/Gray for that day can never be rewritten
//     by what happens to do_date afterwards. Days are walked one at a time from the day after
//     the newest record (or just yesterday, the first time) up to yesterday, and each day's
//     rollover is simulated before moving on — so after a multi-day gap a task left on
//     Monday's do_date is recorded as planned-and-missed on Monday, Tuesday and Wednesday,
//     exactly as if the app had been open each day. Existing records are never rewritten.
//  2. Roll every incomplete do_date that's now in the past forward to today. Silent, no
//     confirmation: other signals (the deadline path, staleness check-ins) keep surfacing a
//     neglected task on their own. This must NEVER touch last_touched_at, or it would reset
//     the staleness clock every day and quietly disable that safety net.
// There is no auto-population step: Now's membership is a live union (do_date == today OR
// quadrant Do/Clear, see isNowMember in urgency.js), so a genuinely urgent task shows up with
// no stored write at all.
// Returns true when anything changed (and persists in that case).
function runDailyMaintenance() {
  const today = todayISODate();
  let changed = false;

  // 1. Freeze past days.
  const frozenDays = Object.keys(plannedHistory).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const yesterday = addDaysISODate(today, -1);
  let day = frozenDays.length ? addDaysISODate(frozenDays[frozenDays.length - 1], 1) : yesterday;
  for (; day <= yesterday; day = addDaysISODate(day, 1)) {
    if (plannedHistory[day]) continue;
    plannedHistory[day] = buildPlannedRecord(day, tasks, recurringTasks, completionLog);
    changed = true;
    const next = addDaysISODate(day, 1);
    tasks.forEach(task => {
      if (task.status === "active" && task.do_date === day && !plannedTaskDone(task, day)) {
        task.do_date = next;
        task.do_date_rollover_count = (task.do_date_rollover_count || 0) + 1; // passive: never a touch
      }
    });
  }

  // 2. Roll over whatever is still in the past. Each silent roll bumps do_date_rollover_count
  //    (the only thing that distinguishes "added today" from "dodged for a week"); it resets
  //    on any genuine do_date write. Like the roll itself, never a touch.
  tasks.forEach(task => {
    if (task.status === "active" && task.do_date && task.do_date < today) {
      task.do_date = today;
      task.do_date_rollover_count = (task.do_date_rollover_count || 0) + 1;
      changed = true;
    }
  });

  // 3. Habit reset boundary: refresh missed_last_period from the previous period's log.
  recurringTasks.forEach(rt => {
    const missed = computeMissedLastPeriod(rt, today, completionLog);
    if (rt.missed_last_period !== missed) {
      rt.missed_last_period = missed;
      changed = true;
    }
  });

  if (changed) persist();
  return changed;
}

// Spec: whenever a deadline gets set on a task (however it came to be set), do_date defaults
// to that same date unless already set, so a task at minimum surfaces in Now on its deadline
// day. Called at the moment a deadline is set or changed, never on a plain load.
function applyDeadlineDefault(task) {
  if (task.deadline && !task.do_date) task.do_date = task.deadline;
}

// Deadline requirement (spec, Data Model): a High/Critical importance task that would land in
// Plan must carry a deadline. A task is a violator when it's active, its importance buckets
// high, it has no deadline, and its live quadrant is Plan (i.e. nothing else — a do_date of
// today, staleness already at high — is lifting its urgency).
function isDeadlineViolator(task, today) {
  if (task.status !== "active" || task.deadline || task.parent_task_id) return false;
  if (importanceBucket(task.importance, settings) !== "high") return false;
  return assessTask(task, settings, today).quadrant.key === "q2";
}

function findDeadlineViolators() {
  const today = todayISODate();
  return tasks.filter(t => isDeadlineViolator(t, today));
}

// Now-window deadline prompt default: today + deadline_high_days (reusing that setting).
function defaultNowDeadline() {
  return addDaysISODate(todayISODate(), Math.max(0, Math.round(settings.deadline_high_days)));
}

function makeTask(overrides) {
  const now = new Date().toISOString();
  return Object.assign({
    id: makeId(),
    folder_id: null,
    parent_task_id: null,
    title: "",
    notes: "",
    created_at: now,
    last_touched_at: now,
    deadline: null,       // the real consequence date; drives urgency, never changes on its own
    do_date: null,        // "YYYY-MM-DD" the user intends to tackle it (or the deadline default); rolls forward daily
    do_date_rollover_count: 0, // consecutive silent rollovers; reset by any genuine do_date write
    importance: "Low",
    is_quick_win: false,  // "Bite-size" (true) vs "Main Course" sizing: display/organization only, no scoring effect
    status: "active",
    completed_at: null,
  }, overrides);
}

function makeRecurringTask(overrides) {
  return Object.assign({
    id: makeId(),
    folder_id: null,
    title: "",
    cadence: "daily", // "daily" | "weekly" | "monthly"
    weekday: null, // 0 (Sun) - 6 (Sat), weekly only; optional, null reads as Sunday (recurringWeekday)
    // and doubles as the habit's "do date" for Now inclusion (isRecurringNowMember)
    day_of_month: null, // 1-31, monthly only; optional, null reads as the month's last day (recurringDayOfMonth)
    last_completed_date: null, // "YYYY-MM-DD"; checking off sets this to today
    skipped_date: null, // "YYYY-MM-DD"; the Skip action sets this to today, distinct from completion (writes no CompletionLog row)
    missed_last_period: false, // previous day/week/month went by uncompleted (runDailyMaintenance); cleared on completion
    created_at: new Date().toISOString(), // so a brand-new habit isn't flagged for a period it didn't exist in
  }, overrides);
}

// ---------- Recurring habits ----------
// A RecurringTask is a single row that resets rather than piling up instances.
// "Done for the current period" is derived from last_completed_date vs today (daily)
// or the current week (weekly) every render, the same way quadrant is derived rather
// than stored — so nothing needs an explicit daily "reset" scan or migration.

function todayISODate() {
  return localDateString(new Date());
}

function startOfWeekISODate(dateStr) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() - mondayOffset(date)); // back up to Monday
  return localDateString(date);
}

function isRecurringDoneNow(rt) {
  if (!rt.last_completed_date) return false;
  const today = todayISODate();
  if (rt.cadence === "daily") return rt.last_completed_date === today;
  const period = periodRangeFor(rt.cadence, today); // Mon–Sun week, or the calendar month
  return rt.last_completed_date >= period.start && rt.last_completed_date <= today;
}

// Same "does this date fall in the current period" reading as isRecurringDoneNow, but for
// skipped_date, the Skip action's own field (see toggleRecurringSkip). Resets automatically
// the same way: once the period rolls over, skipped_date no longer matches and this goes false
// on its own, no maintenance scan needed (mirrors the comment on isRecurringDoneNow above it).
function isRecurringSkippedNow(rt) {
  if (!rt.skipped_date) return false;
  const today = todayISODate();
  if (rt.cadence === "daily") return rt.skipped_date === today;
  const period = periodRangeFor(rt.cadence, today);
  return rt.skipped_date >= period.start && rt.skipped_date <= today;
}

// "Resolved for today" — done or deliberately skipped. Spec: a skip gets the same visibility
// effect as a completion (not actively nagging) without actually being a completion, so this
// is what UI fractions/sorting/styling should key on instead of isRecurringDoneNow alone.
function isRecurringResolvedNow(rt) {
  return isRecurringDoneNow(rt) || isRecurringSkippedNow(rt);
}

// Completing clears the missed flag on the spot ("back on track"); undoing recomputes it
// from the log, so a mis-click doesn't lose the nudge. Completing also clears a same-period
// skip (the skip is superseded — the habit did happen after all).
function toggleRecurringTask(rt) {
  const today = todayISODate();
  if (isRecurringDoneNow(rt)) {
    const loggedDate = rt.last_completed_date;
    completionLog = completionLog.filter(l => !(l.recurring_task_id === rt.id && l.completed_date === loggedDate));
    rt.last_completed_date = null;
    rt.missed_last_period = computeMissedLastPeriod(rt, today, completionLog);
  } else {
    rt.last_completed_date = today;
    rt.skipped_date = null;
    completionLog.push({ id: makeId(), recurring_task_id: rt.id, completed_date: today, title: rt.title });
    rt.missed_last_period = false;
  }
  persist();
  render();
}

// The Skip action: a distinct, per-occurrence "not today" state, never the completion
// checkbox. Writes nothing to CompletionLog. Toggle behavior mirrors toggleRecurringTask so a
// mis-click can be undone the same way; missed_last_period is refreshed exactly like completion
// does since a deliberate skip counts the same as a completion for missed-tracking (spec).
function toggleRecurringSkip(rt) {
  const today = todayISODate();
  rt.skipped_date = isRecurringSkippedNow(rt) ? null : today;
  rt.missed_last_period = computeMissedLastPeriod(rt, today, completionLog);
  persist();
  render();
}

function deleteRecurringTask(id) {
  const rt = recurringTasks.find(r => r.id === id);
  const label = rt ? `"${rt.title}"` : "this habit";
  if (!confirm(`Delete ${label}?`)) return;
  recurringTasks = recurringTasks.filter(r => r.id !== id);
  persist();
  render();
}

let activeCategoryFilter = "all"; // "all" or a category id
let collapsedFolders = new Set();
let collapsedTasks = new Set();
let collapsedRecurringFolders = new Set(); // keyed by "<cadence>:<folder_id>"

// folder_count_display setting: "active" -> "X active", "done" -> "X of Y done".
// A per-device display preference (like theme), not synced task data.
let folderCountDisplay = localStorage.getItem("folderCountDisplay") === "done" ? "done" : "active";

function toggleFolderCountDisplay() {
  folderCountDisplay = folderCountDisplay === "active" ? "done" : "active";
  localStorage.setItem("folderCountDisplay", folderCountDisplay);
  render();
}

// list_display_mode: "windows" (Plate/Fridge) or "full" (the folder-organized page). A
// per-device display preference, same category as sort/grouping/theme/folder-count-style —
// the on-page toggle is its only UI, stored in localStorage, never synced through the data file.
let listDisplayMode = localStorage.getItem("listDisplayMode") === "full" ? "full" : "windows";

// ---------- Views ----------
// "list" is where work happens; "overview" is the read-only orientation glance. Navigating
// between them within a session is just in-memory state — a fresh page load always starts
// back at Overview, the orientation glance, rather than resuming wherever the last session
// left off.

const VALID_VIEWS = new Set(["overview", "list", "calendar"]);
let activeView = "overview";

function setActiveView(view) {
  const next = VALID_VIEWS.has(view) ? view : "overview";
  // Clicking Checklist always starts from Daily Plate expanded — an opinionated fresh default
  // every time that tab is clicked, even if it was already showing (clicking outside the
  // windows, in windows.js, is what un-expands it again from there). Unconditional on purpose:
  // gating this on "arriving from another tab" silently did nothing when Checklist was already
  // the active view.
  if (next === "list") setWindowPref("focus", "now");
  const prev = activeView;
  activeView = next;
  render();
  slideViews(prev, next);
  if (prev !== next) scrollPageToTop();
}

// ---------- Smooth scroll ----------
// The page scrolls with an eased, slightly lagged glide, and a tab change glides the new view
// back to the top the same way. A deliberate exception to "motion is plain CSS" (CLAUDE.md):
// CSS scroll-behavior only smooths scrolls the page itself triggers, never the mouse wheel, so
// the glide comes from Lenis (loaded in index.html). allowNestedScroll leaves anything with its
// own scrollbar (the Plate/Fridge bodies, modals, Focus mode) scrolling natively. Without Lenis
// (offline) or with reduced motion on, the page scrolls natively and the tab-change return to
// the top uses the browser's own smooth scroll (or jumps, for reduced motion).
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lenis = typeof Lenis !== "undefined" && !reducedMotion
  ? new Lenis({ autoRaf: true, allowNestedScroll: true })
  : null;

function scrollPageToTop() {
  if (window.scrollY === 0) return;
  if (lenis) lenis.scrollTo(0);
  else window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

// ---------- View switch slide ----------
// Switching views slides the content horizontally, direction following tab order: moving to a
// tab on the right slides the current view out to the left and brings the new one in from the
// right, and vice versa. render() has already hidden the old view; it's shown again just for
// the slide, stacked in the same grid cell as the new one (.view-sliding in style.css), then
// hidden once the new view's animation ends. Plain CSS keyframes, no library.
const VIEW_ORDER = ["overview", "list", "calendar"];
const VIEW_ELEMENT_IDS = { overview: "overview-view", list: "list-view", calendar: "calendar-view" };
let viewSlideCleanup = null;

function slideViews(prev, next) {
  if (viewSlideCleanup) viewSlideCleanup(); // a second switch mid-slide: settle the first at once
  if (prev === next || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const main = document.querySelector(".app-main");
  const oldEl = document.getElementById(VIEW_ELEMENT_IDS[prev]);
  const newEl = document.getElementById(VIEW_ELEMENT_IDS[next]);
  const dir = VIEW_ORDER.indexOf(next) > VIEW_ORDER.indexOf(prev) ? 1 : -1;

  document.documentElement.classList.add("view-sliding");
  main.classList.add("view-sliding");
  main.style.setProperty("--slide-dir", dir);
  oldEl.hidden = false;
  oldEl.setAttribute("aria-hidden", "true");
  oldEl.classList.add("view-out");
  newEl.classList.add("view-in");

  const cleanup = () => {
    clearTimeout(fallback);
    newEl.removeEventListener("animationend", onEnd);
    oldEl.classList.remove("view-out");
    newEl.classList.remove("view-in");
    oldEl.removeAttribute("aria-hidden");
    oldEl.hidden = activeView !== prev; // unless the user has since switched straight back
    main.classList.remove("view-sliding");
    document.documentElement.classList.remove("view-sliding");
    viewSlideCleanup = null;
  };
  const onEnd = e => { if (e.target === newEl) cleanup(); };
  newEl.addEventListener("animationend", onEnd);
  // Safety net if animationend never arrives (e.g. a hidden tab skips the animation).
  const fallback = setTimeout(cleanup, 900);
  viewSlideCleanup = cleanup;
}

document.querySelectorAll("#view-switch .view-switch-btn").forEach(btn => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

function renderViewSwitch() {
  // Drives the per-view accent (--view-accent in style.css) on the view's framing and type.
  document.documentElement.dataset.view = activeView;
  document.querySelectorAll("#view-switch .view-switch-btn").forEach(btn => {
    const isActive = btn.dataset.view === activeView;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const isList = activeView === "list";
  const listMode = listDisplayMode;
  document.getElementById("list-view").hidden = !isList;
  // The category tabs filter either List mode, from the same spot in the header; the heat-map
  // legend belongs to the folder-organized "full" page; the Overdue callout is a safety signal
  // and stays up in either List mode.
  document.getElementById("folder-tabs").hidden = !isList;
  document.getElementById("heatmap-legend").hidden = !(isList && listMode === "full");
  document.getElementById("overdue-callout").hidden = !isList;
  document.getElementById("windows-toolbar").hidden = !(isList && listMode === "windows");
  document.getElementById("windows-row").hidden = !(isList && listMode === "windows");
  document.getElementById("list-full").hidden = !(isList && listMode === "full");
  document.getElementById("overview-view").hidden = activeView !== "overview";
  document.getElementById("calendar-view").hidden = activeView !== "calendar";
}

// ---------- List display mode ----------
// list_display_mode is a per-device display preference (localStorage, see listDisplayMode
// above), same two-mode pattern as overview_display_mode and calendar_display_mode: the
// on-page toggle is its only UI.

const LIST_MODES = [
  { key: "windows", label: "Plate" },
  { key: "full", label: "List" },
];

function renderListModeToggle() {
  document.getElementById("list-mode").replaceChildren(
    makeModeToggle(LIST_MODES, listDisplayMode, setListDisplayMode, "List display"));
}

// ---------- Mode toggles ----------
// Every two-way display switch (Plate/List, Scatter/Quadrants, Pace/Capacity, Flat/Folder) is
// one button showing the current mode. Hovering it text-rolls the label to the mode a click
// switches to — the same text roll as every other label (applyTextRoll above, fed the
// destination through data-roll-to) — and clicking switches to it. Each sits in the same spot
// whichever of its modes is showing.
function makeModeToggle(modes, activeKey, onPick, groupLabel) {
  const index = Math.max(0, modes.findIndex(mode => mode.key === activeKey));
  const current = modes[index];
  const next = modes[(index + 1) % modes.length];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mode-toggle";
  btn.dataset.rollTo = next.label;
  btn.textContent = current.label;
  btn.title = groupLabel + ": " + current.label + " (click for " + next.label + ")";
  btn.setAttribute("aria-label", groupLabel + ": " + current.label + ". Switch to " + next.label);
  btn.addEventListener("click", () => onPick(next.key));
  return btn;
}

function setListDisplayMode(mode) {
  if (listDisplayMode === mode) return;
  listDisplayMode = mode;
  localStorage.setItem("listDisplayMode", mode);
  render();
}

// ---------- Rendering ----------

function render() {
  renderViewSwitch();
  renderCategoryTabs();
  renderListModeToggle();
  renderOverdueCallout();
  renderHeatMapLegend();
  renderNowLaterWindows();
  renderFolderList();
  renderRecurringSidebar();
  renderOverview();
  renderCalendar();
}

// ---------- Overdue callout ----------
// The "firefight" window: every active task whose deadline has passed, most overdue first.
// Membership only (deadline < today), no ranking rule and no new fields — a stale undated
// task never lands here, only an actually missed deadline does. Sits in the sticky header,
// independent of the category tabs and of the List display mode, so it can't be scrolled or
// toggled out of view. Collapsed to a single quiet line when nothing is overdue; the strip of
// cards only appears when there's something to act on. Recurring habits never appear here.

function renderOverdueCallout() {
  const el = document.getElementById("overdue-callout");
  el.innerHTML = "";
  const today = todayISODate();

  const overdue = tasks
    .filter(t => t.status === "active" && t.deadline && t.deadline < today)
    .map(task => ({ task, assessment: assessTask(task, settings, today) }))
    .sort((a, b) => (a.task.deadline < b.task.deadline ? -1 : a.task.deadline > b.task.deadline ? 1 : 0)
      || b.assessment.priorityScore - a.assessment.priorityScore);

  el.classList.toggle("has-items", overdue.length > 0);

  // Hidden entirely when nothing's overdue, same as every other empty state in the app — no
  // "nothing past its deadline" self-narration, it just doesn't render.
  if (overdue.length === 0) return;

  const header = document.createElement("div");
  header.className = "overdue-callout-header";

  const label = document.createElement("span");
  label.className = "overdue-callout-label";
  label.textContent = "Overdue";
  header.appendChild(label);

  const count = document.createElement("span");
  count.className = "overdue-callout-count";
  count.textContent = overdue.length;
  header.appendChild(count);

  const hint = document.createElement("span");
  hint.className = "overdue-callout-hint";
  hint.textContent = "past deadline · act on these first";
  header.appendChild(hint);

  el.appendChild(header);

  const strip = document.createElement("div");
  strip.className = "overdue-strip";
  overdue.forEach(entry => strip.appendChild(renderOverdueCard(entry, today)));
  el.appendChild(strip);
}

function renderOverdueCard(entry, today) {
  const { task, assessment } = entry;
  const daysOver = calendarDaysBetween(task.deadline, today);

  const pending = pendingDone.has(task.id);
  const card = document.createElement("div");
  card.className = "overdue-card quadrant-" + assessment.quadrant.key + (pending ? " done-pending" : "");
  card.style.setProperty("--p", assessment.intensity.toFixed(3));
  card.title = buildTaskTooltip(task, assessment, { quadrant: true, importance: true, deadline: true });

  // Same completion pattern as every other card: strike through at once, commit after the
  // grace period (scheduleCardDone, windows.js), so the check animation plays before the card
  // leaves the strip.
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = pending;
  checkbox.dataset.checkId = task.id;
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => scheduleCardDone(task, card, checkbox.checked));
  card.appendChild(checkbox);

  const body = document.createElement("button");
  body.type = "button";
  body.className = "overdue-card-body";
  body.title = "Edit";
  body.addEventListener("click", () => openTaskModal(task));

  const title = document.createElement("span");
  title.className = "overdue-card-title";
  title.textContent = task.title;
  body.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "overdue-card-meta";
  const context = taskContextLabel(task);
  meta.textContent = (context ? context + " · " : "") + "overdue by " + daysOver + (daysOver === 1 ? " day" : " days");
  if (context) prependCategoryDot(meta, task.folder_id);
  body.appendChild(meta);

  card.appendChild(body);
  return card;
}

// Small key for the heat-map: one chip per quadrant hue, each drawn as its pale→vivid ramp.
function renderHeatMapLegend() {
  const legend = document.getElementById("heatmap-legend");
  legend.innerHTML = "";
  Object.values(QUADRANTS).forEach(q => {
    const chip = document.createElement("span");
    chip.className = "legend-chip quadrant-" + q.key;
    chip.textContent = q.label;
    const range = priorityRangeFor(q, settings);
    chip.title = "priority " + Math.round(range.min) + "–" + Math.round(range.max) + ": pale → vivid";
    legend.appendChild(chip);
  });
  const note = document.createElement("span");
  note.className = "legend-note";
  note.textContent = "hue = quadrant, intensity = priority";
  legend.appendChild(note);
}

// One add-affordance policy app-wide: a plain "+" icon, not a text link, positioned at the end
// of whatever it's adding to. Shares styling with windows.js's makeBucketAddIcon. An optional
// `label` (category/folder add only) keeps the "+" icon but appends a word after it, since a
// bare icon among several other bare "+" icons on the same page was ambiguous.
function makeAddIcon(title, ariaLabel, onAdd, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon window-bucket-add" + (label ? " window-bucket-add-labeled" : "");
  btn.innerHTML = ICONS.plus;
  if (label) {
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
  }
  btn.title = title;
  btn.setAttribute("aria-label", ariaLabel);
  btn.addEventListener("click", onAdd);
  return btn;
}

// ---------- Category colors ----------
// Each category can carry a color, picked from a small muted palette (--cat-* in style.css,
// chosen to stay clear of Fire/Ice, gold and the habit hues). Stored as a palette key on the
// Category itself (`color`, optional — an older data file simply has none). A category with
// no stored color gets the first palette color not already taken by a stored color or by an
// earlier category, so every category has a stable color without writing anything until the
// user actually picks one. Shown as a dot on its tab and beside folder names / folder labels.
const CATEGORY_COLORS = ["slate", "moss", "clay", "rose", "lagoon", "lavender", "olive", "stone"];
const CATEGORY_COLOR_NAMES = {
  slate: "Slate", moss: "Moss", clay: "Clay", rose: "Rose",
  lagoon: "Lagoon", lavender: "Lavender", olive: "Olive", stone: "Stone",
};

function categoryColorKeys() {
  const keys = {};
  const taken = new Set(categories.map(c => c.color).filter(k => CATEGORY_COLORS.includes(k)));
  categories.forEach(c => {
    if (CATEGORY_COLORS.includes(c.color)) { keys[c.id] = c.color; return; }
    const free = CATEGORY_COLORS.find(k => !taken.has(k)) || CATEGORY_COLORS[categories.indexOf(c) % CATEGORY_COLORS.length];
    taken.add(free);
    keys[c.id] = free;
  });
  return keys;
}

// A small colored dot for the category a folder belongs to, or null if the folder (or its
// category) can't be found.
function categoryDotForFolder(folderId) {
  const folder = folders.find(f => f.id === folderId);
  const category = folder && categories.find(c => c.id === folder.category_id);
  if (!category) return null;
  const dot = document.createElement("span");
  dot.className = "cat-dot";
  dot.style.setProperty("--cat-color", "var(--cat-" + categoryColorKeys()[category.id] + ")");
  dot.title = category.name;
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

// Puts a folder's category dot at the start of a meta line that names the folder.
function prependCategoryDot(el, folderId) {
  const dot = categoryDotForFolder(folderId);
  if (dot) el.prepend(dot);
}

// Whether a folder falls under the active category tab (always true on "All"). Shared by the
// folder list and the Daily Plate / Fridge windows, so both filter by the same selection.
function folderInActiveCategory(folderId) {
  if (activeCategoryFilter === "all") return true;
  const folder = folders.find(f => f.id === folderId);
  return !!folder && folder.category_id === activeCategoryFilter;
}

let openCategoryPalette = null; // category id whose color picker is open, if any

// Picking a color first writes every category's current color down, so the pick changes only
// the one category — otherwise the others' auto-assigned colors could shuffle, since "next
// unused color" depends on which colors are taken.
function setCategoryColor(category, key) {
  const current = categoryColorKeys();
  categories.forEach(c => { c.color = current[c.id]; });
  category.color = key;
  openCategoryPalette = null;
  persist();
  render();
}

// The category tabs: "All" plus one per category, each with its color dot (click the dot to
// pick a color), then "+ Category". They sit in the header banner and filter both List modes
// (the folder list and the Plate/Fridge windows) through the one activeCategoryFilter. Each tab
// is a color tab (.color-tab in style.css, shared with the view tabs): its wrap is the box that
// underlines, outlines on hover and fills when active, in the category's color ("All": ink).
function renderCategoryTabs() {
  const nav = document.getElementById("folder-tabs");
  nav.innerHTML = "";

  const allWrap = document.createElement("span");
  allWrap.className = "folder-tab-wrap color-tab color-tab-neutral" + (activeCategoryFilter === "all" ? " active" : "");
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "folder-tab";
  allBtn.setAttribute("aria-pressed", activeCategoryFilter === "all" ? "true" : "false");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeCategoryFilter = "all";
    render();
  });
  allWrap.appendChild(allBtn);
  nav.appendChild(allWrap);

  const colorKeys = categoryColorKeys();
  categories.forEach(category => {
    const wrap = document.createElement("span");
    wrap.className = "folder-tab-wrap color-tab" + (activeCategoryFilter === category.id ? " active" : "");
    wrap.style.setProperty("--tab-color", "var(--cat-" + colorKeys[category.id] + ")");

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "cat-dot cat-dot-btn";
    dot.style.setProperty("--cat-color", "var(--cat-" + colorKeys[category.id] + ")");
    dot.title = "Color for " + category.name;
    dot.setAttribute("aria-label", "Change color for " + category.name);
    dot.setAttribute("aria-expanded", openCategoryPalette === category.id ? "true" : "false");
    dot.addEventListener("click", e => {
      e.stopPropagation();
      openCategoryPalette = openCategoryPalette === category.id ? null : category.id;
      render();
    });
    wrap.appendChild(dot);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-tab";
    btn.setAttribute("aria-pressed", activeCategoryFilter === category.id ? "true" : "false");
    btn.textContent = category.name;
    btn.addEventListener("click", () => {
      activeCategoryFilter = category.id;
      render();
    });
    wrap.appendChild(btn);

    if (openCategoryPalette === category.id) wrap.appendChild(renderCategoryPalette(category, colorKeys[category.id]));
    nav.appendChild(wrap);
  });

  // Wrapped, not passed directly: makeAddIcon wires this as a click handler, which would hand
  // openCategoryModal the click event as its targetSelect argument otherwise.
  nav.appendChild(makeAddIcon("Add a category", "Add category", () => openCategoryModal(), "Category"));
}

function renderCategoryPalette(category, currentKey) {
  const pop = document.createElement("div");
  pop.className = "cat-palette";
  pop.setAttribute("role", "group");
  pop.setAttribute("aria-label", "Color for " + category.name);
  pop.addEventListener("click", e => e.stopPropagation());
  CATEGORY_COLORS.forEach(key => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "cat-swatch";
    sw.style.setProperty("--cat-color", "var(--cat-" + key + ")");
    sw.title = CATEGORY_COLOR_NAMES[key];
    sw.setAttribute("aria-label", CATEGORY_COLOR_NAMES[key]);
    sw.setAttribute("aria-pressed", key === currentKey ? "true" : "false");
    sw.addEventListener("click", () => setCategoryColor(category, key));
    pop.appendChild(sw);
  });
  return pop;
}

// Click anywhere else, or Esc, closes an open color picker.
document.addEventListener("click", () => {
  if (openCategoryPalette) { openCategoryPalette = null; render(); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && openCategoryPalette) { openCategoryPalette = null; render(); }
});

// A completed task keeps showing (struck through) in its folder for the rest of the day it
// was completed, same as always, but stops showing at all from the next day on — the
// Calendar's day-repository is the only remaining way to see it. Active tasks are always
// visible; this rule only ever hides done ones.
function visibleInFolderList(task, today) {
  if (task.status !== "done") return true;
  return !!task.completed_at && toLocalDateString(task.completed_at) === today;
}

function renderFolderList() {
  const container = document.getElementById("folder-list");
  container.innerHTML = "";

  const visibleFolders = activeCategoryFilter === "all"
    ? folders
    : folders.filter(f => f.category_id === activeCategoryFilter);

  visibleFolders.forEach(folder => {
    container.appendChild(renderFolderSection(folder));
  });

  if (visibleFolders.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "No folders yet. Add one to get started.";
    container.appendChild(hint);
  }

  container.appendChild(makeAddIcon("Add a folder", "Add folder", () => openFolderModal(), "Folder"));
}

function renderFolderSection(folder) {
  const today = todayISODate();
  const topLevelTasks = tasks.filter(t => t.folder_id === folder.id && !t.parent_task_id && visibleInFolderList(t, today));

  const section = document.createElement("div");
  section.className = "folder-section" + (collapsedFolders.has(folder.id) ? " collapsed" : "");

  const header = document.createElement("div");
  header.className = "folder-header";
  header.addEventListener("click", () => {
    if (collapsedFolders.has(folder.id)) {
      collapsedFolders.delete(folder.id);
    } else {
      collapsedFolders.add(folder.id);
    }
    render();
  });

  const caret = document.createElement("span");
  caret.className = "folder-caret";
  caret.textContent = "▼";
  header.appendChild(caret);

  const catDot = categoryDotForFolder(folder.id);
  if (catDot) header.appendChild(catDot);

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folder.name;
  header.appendChild(name);

  const count = document.createElement("button");
  count.type = "button";
  count.className = "folder-count";
  count.title = "Click to toggle count display";
  if (folderCountDisplay === "done") {
    const doneCount = topLevelTasks.filter(t => t.status === "done").length;
    count.textContent = doneCount + "/" + topLevelTasks.length + " done";
  } else {
    const activeCount = topLevelTasks.filter(t => t.status === "active").length;
    count.textContent = activeCount + " active";
  }
  count.addEventListener("click", e => {
    e.stopPropagation();
    toggleFolderCountDisplay();
  });
  header.appendChild(count);

  section.appendChild(header);

  const body = document.createElement("div");
  body.className = "folder-body";

  if (topLevelTasks.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "No tasks in this folder yet.";
    body.appendChild(hint);
  } else {
    body.appendChild(renderTaskList(topLevelTasks));
  }

  body.appendChild(makeBucketAddIcon(folder.name, () => openTaskModal({ folder_id: folder.id })));

  section.appendChild(body);
  return section;
}

function renderTaskList(taskGroup) {
  const ul = document.createElement("ul");
  ul.className = "task-list";
  taskGroup.forEach(task => {
    ul.appendChild(renderTaskRow(task));
  });
  return ul;
}

function renderTaskRow(task) {
  const li = document.createElement("li");

  const pending = pendingDone.has(task.id);
  const row = document.createElement("div");
  row.className = "task-row" + (task.status === "done" ? " done" : "") + (pending ? " done-pending" : "");

  // Heat-map tint only applies to live tasks; done/dropped rows stay neutral. The quadrant
  // class picks the hue, --p (0-1 intensity from priority_score) drives saturation/lightness
  // in CSS, so the colour maths stays theme-aware without a re-render on theme toggle.
  const today = todayISODate();
  // Subtasks are exempt from the matrix entirely (no independent importance/urgency/priority_
  // score/quadrant); the row inherits its top-level ancestor's assessment for its heat-map
  // color, and isn't its own drag source into Now since it has no independent membership.
  const assessment = task.status === "active" ? assessTask(topLevelTask(task, tasks), settings, today) : null;
  if (assessment) {
    row.classList.add("quadrant-" + assessment.quadrant.key);
    row.style.setProperty("--p", assessment.intensity.toFixed(3));
    if (!task.parent_task_id) makeTaskDraggable(row, task); // into the Now window (see windows.js)
  }

  // `children` (full, done included) drives the honest subtask-progress percentage; a task
  // whose subtasks are all done still reports 100% even once they've aged out of the visible
  // list below. `visibleChildren` is what actually renders — the same day-after-completion
  // hiding rule as the folder itself, applied one level down.
  const children = tasks.filter(t => t.parent_task_id === task.id);
  const visibleChildren = children.filter(t => visibleInFolderList(t, today));
  const isCollapsed = collapsedTasks.has(task.id);

  if (visibleChildren.length > 0) {
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "task-caret" + (isCollapsed ? " collapsed" : "");
    caret.textContent = "▼";
    caret.setAttribute("aria-label", isCollapsed ? "Expand subtasks" : "Collapse subtasks");
    caret.addEventListener("click", () => {
      if (collapsedTasks.has(task.id)) {
        collapsedTasks.delete(task.id);
      } else {
        collapsedTasks.add(task.id);
      }
      render();
    });
    row.appendChild(caret);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "task-caret-spacer";
    row.appendChild(spacer);
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.status === "done" || pending;
  checkbox.dataset.checkId = task.id;
  // Same completion pattern as Plate/Fridge cards and subtasks: strike through at once, commit
  // after a short grace period (scheduleCardDone, windows.js); un-completing an already-done
  // task is instant, there's nothing left to strike through.
  checkbox.addEventListener("change", () => {
    if (task.status === "done") toggleTaskDone(task);
    else scheduleCardDone(task, row, checkbox.checked);
  });
  row.appendChild(checkbox);

  const main = document.createElement("div");
  main.className = "task-main";

  const titleLine = document.createElement("div");
  titleLine.className = "task-title-line";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  titleLine.appendChild(title);

  appendTagBadge(titleLine, task, today);
  appendRolloverBadge(titleLine, task);
  if (task.importance === "Critical") {
    titleLine.appendChild(makeBadge("Critical", "badge-critical"));
  } else if (task.importance === "High") {
    titleLine.appendChild(makeBadge("High", "badge-high"));
  }

  main.appendChild(titleLine);

  if (children.length > 0) {
    main.appendChild(renderSubtaskProgress(children));
  }

  if (assessment) {
    main.appendChild(renderUrgencyMeta(task, assessment));
  } else if (task.deadline) {
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = "Due " + task.deadline;
    main.appendChild(meta);
  }

  if (task.notes) {
    const notes = document.createElement("div");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    main.appendChild(notes);
  }

  if (visibleChildren.length > 0) {
    const subtaskContainer = document.createElement("div");
    subtaskContainer.className = "subtask-container" + (isCollapsed ? " collapsed" : "");
    subtaskContainer.appendChild(renderTaskList(visibleChildren));
    main.appendChild(subtaskContainer);
  }

  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  // The add-subtask "+" sits in the hover-revealed actions cluster, not on a line of its own
  // under the title, where an invisible-until-hover control reserved an empty row on every task.
  const addSub = document.createElement("button");
  addSub.type = "button";
  addSub.className = "link-btn add-subtask-row";
  addSub.textContent = "+";
  addSub.title = "Add subtask";
  addSub.setAttribute("aria-label", "Add subtask to " + task.title);
  addSub.addEventListener("click", () => openTaskModal({ folder_id: task.folder_id, parent_task_id: task.id }));
  actions.appendChild(addSub);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-icon";
  editBtn.innerHTML = ICONS.pencil;
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openTaskModal(task));
  actions.appendChild(editBtn);

  if (task.status === "active" && !task.deadline) {
    const bumpBtn = document.createElement("button");
    bumpBtn.type = "button";
    bumpBtn.className = "btn-icon";
    bumpBtn.innerHTML = ICONS.bump;
    bumpBtn.setAttribute("aria-label", "Bump task (mark as touched today)");
    bumpBtn.title = "Bump: reset staleness to today";
    bumpBtn.addEventListener("click", () => bumpTask(task));
    actions.appendChild(bumpBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon";
  delBtn.style.color = "var(--danger)";
  delBtn.innerHTML = ICONS.trash;
  delBtn.setAttribute("aria-label", "Delete task");
  delBtn.title = "Delete";
  delBtn.addEventListener("click", () => deleteTask(task.id));
  actions.appendChild(delBtn);

  row.appendChild(actions);

  li.appendChild(row);
  return li;
}

function makeBadge(text, cssClass) {
  const span = document.createElement("span");
  span.className = "task-badge " + cssClass;
  span.textContent = text;
  return span;
}

// The escalating tag (Do Today < Due Today < Overdue, one slot, see escalatingTag in
// urgency.js) as a badge. Same element everywhere a task appears — list rows, Now/Later
// cards, the priority panel, the quadrant list — so it's one visual language, not a
// Now-window special.
function makeTagBadge(tag) {
  return makeBadge(tag.label, "tag-badge tag-" + tag.key);
}

// Appends the tag badge to `el` when the task carries one; no-op otherwise.
function appendTagBadge(el, task, today) {
  const tag = escalatingTag(task, today);
  if (tag) el.appendChild(makeTagBadge(tag));
  return tag;
}

// "Rolled 3x": the plain rollover-count tag, shown from the first silent rollover on. No
// tiers, no color — just the number, wherever a task appears.
function appendRolloverBadge(el, task) {
  const n = task.do_date_rollover_count || 0;
  if (n >= 1 && task.status === "active") el.appendChild(makeBadge("Rolled " + n + "x", "badge-rolled"));
}

// "Missed yesterday / last week / last month": the habit's missed_last_period nudge.
const MISSED_LABELS = Object.freeze({ daily: "Missed yesterday", weekly: "Missed last week", monthly: "Missed last month" });

function appendMissedBadge(el, rt) {
  if (rt.missed_last_period && MISSED_LABELS[rt.cadence]) el.appendChild(makeBadge(MISSED_LABELS[rt.cadence], "badge-missed"));
}

// "Skipped today / this week / this month": shown only while the skip is actually in effect
// and hasn't been superseded by a completion (isRecurringDoneNow takes visual priority).
const SKIPPED_LABELS = Object.freeze({ daily: "Skipped today", weekly: "Skipped this week", monthly: "Skipped this month" });

function appendSkippedBadge(el, rt) {
  if (!isRecurringDoneNow(rt) && isRecurringSkippedNow(rt) && SKIPPED_LABELS[rt.cadence]) {
    el.appendChild(makeBadge(SKIPPED_LABELS[rt.cadence], "badge-skipped"));
  }
}

// One line under the title showing just the quadrant label; the numbers behind it
// (priority, urgency + reason, deadline) live in the tooltip.
function renderUrgencyMeta(task, assessment) {
  const meta = document.createElement("div");
  meta.className = "task-meta task-urgency-meta";

  const quadrant = document.createElement("span");
  quadrant.className = "quadrant-label";
  quadrant.textContent = assessment.quadrant.label;
  quadrant.title = buildTaskTooltip(task, assessment, { priority: true, urgency: true, deadline: true, doDate: true });
  meta.appendChild(quadrant);
  return meta;
}

function renderSubtaskProgress(subtasks) {
  const completed = subtasks.filter(t => t.status === "done").length;
  const percent = Math.round((completed / subtasks.length) * 100);

  const wrap = document.createElement("div");
  wrap.className = "subtask-progress";

  const bar = document.createElement("div");
  bar.className = "subtask-progress-bar";
  const fill = document.createElement("div");
  fill.className = "subtask-progress-fill";
  fill.style.width = percent + "%";
  bar.appendChild(fill);
  wrap.appendChild(bar);

  return wrap;
}

// ---------- Recurring sidebar (Weekly/Daily boxes) ----------
// Fully separate from the folder/matrix system: no importance, urgency, or heat-map
// coloring applies here, just a folder-grouped checklist with a completion fraction. The
// Now/Later windows show a schedule-split view of these same rows (renderWindowHabits in
// windows.js); these boxes always show everything.

function renderRecurringSidebar() {
  renderRecurringBox("monthly", "recurring-monthly", "Monthly");
  renderRecurringBox("weekly", "recurring-weekly", "Weekly");
  renderRecurringBox("daily", "recurring-daily", "Daily");
}

// "Mon" for a weekly habit, "Day 15" / "Month end" for a monthly one, nothing for daily.
function recurringScheduleLabel(rt) {
  if (rt.cadence === "weekly") return WEEKDAY_LABELS[recurringWeekday(rt)];
  if (rt.cadence === "monthly") return rt.day_of_month == null ? "Month end" : "Day " + rt.day_of_month;
  return "";
}

function renderRecurringBox(cadence, containerId, label) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const items = recurringTasks.filter(rt => rt.cadence === cadence);
  const doneCount = items.filter(isRecurringResolvedNow).length;

  const header = document.createElement("div");
  header.className = "recurring-box-header";

  const title = document.createElement("span");
  title.className = "recurring-box-title";
  title.textContent = label;
  header.appendChild(title);

  const fraction = document.createElement("span");
  fraction.className = "recurring-box-fraction";
  fraction.textContent = doneCount + "/" + items.length;
  header.appendChild(fraction);

  container.appendChild(header);

  const body = document.createElement("div");
  body.className = "recurring-box-body";

  const foldersWithItems = folders.filter(f => items.some(rt => rt.folder_id === f.id));

  if (foldersWithItems.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "No " + label.toLowerCase() + " habits yet.";
    body.appendChild(hint);
  } else {
    foldersWithItems.forEach(folder => {
      body.appendChild(renderRecurringFolderSection(folder, cadence, items.filter(rt => rt.folder_id === folder.id)));
    });
  }

  body.appendChild(makeHabitAddIcon(label, () => openRecurringModal({ cadence })));

  container.appendChild(body);
}

// Same bottom-left "+" pill as the folder list's per-folder add (makeBucketAddIcon, windows.js),
// worded for a habit rather than a task.
function makeHabitAddIcon(label, onAdd) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon window-bucket-add";
  btn.innerHTML = ICONS.plus;
  btn.title = "Add a habit here (" + label + ")";
  btn.setAttribute("aria-label", "Add habit to " + label);
  btn.addEventListener("click", onAdd);
  return btn;
}

function renderRecurringFolderSection(folder, cadence, folderItems) {
  const key = cadence + ":" + folder.id;

  const section = document.createElement("div");
  section.className = "folder-section recurring-folder-section" + (collapsedRecurringFolders.has(key) ? " collapsed" : "");

  const header = document.createElement("div");
  header.className = "folder-header";
  header.addEventListener("click", () => {
    if (collapsedRecurringFolders.has(key)) {
      collapsedRecurringFolders.delete(key);
    } else {
      collapsedRecurringFolders.add(key);
    }
    render();
  });

  const caret = document.createElement("span");
  caret.className = "folder-caret";
  caret.textContent = "▼";
  header.appendChild(caret);

  const catDot = categoryDotForFolder(folder.id);
  if (catDot) header.appendChild(catDot);

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folder.name;
  header.appendChild(name);

  const count = document.createElement("span");
  count.className = "folder-count";
  const done = folderItems.filter(isRecurringResolvedNow).length;
  count.textContent = done + "/" + folderItems.length;
  header.appendChild(count);

  section.appendChild(header);

  const body = document.createElement("div");
  body.className = "folder-body";

  const ul = document.createElement("ul");
  ul.className = "task-list";
  folderItems.forEach(rt => ul.appendChild(renderRecurringRow(rt)));
  body.appendChild(ul);

  body.appendChild(makeHabitAddIcon(folder.name, () => openRecurringModal({ cadence, folder_id: folder.id })));

  section.appendChild(body);
  return section;
}

const SKIP_PERIOD_LABELS = Object.freeze({ daily: "today", weekly: "this week", monthly: "this month" });

// The Skip action: small and icon-only so it reads as distinct from the checkbox beside it,
// toggled (aria-pressed) the same way the checkbox itself is, so a skip can be undone here too.
// A no-op while the habit is already done today — completing supersedes a skip, not the other
// way around (see toggleRecurringTask), so the control is disabled rather than double-acting.
function makeSkipButton(rt) {
  const done = isRecurringDoneNow(rt);
  const skipped = isRecurringSkippedNow(rt);
  const period = SKIP_PERIOD_LABELS[rt.cadence] || "today";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon btn-skip";
  btn.innerHTML = ICONS.skip;
  btn.setAttribute("aria-pressed", skipped ? "true" : "false");
  btn.disabled = done;
  btn.title = skipped ? "Undo skip" : "Skip for " + period;
  btn.setAttribute("aria-label", (skipped ? "Undo skip: " : "Skip: ") + rt.title);
  btn.addEventListener("click", () => toggleRecurringSkip(rt));
  return btn;
}

function renderRecurringRow(rt) {
  const li = document.createElement("li");

  const row = document.createElement("div");
  const done = isRecurringDoneNow(rt);
  row.className = "task-row" + (isRecurringResolvedNow(rt) ? " done" : "");

  const spacer = document.createElement("span");
  spacer.className = "task-caret-spacer";
  row.appendChild(spacer);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = done;
  checkbox.dataset.checkId = rt.id;
  checkbox.addEventListener("change", () => toggleRecurringTask(rt));
  row.appendChild(checkbox);

  row.appendChild(makeSkipButton(rt));

  const main = document.createElement("div");
  main.className = "task-main";

  const titleLine = document.createElement("div");
  titleLine.className = "task-title-line";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = rt.title;
  titleLine.appendChild(title);

  const schedule = recurringScheduleLabel(rt);
  if (schedule) titleLine.appendChild(makeBadge(schedule, "badge-recurring"));
  appendMissedBadge(titleLine, rt);
  appendSkippedBadge(titleLine, rt);

  main.appendChild(titleLine);
  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-icon";
  editBtn.innerHTML = ICONS.pencil;
  editBtn.setAttribute("aria-label", "Edit habit");
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openRecurringModal(rt));
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon";
  delBtn.style.color = "var(--danger)";
  delBtn.innerHTML = ICONS.trash;
  delBtn.setAttribute("aria-label", "Delete habit");
  delBtn.title = "Delete";
  delBtn.addEventListener("click", () => deleteRecurringTask(rt.id));
  actions.appendChild(delBtn);

  row.appendChild(actions);
  li.appendChild(row);
  return li;
}

// ---------- Task actions ----------

// Completing a parent marks every still-active descendant done too, recursively — one
// direction only, completing a subtask never completes its parent (that would be guessing at
// intent the parent hasn't confirmed), and reopening a task never cascades either.
function completeDescendants(taskId, now) {
  tasks.filter(t => t.parent_task_id === taskId).forEach(child => {
    if (child.status !== "active") return;
    child.status = "done";
    child.completed_at = now;
    child.last_touched_at = now;
    completeDescendants(child.id, now);
  });
}

function toggleTaskDone(task) {
  const now = new Date().toISOString();
  if (task.status === "done") {
    task.status = "active";
    task.completed_at = null;
  } else {
    task.status = "done";
    task.completed_at = now;
    completeDescendants(task.id, now);
  }
  task.last_touched_at = now;
  persist();
  render();
}

// Manual "bump": resets the staleness clock without editing anything else.
function bumpTask(task) {
  task.last_touched_at = new Date().toISOString();
  persist();
  render();
}

function deleteTask(taskId) {
  const descendantIds = collectDescendantIds(taskId);
  const idsToRemove = new Set([taskId, ...descendantIds]);
  const task = tasks.find(t => t.id === taskId);
  const label = task ? `"${task.title}"` : "this task";
  const extra = descendantIds.length > 0 ? ` and its ${descendantIds.length} subtask(s)` : "";
  if (!confirm(`Delete ${label}${extra}?`)) return;
  tasks = tasks.filter(t => !idsToRemove.has(t.id));
  persist();
  render();
}

function collectDescendantIds(taskId) {
  const direct = tasks.filter(t => t.parent_task_id === taskId).map(t => t.id);
  let all = [...direct];
  direct.forEach(childId => {
    all = all.concat(collectDescendantIds(childId));
  });
  return all;
}

// ---------- Task modal ----------

const taskModal = document.getElementById("task-modal");
const taskForm = document.getElementById("task-form");
const taskFolderSelect = document.getElementById("task-folder");
const taskParentSelect = document.getElementById("task-parent");
const taskError = document.getElementById("task-error");

// Every folder/category picker (task form, folder-add form) is the same "one field, multiple
// entry points" component (populateFolderSelectInto / populateFolderCategorySelect), so the
// inline "+ New…" option lives once in each and reaches every caller: the main intake form,
// the Now/Later add forms (general and bucket-specific — all funnel through openTaskModal),
// the edit form, and the subtask add form.
const NEW_FOLDER_OPTION = "__new_folder__";
const NEW_CATEGORY_OPTION = "__new_category__";

// The select's last real (non-sentinel) value, so choosing "+ New folder…" can revert the
// select's own displayed value immediately (it's not a real choice, just an action) while the
// folder modal is open on top, and so a cancel there leaves the field exactly as it was.
let taskFolderLastRealValue = null;

function selectTaskFolder(folderId) {
  taskFolderSelect.value = folderId || "";
  taskFolderLastRealValue = taskFolderSelect.value;
  populateParentSelect(taskFolderSelect.value, document.getElementById("task-id").value || null, null);
}

// `prefillOrTask` is either an existing task (edit) or a prefill object for a new one:
// folder_id / parent_task_id as before, plus optional deadline / do_date / importance /
// is_quick_win (the Now window's "+ Add to Now" uses these).
function openTaskModal(prefillOrTask) {
  const isEdit = tasks.some(t => t.id === prefillOrTask.id);
  document.getElementById("task-modal-title").textContent = isEdit ? "Edit Task" : "Add Task";

  populateFolderSelectInto(taskFolderSelect, prefillOrTask.folder_id, true);
  populateParentSelect(prefillOrTask.folder_id, isEdit ? prefillOrTask.id : null, prefillOrTask.parent_task_id);

  document.getElementById("task-id").value = isEdit ? prefillOrTask.id : "";
  document.getElementById("task-title").value = isEdit ? prefillOrTask.title : "";
  document.getElementById("task-notes").value = isEdit ? prefillOrTask.notes : "";
  document.getElementById("task-deadline").value = prefillOrTask.deadline || "";
  document.getElementById("task-do-date").value = prefillOrTask.do_date || "";
  document.getElementById("task-importance").value = prefillOrTask.importance || "Low";
  // Bite-size defaults false for a new task; an edit shows the task's own value.
  setSizeToggle(prefillOrTask.is_quick_win === undefined ? false : !!prefillOrTask.is_quick_win);
  renderWeekPicker();
  taskError.textContent = "";

  taskFolderSelect.value = prefillOrTask.folder_id || folders[0]?.id || "";
  taskFolderLastRealValue = taskFolderSelect.value;
  taskParentSelect.value = prefillOrTask.parent_task_id || "";

  taskModal.classList.remove("hidden");
  document.getElementById("task-title").focus();
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  taskForm.reset();
  taskError.textContent = "";
}

// `includeCreateOption` appends a trailing "+ New folder…" sentinel — only the task form's
// picker wants it (see NEW_FOLDER_OPTION); the recurring-habit form reuses this same function
// without it, since inline creation there isn't one of this fix's entry points.
function populateFolderSelectInto(selectEl, selectedId, includeCreateOption) {
  selectEl.innerHTML = "";
  categories.forEach(category => {
    const categoryFolders = folders.filter(f => f.category_id === category.id);
    if (categoryFolders.length === 0) return;
    const group = document.createElement("optgroup");
    group.label = category.name;
    categoryFolders.forEach(folder => {
      const opt = document.createElement("option");
      opt.value = folder.id;
      opt.textContent = folder.name;
      group.appendChild(opt);
    });
    selectEl.appendChild(group);
  });
  if (includeCreateOption) {
    const opt = document.createElement("option");
    opt.value = NEW_FOLDER_OPTION;
    opt.textContent = "+ New folder…";
    selectEl.appendChild(opt);
  }
  if (selectedId) selectEl.value = selectedId;
}

function populateParentSelect(folderId, excludeTaskId, selectedParentId) {
  taskParentSelect.innerHTML = '<option value="">— none (top-level) —</option>';
  const excluded = excludeTaskId ? new Set([excludeTaskId, ...collectDescendantIds(excludeTaskId)]) : new Set();
  tasks
    .filter(t => t.folder_id === folderId && !excluded.has(t.id))
    .forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title;
      taskParentSelect.appendChild(opt);
    });
  taskParentSelect.value = selectedParentId || "";
}

taskFolderSelect.addEventListener("change", () => {
  if (taskFolderSelect.value === NEW_FOLDER_OPTION) {
    // Not a real choice — revert the visible value immediately, then let the folder modal
    // (opened on top, task form stays open underneath) create and hand back a real one.
    taskFolderSelect.value = taskFolderLastRealValue || "";
    openFolderModal(taskFolderSelect);
    return;
  }
  selectTaskFolder(taskFolderSelect.value);
});

// ---- Sizing toggle (Bite-size on/off) ----
// The label always reads "Bite-size" — on/off shows through the button's own filled vs.
// outline styling ([aria-pressed] in CSS), not through swapping its text. The off state has
// no name of its own; it's just the unmarked default.
const sizeToggleBtn = document.getElementById("task-quick-win");

function setSizeToggle(biteSize) {
  sizeToggleBtn.setAttribute("aria-pressed", biteSize ? "true" : "false");
  sizeToggleBtn.title = biteSize
    ? "Bite-size: a quick one, renders as a slimmer card. Click to turn off."
    : "Click to mark as Bite-size.";
}

function readSizeToggle() {
  return sizeToggleBtn.getAttribute("aria-pressed") === "true";
}

sizeToggleBtn.addEventListener("click", () => setSizeToggle(!readSizeToggle()));

// ---- Week-strip do_date picker ----
// Seven boxes, today first, one tap picks a day; the native date input underneath stays the
// source of truth (submit and prefill code read it unchanged) and sits visible alongside the
// strip at all times, for anything further out than a week.
const taskDoDateInput = document.getElementById("task-do-date");
const weekPickerStrip = document.getElementById("task-week-picker");
const weekPickerClearBtn = document.getElementById("task-do-date-clear");
weekPickerClearBtn.innerHTML = ICONS.close;

function renderWeekPicker() {
  const today = todayISODate();
  const value = taskDoDateInput.value || "";
  const strip = [];
  for (let i = 0; i < 7; i++) strip.push(addDaysISODate(today, i));

  weekPickerStrip.innerHTML = "";
  strip.forEach((dateStr, i) => {
    const day = parseLocalDate(dateStr);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-day" + (dateStr === value ? " active" : "") + (i === 0 ? " week-day-today" : "");
    btn.setAttribute("aria-pressed", dateStr === value ? "true" : "false");
    btn.title = i === 0 ? "Today" : i === 1 ? "Tomorrow" : day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
    const letter = document.createElement("span");
    letter.className = "week-day-letter";
    letter.textContent = WEEKDAY_LABELS[day.getDay()][0];
    btn.appendChild(letter);
    const num = document.createElement("span");
    num.className = "week-day-num";
    num.textContent = String(day.getDate());
    btn.appendChild(num);
    btn.addEventListener("click", () => {
      taskDoDateInput.value = dateStr;
      renderWeekPicker();
    });
    weekPickerStrip.appendChild(btn);
  });

  weekPickerClearBtn.hidden = !value;
}

taskDoDateInput.addEventListener("input", renderWeekPicker);
weekPickerClearBtn.addEventListener("click", () => {
  taskDoDateInput.value = "";
  renderWeekPicker();
});

taskForm.addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("task-id").value;
  const data = {
    folder_id: taskFolderSelect.value,
    parent_task_id: taskParentSelect.value || null,
    title: document.getElementById("task-title").value.trim(),
    notes: document.getElementById("task-notes").value.trim(),
    deadline: document.getElementById("task-deadline").value || null,
    do_date: document.getElementById("task-do-date").value || null,
    importance: document.getElementById("task-importance").value,
    is_quick_win: readSizeToggle(),
  };

  if (!data.title) return;

  const today = todayISODate();
  const existing = id ? tasks.find(t => t.id === id) : null;

  // Guard rail, both directions: a do_date after the deadline, or a deadline moved before the
  // do_date, is logically inconsistent — planning to do something once it's already due — so
  // the save is blocked outright rather than silently allowed. Exception: skip the block when
  // it's the deadline being pulled earlier than a do_date that's already rolled over into the
  // past (do_date < today) — that do_date is a stale rollover artifact, not a real commitment,
  // and shouldn't constrain a new deadline.
  if (data.do_date && data.deadline && data.do_date > data.deadline) {
    const prevDoDate = existing ? (existing.do_date || null) : null;
    const doDateChanged = prevDoDate !== data.do_date;
    const exempt = !doDateChanged && prevDoDate && prevDoDate < today;
    if (!exempt) {
      taskError.textContent = "Do date can't be after the deadline (" + data.deadline + ").";
      return;
    }
  }

  const now = new Date().toISOString();

  const finishSave = () => {
    // Deadline-default: a newly set or changed deadline becomes the do_date unless one is set.
    const deadlineChanged = !existing || (existing.deadline || null) !== data.deadline;
    if (deadlineChanged) applyDeadlineDefault(data);

    if (existing) {
      // A direct do_date edit is a genuine write: the silent-rollover count starts over.
      if ((existing.do_date || null) !== (data.do_date || null)) data.do_date_rollover_count = 0;
      Object.assign(existing, data);
      existing.last_touched_at = now;
    } else {
      tasks.push(makeTask(data));
    }

    closeTaskModal();
    persist();
    render();
  };

  // Deadline requirement, one pattern everywhere it applies (see windows.js's promptForDeadline):
  // a do_date of today without a deadline (i.e. actually landing in Daily Plate) would roll
  // forward silently forever with nothing else eventually forcing it to surface; a High/Critical
  // task would otherwise sit dateless in Plan. A future do_date (planning ahead in Fridge) isn't
  // either case, so it's exempt. Assess the second case as the task would actually be saved
  // (last_touched_at reset, staleness at zero).
  const candidate = Object.assign({}, existing || makeTask({}), data, { last_touched_at: now, status: "active" });
  const opts = (data.do_date === todayISODate() && !data.deadline) ? NOW_DEADLINE_PROMPT
    : isDeadlineViolator(candidate, todayISODate()) ? DEADLINE_REQUIRED_PROMPT
    : null;
  if (opts) {
    promptForDeadline({ title: data.title || "this task" }, opts).then(date => {
      if (!date) return; // cancelled: leave the form open, nothing saved
      data.deadline = date;
      document.getElementById("task-deadline").value = date;
      finishSave();
    });
    return;
  }

  finishSave();
});

document.getElementById("task-cancel-btn").addEventListener("click", closeTaskModal);
// No standalone toolbar "+ Task" anymore — every folder section already has its own bottom "+"
// (see renderFolderSection), one add-affordance policy app-wide: icon-only, in place.

taskModal.addEventListener("click", e => {
  if (e.target === taskModal) closeTaskModal();
});

// ---------- Folder modal ----------

const folderModal = document.getElementById("folder-modal");
const folderForm = document.getElementById("folder-form");
const folderCategorySelect = document.getElementById("folder-category");

// Which select to populate+select once the new folder is created: taskFolderSelect when
// opened inline from the task form's "+ New folder…" (see the taskFolderSelect change
// listener above), null for the standalone header/folder-list "+" icon.
let folderModalTarget = null;
// Same revert-on-open-the-nested-modal pattern as taskFolderLastRealValue, one level down:
// folder-category's own "+ New category…" option.
let folderCategoryLastRealValue = null;

function populateFolderCategorySelect(selectedId) {
  folderCategorySelect.innerHTML = "";
  categories.forEach(category => {
    const opt = document.createElement("option");
    opt.value = category.id;
    opt.textContent = category.name;
    folderCategorySelect.appendChild(opt);
  });
  const newOpt = document.createElement("option");
  newOpt.value = NEW_CATEGORY_OPTION;
  newOpt.textContent = "+ New category…";
  folderCategorySelect.appendChild(newOpt);
  folderCategorySelect.value = selectedId || (categories[0] ? categories[0].id : NEW_CATEGORY_OPTION);
  folderCategoryLastRealValue = folderCategorySelect.value === NEW_CATEGORY_OPTION ? null : folderCategorySelect.value;
}

// `targetSelect` (optional): the folder picker to populate+select once this folder is saved —
// see folderModalTarget. No categories yet is no longer a dead end (the old blocking alert()
// is gone): the category select opens with only "+ New category…" available, so one is
// created inline without leaving this modal either.
function openFolderModal(targetSelect) {
  folderModalTarget = targetSelect || null;
  folderForm.reset();
  const defaultCategoryId = activeCategoryFilter !== "all" && categories.some(c => c.id === activeCategoryFilter)
    ? activeCategoryFilter
    : (categories[0] ? categories[0].id : null);
  populateFolderCategorySelect(defaultCategoryId);
  folderModal.classList.remove("hidden");
  document.getElementById("folder-name").focus();
}

function closeFolderModal() {
  folderModal.classList.add("hidden");
  folderModalTarget = null;
}

folderCategorySelect.addEventListener("change", () => {
  if (folderCategorySelect.value === NEW_CATEGORY_OPTION) {
    folderCategorySelect.value = folderCategoryLastRealValue || "";
    openCategoryModal(folderCategorySelect);
    return;
  }
  folderCategoryLastRealValue = folderCategorySelect.value;
});

folderForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("folder-name").value.trim();
  const categoryId = folderCategorySelect.value;
  if (!name || !categoryId || categoryId === NEW_CATEGORY_OPTION) return;
  const folder = { id: makeId(), category_id: categoryId, name };
  folders.push(folder);
  const target = folderModalTarget;
  closeFolderModal();
  persist();
  render();
  if (target === taskFolderSelect) {
    populateFolderSelectInto(taskFolderSelect, folder.id, true);
    selectTaskFolder(folder.id);
  }
});

document.getElementById("folder-cancel-btn").addEventListener("click", closeFolderModal);
folderModal.addEventListener("click", e => {
  if (e.target === folderModal) closeFolderModal();
});

// ---------- Recurring habit modal ----------

const recurringModal = document.getElementById("recurring-modal");
const recurringForm = document.getElementById("recurring-form");
const recurringFolderSelect = document.getElementById("recurring-folder");
const recurringCadenceSelect = document.getElementById("recurring-cadence");
const recurringWeekdaySelect = document.getElementById("recurring-weekday");
const recurringWeekdayLabel = document.getElementById("recurring-weekday-label");
const recurringDomSelect = document.getElementById("recurring-dom");
const recurringDomLabel = document.getElementById("recurring-dom-label");

// Weekly shows the weekday picker, monthly the day-of-month picker, daily neither.
function updateRecurringCadenceFields() {
  recurringWeekdayLabel.hidden = recurringCadenceSelect.value !== "weekly";
  recurringDomLabel.hidden = recurringCadenceSelect.value !== "monthly";
}

recurringCadenceSelect.addEventListener("change", updateRecurringCadenceFields);

// Day-of-month options: "last day" (empty) then 1..31, built once.
for (let day = 1; day <= 31; day++) {
  const opt = document.createElement("option");
  opt.value = String(day);
  opt.textContent = String(day);
  recurringDomSelect.appendChild(opt);
}

function openRecurringModal(prefillOrRt) {
  if (folders.length === 0) {
    alert("Add a folder first.");
    return;
  }

  const isEdit = recurringTasks.some(r => r.id === prefillOrRt.id);
  document.getElementById("recurring-modal-title").textContent = isEdit ? "Edit Habit" : "Add Habit";

  populateFolderSelectInto(recurringFolderSelect, prefillOrRt.folder_id || folders[0].id);

  document.getElementById("recurring-id").value = isEdit ? prefillOrRt.id : "";
  document.getElementById("recurring-title").value = isEdit ? prefillOrRt.title : "";
  recurringCadenceSelect.value = isEdit ? prefillOrRt.cadence : (prefillOrRt.cadence || "daily");
  // Weekday / day-of-month are optional: no forced choice on a new habit, they read as Sunday
  // / the month's last day until one is set.
  recurringWeekdaySelect.value = isEdit && prefillOrRt.weekday != null ? String(prefillOrRt.weekday) : "";
  recurringDomSelect.value = isEdit && prefillOrRt.day_of_month != null ? String(prefillOrRt.day_of_month) : "";
  updateRecurringCadenceFields();

  recurringModal.classList.remove("hidden");
  document.getElementById("recurring-title").focus();
}

function closeRecurringModal() {
  recurringModal.classList.add("hidden");
  recurringForm.reset();
}

recurringForm.addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("recurring-id").value;
  const data = {
    folder_id: recurringFolderSelect.value,
    title: document.getElementById("recurring-title").value.trim(),
    cadence: recurringCadenceSelect.value,
    weekday: recurringCadenceSelect.value === "weekly" && recurringWeekdaySelect.value !== ""
      ? Number(recurringWeekdaySelect.value)
      : null,
    day_of_month: recurringCadenceSelect.value === "monthly" && recurringDomSelect.value !== ""
      ? Number(recurringDomSelect.value)
      : null,
  };

  if (!data.title || !data.folder_id) return;

  const existing = id ? recurringTasks.find(r => r.id === id) : null;
  if (existing) {
    Object.assign(existing, data);
  } else {
    recurringTasks.push(makeRecurringTask(data));
  }

  closeRecurringModal();
  persist();
  render();
});

document.getElementById("recurring-cancel-btn").addEventListener("click", closeRecurringModal);
recurringModal.addEventListener("click", e => {
  if (e.target === recurringModal) closeRecurringModal();
});

// ---------- Category modal ----------

const categoryModal = document.getElementById("category-modal");
const categoryForm = document.getElementById("category-form");

// Which select to populate+select once the new category is created: folderCategorySelect
// when opened inline from the folder modal's own "+ New category…" (itself reachable from the
// task form's "+ New folder…", so a brand-new category is never a dead end there either); null
// for the standalone header "+ Category" icon.
let categoryModalTarget = null;

function openCategoryModal(targetSelect) {
  categoryModalTarget = targetSelect || null;
  categoryForm.reset();
  categoryModal.classList.remove("hidden");
  document.getElementById("category-name").focus();
}

function closeCategoryModal() {
  categoryModal.classList.add("hidden");
  categoryModalTarget = null;
}

categoryForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("category-name").value.trim();
  if (!name) return;
  const category = { id: makeId(), name };
  categories.push(category);
  const target = categoryModalTarget;
  // Switching the active category tab is only right for the standalone icon flow — a nested
  // "just need a category to hang this folder off" creation shouldn't yank the main view's tab.
  if (!target) activeCategoryFilter = category.id;
  closeCategoryModal();
  persist();
  render();
  if (target === folderCategorySelect) populateFolderCategorySelect(category.id);
});

document.getElementById("category-cancel-btn").addEventListener("click", closeCategoryModal);
categoryModal.addEventListener("click", e => {
  if (e.target === categoryModal) closeCategoryModal();
});

// ---------- Bulk import ----------
// Lightweight, mechanical line parser — no AI call, no file upload, just a paste box. One
// task created per non-empty line:
//   #folder    assigns the task to that folder (its category comes along with it), creating
//              the folder — under an Inbox category, since a line names no category of its
//              own — if no folder of that name exists yet. Must be the FIRST token if present.
//   @friday / @2026-10-01   sets deadline: a weekday name (this coming one, today counts) or
//              an exact "YYYY-MM-DD" date. An unrecognized @token is left as plain title text.
//   !          sets deadline to today.
//   *          sets do_date to today, independent of deadline (the do_date default from a
//              deadline still applies afterward via applyDeadlineDefault, same as everywhere
//              else a deadline gets set).
// Tags combine freely and in any order after the folder tag; everything left over, in its
// original order, is the title. A line with no #folder tag (recognized or not) falls back to
// an Inbox folder/category (created if needed) — there's nothing else to place it under.

const bulkImportModal = document.getElementById("bulk-import-modal");
const bulkImportForm = document.getElementById("bulk-import-form");
const bulkImportText = document.getElementById("bulk-import-text");
const bulkImportError = document.getElementById("bulk-import-error");
const bulkImportResults = document.getElementById("bulk-import-results");
const bulkImportSummary = document.getElementById("bulk-import-summary");
const bulkImportList = document.getElementById("bulk-import-list");

const BULK_IMPORT_WEEKDAYS = Object.freeze({
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
});

// The next date (today counts) matching this weekday — same "this week if it hasn't passed,
// else next week" rule the recurring-habit engine already uses (recurringWeekday/nextRecurringOccurrence).
function nextWeekdayDate(weekdayNum, today) {
  const base = parseLocalDate(today);
  base.setDate(base.getDate() + ((weekdayNum - base.getDay() + 7) % 7));
  return localDateString(base);
}

// Returns a "YYYY-MM-DD" string, or null if `raw` (the text after '@') isn't a recognized
// weekday name or an exact ISO date.
function parseBulkImportDeadline(raw, today) {
  const value = raw.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (BULK_IMPORT_WEEKDAYS[value] !== undefined) return nextWeekdayDate(BULK_IMPORT_WEEKDAYS[value], today);
  return null;
}

// One line -> { title, folderName, deadline, doDateToday }, or null for a blank line.
// folderName/deadline are null when absent; unresolved tokens (a bare '#' with nothing after
// it, an '@' that didn't parse) fall through into the title rather than vanishing silently.
function parseBulkImportLine(line, today) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let folderName = null;
  let deadline = null;
  let doDateToday = false;
  const titleTokens = [];

  tokens.forEach((token, i) => {
    if (i === 0 && token.length > 1 && token[0] === "#") {
      folderName = token.slice(1);
      return;
    }
    if (token === "!") { deadline = today; return; }
    if (token === "*") { doDateToday = true; return; }
    if (token.length > 1 && token[0] === "@") {
      const parsed = parseBulkImportDeadline(token.slice(1), today);
      if (parsed) { deadline = parsed; return; }
    }
    titleTokens.push(token);
  });

  return { title: titleTokens.join(" ").trim(), folderName, deadline, doDateToday };
}

function findOrCreateInboxCategory() {
  const existing = categories.find(c => c.name.toLowerCase() === "inbox");
  if (existing) return existing;
  const category = { id: makeId(), name: "Inbox" };
  categories.push(category);
  return category;
}

function findOrCreateInboxFolder() {
  const existing = folders.find(f => f.name.toLowerCase() === "inbox");
  if (existing) return existing;
  const folder = { id: makeId(), category_id: findOrCreateInboxCategory().id, name: "Inbox" };
  folders.push(folder);
  return folder;
}

// A #tag names a folder by its plain name (matched case-insensitively against every existing
// folder, regardless of category) — reuses the same shape the folder-add form's own creation
// logic writes (id / category_id / name), just without a form around it. A brand-new folder
// has no category of its own to go by, so it lands in Inbox, exactly like an untagged line.
function findOrCreateBulkImportFolder(name) {
  const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const folder = { id: makeId(), category_id: findOrCreateInboxCategory().id, name };
  folders.push(folder);
  return folder;
}

// Runs the whole paste through parseBulkImportLine and creates one task per line that ends up
// with a title. Returns { created: [{task, folder}], skipped } — skipped counts lines that
// were entirely tags (or blank) and so had nothing left to title a task with.
function runBulkImport(text, today) {
  const created = [];
  let skipped = 0;

  text.split("\n").forEach(rawLine => {
    const parsed = parseBulkImportLine(rawLine, today);
    if (!parsed) return; // blank line, not worth counting as skipped
    if (!parsed.title) { skipped++; return; }

    const folder = parsed.folderName ? findOrCreateBulkImportFolder(parsed.folderName) : findOrCreateInboxFolder();
    const overrides = { folder_id: folder.id, title: parsed.title };
    if (parsed.deadline) overrides.deadline = parsed.deadline;
    if (parsed.doDateToday) overrides.do_date = today;
    applyDeadlineDefault(overrides); // same deadline -> do_date default every other path follows

    const task = makeTask(overrides);
    tasks.push(task);
    created.push({ task, folder });
  });

  if (created.length > 0) { persist(); render(); }
  return { created, skipped };
}

function openBulkImportModal() {
  bulkImportForm.reset();
  bulkImportError.textContent = "";
  bulkImportForm.hidden = false;
  bulkImportResults.hidden = true;
  bulkImportModal.classList.remove("hidden");
  bulkImportText.focus();
}

function closeBulkImportModal() {
  bulkImportModal.classList.add("hidden");
}

bulkImportForm.addEventListener("submit", e => {
  e.preventDefault();
  if (!bulkImportText.value.trim()) {
    bulkImportError.textContent = "Paste at least one line first.";
    return;
  }
  const { created, skipped } = runBulkImport(bulkImportText.value, todayISODate());

  bulkImportForm.hidden = true;
  bulkImportResults.hidden = false;
  const skippedNote = skipped ? " (" + pluralCount(skipped, "line") + " skipped — no title once tags were removed)" : "";
  bulkImportSummary.textContent = created.length === 0
    ? "Nothing imported." + skippedNote
    : "Imported " + pluralCount(created.length, "task") + "." + skippedNote;
  bulkImportList.innerHTML = "";
  created.forEach(({ task, folder }, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--i", i); // staggers the confirmation rows' entrance (style.css)
    li.textContent = task.title + " — " + folder.name;
    bulkImportList.appendChild(li);
  });
});

document.getElementById("bulk-import-btn").addEventListener("click", openBulkImportModal);
document.getElementById("bulk-import-cancel-btn").addEventListener("click", closeBulkImportModal);
document.getElementById("bulk-import-done-btn").addEventListener("click", closeBulkImportModal);
bulkImportModal.addEventListener("click", e => {
  if (e.target === bulkImportModal) closeBulkImportModal();
});

// ---------- Settings modal ----------
// Thresholds live in the synced data file. Saving re-renders immediately, which is all a
// "recalculation" needs since urgency is derived at render time and never stored.

const settingsModal = document.getElementById("settings-modal");
const settingsForm = document.getElementById("settings-form");
const settingsError = document.getElementById("settings-error");

const SETTINGS_FIELDS = {
  deadline_low_days: "setting-deadline-low",
  deadline_medium_days: "setting-deadline-medium",
  deadline_high_days: "setting-deadline-high",
  staleness_low_days: "setting-staleness-low",
  staleness_medium_days: "setting-staleness-medium",
  staleness_high_days: "setting-staleness-high",
  priority_importance_weight: "setting-priority-weight",
  quadrant_split_score: "setting-quadrant-split",
  overview_top_n: "setting-overview-top-n",
  overview_flag_threshold: "setting-overview-flag",
  staleness_reminder_interval_days: "setting-staleness-reminder-interval",
  staleness_reminder_low_days: "setting-staleness-reminder-low",
  staleness_reminder_medium_days: "setting-staleness-reminder-medium",
  staleness_reminder_high_days: "setting-staleness-reminder-high",
  do_today_urgency_floor: "setting-do-today-floor",
  weekly_recurring_now_days: "setting-weekly-recurring-now",
  monthly_recurring_now_days: "setting-monthly-recurring-now",
  daily_capacity_points: "setting-daily-capacity",
};

function fillSettingsForm(values) {
  Object.entries(SETTINGS_FIELDS).forEach(([key, inputId]) => {
    document.getElementById(inputId).value = values[key];
  });
  settingsError.textContent = "";
}

function readSettingsForm() {
  const values = {};
  Object.entries(SETTINGS_FIELDS).forEach(([key, inputId]) => {
    values[key] = Number(document.getElementById(inputId).value);
  });
  return values;
}

function validateSettings(v) {
  const allNumbers = Object.values(v).every(n => Number.isFinite(n) && n >= 0);
  if (!allNumbers) return "All values must be numbers of 0 or more.";
  if (!(v.deadline_low_days >= v.deadline_medium_days && v.deadline_medium_days >= v.deadline_high_days)) {
    return "Deadline days must run low ≥ medium ≥ high (e.g. 14 / 7 / 3).";
  }
  if (!(v.staleness_low_days <= v.staleness_medium_days && v.staleness_medium_days <= v.staleness_high_days)) {
    return "Staleness days must run low ≤ medium ≤ high (e.g. 3 / 7 / 8).";
  }
  if (v.priority_importance_weight > 1) return "Importance weight is a fraction from 0 to 1.";
  if (v.quadrant_split_score > 100) return "Quadrant split is a score from 0 to 100.";
  if (v.overview_flag_threshold > 100) return "Flag threshold is a score from 0 to 100.";
  if (!Number.isInteger(v.overview_top_n)) return "Top N must be a whole number.";
  if (v.staleness_reminder_interval_days < 1) return "Re-flag interval must be at least 1 day.";
  if (!(v.staleness_reminder_low_days <= v.staleness_reminder_medium_days && v.staleness_reminder_medium_days <= v.staleness_reminder_high_days)) {
    return "Staleness check-in colors must run mild ≤ medium ≤ strong (e.g. 7 / 14 / 28).";
  }
  if (v.do_today_urgency_floor > 100) return "Daily Plate floor is a score from 0 to 100.";
  if (!(v.do_today_urgency_floor > v.quadrant_split_score)) {
    return "Daily Plate floor must be above the quadrant split (" + v.quadrant_split_score + "), so a task planned for today actually moves into Do or Clear.";
  }
  if (!Number.isInteger(v.weekly_recurring_now_days) || v.weekly_recurring_now_days > 6) {
    return "Weekly habits in Daily Plate: use a whole number of days from 0 (Sunday only) to 6 (all week).";
  }
  if (v.daily_capacity_points <= 0) return "Daily capacity must be greater than 0.";
  return null;
}

function openSettingsModal() {
  fillSettingsForm(settings);
  settingsModal.classList.remove("hidden");
  document.getElementById(SETTINGS_FIELDS.deadline_low_days).focus();
}

function closeSettingsModal() {
  settingsModal.classList.add("hidden");
}

settingsForm.addEventListener("submit", e => {
  e.preventDefault();
  const values = readSettingsForm();
  const error = validateSettings(values);
  if (error) {
    settingsError.textContent = error;
    return;
  }
  settings = normalizeSettings(Object.assign({}, settings, values));
  closeSettingsModal();
  persist();
  render();
});

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);
document.getElementById("settings-cancel-btn").addEventListener("click", closeSettingsModal);
document.getElementById("settings-reset-btn").addEventListener("click", () => fillSettingsForm(DEFAULT_SETTINGS));
settingsModal.addEventListener("click", e => {
  if (e.target === settingsModal) closeSettingsModal();
});

// ---------- Completion check animation ----------
// The one deliberate flourish in the UI (.check-anim in style.css): checking any completion
// box fills it and draws the tick. Wired once, globally, in the capture phase so it sees the
// change before the box's own handler runs. Some handlers (habits) re-render synchronously and
// replace the element, so on the next frame — still before paint — the animation is also
// applied to whichever box now carries the same data-check-id and isn't already playing it.
function playCheckAnimation(box) {
  box.classList.remove("check-anim");
  void box.offsetWidth; // restart cleanly on a quick uncheck/recheck
  box.classList.add("check-anim");
  setTimeout(() => box.classList.remove("check-anim"), 450);
}

function wireCheckAnimation() {
  document.addEventListener("change", e => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox" || !box.checked) return;
    const id = box.dataset.checkId;
    if (!id) return;
    playCheckAnimation(box);
    requestAnimationFrame(() => {
      document.querySelectorAll('input[type="checkbox"][data-check-id="' + CSS.escape(id) + '"]').forEach(b => {
        if (b.checked && !b.classList.contains("check-anim")) playCheckAnimation(b);
      });
    });
  }, true);
}

wireCheckAnimation();

// ---------- Theme toggle ----------

const themeToggleBtn = document.getElementById("theme-toggle-btn");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyThemeIcon() {
  themeToggleBtn.innerHTML = currentTheme() === "dark" ? flipIcon(ICONS.sun, ICONS.moon) : flipIcon(ICONS.moon, ICONS.sun);
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  applyThemeIcon();
});

applyThemeIcon();
document.getElementById("shortcuts-btn").innerHTML = rollIcon("<span>?</span>");
document.getElementById("settings-btn").innerHTML = ICONS.gear;
document.getElementById("calendar-prev-btn").innerHTML = ICONS.prev;
document.getElementById("calendar-next-btn").innerHTML = ICONS.next;
document.getElementById("bulk-import-btn").innerHTML = ICONS.import;

// ---------- Storage UI ----------

const storageBar = document.getElementById("storage-bar");
const storageGate = document.getElementById("storage-gate");

function renderStorageBar() {
  storageBar.innerHTML = "";

  const text = document.createElement("span");
  text.className = "storage-text";
  if (storage.mode === "file") {
    text.textContent = "Syncing to folder “" + storage.folderName + "”";
  } else if (storage.supportsFolders) {
    text.textContent = "Saved in this browser only";
  } else {
    text.textContent = "Saved in this browser (folder sync needs Edge or Chrome)";
  }
  storageBar.appendChild(text);

  const statusLabels = { saving: "Saving…", saved: "Saved", error: "Save failed" };
  if (statusLabels[storage.status]) {
    const status = document.createElement("span");
    status.className = "storage-status storage-status-" + storage.status;
    status.textContent = statusLabels[storage.status];
    storageBar.appendChild(status);
  }

  if (storage.supportsFolders) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn";
    btn.textContent = storage.mode === "file" ? "Change folder" : "Choose OneDrive folder";
    btn.addEventListener("click", chooseFolder);
    storageBar.appendChild(btn);
  }
}

async function chooseFolder() {
  let existing;
  try {
    existing = await storage.chooseFolder();
  } catch (e) {
    console.error(e);
    alert("Could not open that folder: " + e.message);
    return;
  }
  if (existing === undefined) return;

  if (existing) {
    const localTaskCount = tasks.length;
    const ok = localTaskCount === 0 || confirm(
      "This folder already contains task data. Load it and discard the " +
      localTaskCount + " task(s) currently shown here?"
    );
    if (!ok) {
      storage.cancelFolder();
      return;
    }
  }

  await storage.commitFolder();
  if (existing) loadState(existing);
  persist();
  render();
  renderStorageBar();
}

function showStorageGate() {
  document.getElementById("storage-gate-folder").textContent = storage.folderName;
  storageGate.classList.remove("hidden");
}

async function applyLoadResult(result) {
  if (result.state === "needs-permission") {
    showStorageGate();
    return;
  }
  storageGate.classList.add("hidden");
  loadState(result.data);
  runDailyMaintenance();      // freeze past planned days, roll do_dates forward
  persistIfSnapshotChanged(); // first open of the day: freeze yesterday, start today's snapshot
  render();
  renderStorageBar();
  showBackfillIfNeeded();
}

// ---------- Deadline backfill ----------
// The deadline requirement applied retroactively: any existing High/Critical task sitting in
// Plan without a deadline is listed here on load and must be given one before the modal can
// be dismissed. No "done" flag is stored — the task form blocks new violators, so once this
// list is empty it stays empty (and if a bump ever pushes an undated High task back into
// Plan, it simply shows up here again next load, which is the same rule applied consistently).

const backfillModal = document.getElementById("backfill-modal");
const backfillForm = document.getElementById("backfill-form");
const backfillList = document.getElementById("backfill-list");

function showBackfillIfNeeded() {
  if (!backfillModal.classList.contains("hidden")) return; // already up
  const violators = findDeadlineViolators();
  if (violators.length === 0) return;

  backfillList.innerHTML = "";
  violators.forEach(task => {
    const row = document.createElement("label");
    row.className = "backfill-row";

    const text = document.createElement("span");
    text.className = "backfill-text";
    const title = document.createElement("span");
    title.className = "backfill-title";
    title.textContent = task.title;
    text.appendChild(title);
    const meta = document.createElement("span");
    meta.className = "backfill-meta";
    meta.textContent = [taskContextLabel(task), task.importance].filter(Boolean).join(" · ");
    text.appendChild(meta);
    row.appendChild(text);

    const input = document.createElement("input");
    input.type = "date";
    input.required = true;
    input.dataset.taskId = task.id;
    input.min = todayISODate();
    row.appendChild(input);

    backfillList.appendChild(row);
  });

  backfillModal.classList.remove("hidden");
  const first = backfillList.querySelector("input");
  if (first) first.focus();
}

backfillForm.addEventListener("submit", e => {
  e.preventDefault();
  const inputs = Array.from(backfillList.querySelectorAll("input[type=date]"));
  if (inputs.some(i => !i.value)) return; // `required` also blocks this, belt and braces
  const now = new Date().toISOString();
  inputs.forEach(input => {
    const task = tasks.find(t => t.id === input.dataset.taskId);
    if (!task) return;
    task.deadline = input.value;
    applyDeadlineDefault(task);
    task.last_touched_at = now;
  });
  backfillModal.classList.add("hidden");
  persist();
  render();
});

async function runStorageAction(action) {
  try {
    await applyLoadResult(await action());
  } catch (e) {
    console.error(e);
    alert("Could not load data: " + e.message);
  }
}

document.getElementById("gate-reconnect-btn").addEventListener("click", () => runStorageAction(() => storage.reconnect()));
document.getElementById("gate-browser-btn").addEventListener("click", () => runStorageAction(() => storage.disconnect()));
document.getElementById("gate-choose-btn").addEventListener("click", async () => {
  await storage.disconnect();
  await applyLoadResult({ state: "ready", data: null });
  chooseFolder();
});

async function syncFromFolder() {
  let data = null;
  try {
    data = await storage.checkForExternalChanges();
  } catch (e) {
    console.error("Could not read folder changes", e);
  }
  if (data) {
    loadState(data);
    runDailyMaintenance();
    persistIfSnapshotChanged();
  }
  render();
  if (data) showBackfillIfNeeded();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromFolder();
  else storage.flush();
});
window.addEventListener("focus", syncFromFolder);
setInterval(syncFromFolder, 30000);

// Daily recalculation: urgency is derived from "today" at render time, so a re-render just
// after local midnight is all it takes for scores, quadrants and tints to roll over. The
// snapshot is refreshed too, so yesterday's entry is left frozen and the digest can diff.
function scheduleMidnightRender() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  setTimeout(() => {
    runDailyMaintenance();      // freeze yesterday's planned set, roll do_dates
    persistIfSnapshotChanged();
    render();
    scheduleMidnightRender();
  }, next - now);
}
scheduleMidnightRender();

// ---------- Keyboard shortcuts ----------
// A short, deliberate set: add a task, switch views, toggle Focus mode, and a cheat sheet so
// they stay discoverable. Suppressed while typing anywhere (any field) or when a modifier key
// is held, so browser/OS shortcuts are never shadowed — Esc is the one exception, since backing
// out of whatever's open should always work.

const shortcutsModal = document.getElementById("shortcuts-modal");

function openShortcutsModal() {
  shortcutsModal.classList.remove("hidden");
}
function closeShortcutsModal() {
  shortcutsModal.classList.add("hidden");
}
document.getElementById("shortcuts-btn").addEventListener("click", openShortcutsModal);
document.getElementById("shortcuts-close-btn").addEventListener("click", closeShortcutsModal);
shortcutsModal.addEventListener("click", e => {
  if (e.target === shortcutsModal) closeShortcutsModal();
});

function isTypingTarget(el) {
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

// backfill-modal is deliberately excluded: it has no cancel path anywhere, by design (see its
// markup comment), so Esc must not open one either. Category and folder are checked before
// task: the task form's inline "+ New folder…"/"+ New category…" can stack either or both on
// top of it (see taskFolderSelect/folderCategorySelect), and Esc should close the topmost one
// first, not the task form underneath it.
function closeTopModal() {
  if (!categoryModal.classList.contains("hidden")) return closeCategoryModal();
  if (!folderModal.classList.contains("hidden")) return closeFolderModal();
  if (!taskModal.classList.contains("hidden")) return closeTaskModal();
  if (!recurringModal.classList.contains("hidden")) return closeRecurringModal();
  if (!settingsModal.classList.contains("hidden")) return closeSettingsModal();
  if (!shortcutsModal.classList.contains("hidden")) return closeShortcutsModal();
  if (!nowDeadlineModal.classList.contains("hidden")) return settleDeadlinePrompt(null);
  if (!bulkImportModal.classList.contains("hidden")) return closeBulkImportModal();
}

function anyModalOpen() {
  return [taskModal, folderModal, recurringModal, categoryModal, settingsModal, shortcutsModal, nowDeadlineModal, bulkImportModal]
    .some(modal => !modal.classList.contains("hidden"));
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (anyModalOpen()) { closeTopModal(); return; }
    return; // Focus mode's own Esc handling lives in windows.js
  }

  if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || anyModalOpen()) return;

  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    addTaskToNowDirectly();
  } else if (e.key === "f" || e.key === "F") {
    if (activeView === "list" && listDisplayMode === "windows") {
      e.preventDefault();
      if (focusModeOpen) closeFocusMode(); else openFocusMode();
    }
  } else if (e.key === "1") {
    e.preventDefault();
    setActiveView("overview");
  } else if (e.key === "2") {
    e.preventDefault();
    setActiveView("list");
  } else if (e.key === "3") {
    e.preventDefault();
    setActiveView("calendar");
  } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    e.preventDefault();
    openShortcutsModal();
  }
});

// ---------- Init ----------

storage.onStatusChange = renderStorageBar;
runStorageAction(() => storage.init());
