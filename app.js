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

const DATA_VERSION = 7; // v3: settings object; v4: quadrantHistory (daily digest); v5: quadrantHistory
// records enriched with deadline/importance/last_touched_at/priority_score, for the primary
// (automatic drift) vs secondary (manual edit) digest split; v6: manual_urgent_flag removed
// (migrated to deadline = today / do_date = today), do_date + is_quick_win added to Task,
// plannedHistory (permanent per-day frozen "planned" sets for the Calendar) added; v7: Now
// window rebuilt as a live union (do_date == today OR quadrant Do/Clear) — the old
// transition-detection auto-population is gone, so quadrantHistory and every do_date written
// under that design are discarded once (resetToV7), not migrated; snapshot records gain a
// do_date key for the digest's "became Do Today" check

// Minimalist outline icons (stroke = currentColor, so they inherit button text color).
const SVG_ATTRS = 'viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  pencil: `<svg ${SVG_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  trash: `<svg ${SVG_ATTRS}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
  sun: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>`,
  moon: `<svg ${SVG_ATTRS}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`,
  gear: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  bump: `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`,
  focus: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>`,
  close: `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  plus: `<svg ${SVG_ATTRS}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  // Bite-size marker: a small apple with a bite out of it, drawn at 12px on cards.
  bite: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-1.5-1.5-4.5-1.5-6 1-2 3-1 8 1.5 11 1.2 1.5 3 1.5 4.5.5 1.5 1 3.3 1 4.5-.5a10 10 0 0 0 2.2-4.5c-2.5-.2-4.2-2.3-3.7-4.8-1-.3-2-1.5-3-2.7Z"/><path d="M12 6c0-2 1-3 3-3.5"/></svg>`,
};

// Daily Plate / Fridge icons: bigger than the rest of the icon set (this pair doubles as each
// window's expand/focus control, so they need to read as more than a generic small glyph) and
// state-aware — plate shows food when Daily Plate is expanded, fridge shows its door open when
// Fridge is expanded, empty/closed otherwise, the same on/off-through-appearance language as
// the Bite-size toggle rather than a text or icon-shape swap for "expand" vs. "shrink".
const PLACE_ICON_ATTRS = 'viewBox="0 0 28 22" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

function plateIcon(hasFood) {
  const food = hasFood
    ? '<circle cx="12.5" cy="9.5" r="1.9" fill="currentColor" stroke="none"/>'
      + '<circle cx="16" cy="11.5" r="1.5" fill="currentColor" stroke="none"/>'
      + '<circle cx="12.5" cy="13.5" r="1.7" fill="currentColor" stroke="none"/>'
    : "";
  // Fork (left, three tines merging into a stem) — plate (center circle) — knife (right,
  // a blade that bulges out then tapers back into its handle).
  return `<svg ${PLACE_ICON_ATTRS}>`
    + '<circle cx="14" cy="11" r="6.5"/>'
    + '<path d="M2 2v5"/><path d="M3.5 2v5"/><path d="M5 2v5"/><path d="M3.5 7v13"/>'
    + '<path d="M24 2c1.3 0 2 1.6 2 3.5S25.3 9 24 9"/><path d="M24 9v11"/>'
    + food
    + "</svg>";
}

function fridgeIcon(open) {
  if (open) {
    // Body (interior) rect, a door leaf swung open to the left, two shelf lines standing in
    // for the handle marks a closed door would show instead.
    return `<svg ${PLACE_ICON_ATTRS}>`
      + '<rect x="10" y="2" width="15" height="18" rx="2"/>'
      + '<path d="M10 3 3 5v14l7-2"/>'
      + '<line x1="13" y1="8" x2="22" y2="8"/>'
      + '<line x1="13" y1="13" x2="22" y2="13"/>'
      + "</svg>";
  }
  // Closed: a plain door rect, the freezer divide near the top, two small handle ticks.
  return `<svg ${PLACE_ICON_ATTRS}>`
    + '<rect x="7" y="2" width="15" height="18" rx="2"/>'
    + '<line x1="7" y1="8" x2="22" y2="8"/>'
    + '<line x1="10" y1="4.5" x2="10" y2="6.5"/>'
    + '<line x1="10" y1="10.5" x2="10" y2="13"/>'
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
  tasks.forEach(normalizeTaskFields);
  recurringTasks.forEach(normalizeRecurringFields);
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
  if (task.status !== "active" || task.deadline) return false;
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
    is_quick_win: true,   // "Bite-size" (true) vs "Main Course" sizing: display/organization only, no scoring effect
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

// Completing clears the missed flag on the spot ("back on track"); undoing recomputes it
// from the log, so a mis-click doesn't lose the nudge.
function toggleRecurringTask(rt) {
  const today = todayISODate();
  if (isRecurringDoneNow(rt)) {
    const loggedDate = rt.last_completed_date;
    completionLog = completionLog.filter(l => !(l.recurring_task_id === rt.id && l.completed_date === loggedDate));
    rt.last_completed_date = null;
    rt.missed_last_period = computeMissedLastPeriod(rt, today, completionLog);
  } else {
    rt.last_completed_date = today;
    completionLog.push({ id: makeId(), recurring_task_id: rt.id, completed_date: today });
    rt.missed_last_period = false;
  }
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
  activeView = next;
  render();
}

document.querySelectorAll("#view-switch .view-switch-btn").forEach(btn => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

function renderViewSwitch() {
  document.querySelectorAll("#view-switch .view-switch-btn").forEach(btn => {
    const isActive = btn.dataset.view === activeView;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const isList = activeView === "list";
  const listMode = listDisplayMode;
  document.getElementById("list-view").hidden = !isList;
  // The category tabs and heat-map legend belong to the folder-organized "full" page; the
  // Overdue callout is a safety signal and stays up in either List mode.
  document.getElementById("folder-tabs").hidden = !(isList && listMode === "full");
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
  const toggle = document.getElementById("list-mode");
  toggle.innerHTML = "";
  LIST_MODES.forEach(mode => {
    const btn = document.createElement("button");
    btn.type = "button";
    const active = listDisplayMode === mode.key;
    btn.className = "view-switch-btn" + (active ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.textContent = mode.label;
    btn.addEventListener("click", () => setListDisplayMode(mode.key));
    toggle.appendChild(btn);
  });
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

  const card = document.createElement("div");
  card.className = "overdue-card quadrant-" + assessment.quadrant.key;
  card.style.setProperty("--p", assessment.intensity.toFixed(3));
  card.title = buildTaskTooltip(task, assessment, { quadrant: true, importance: true, deadline: true });

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "overdue-card-check";
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => toggleTaskDone(task));
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
// of whatever it's adding to. Shares styling with windows.js's makeBucketAddIcon.
function makeAddIcon(title, ariaLabel, onAdd) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon window-bucket-add";
  btn.innerHTML = ICONS.plus;
  btn.title = title;
  btn.setAttribute("aria-label", ariaLabel);
  btn.addEventListener("click", onAdd);
  return btn;
}

function renderCategoryTabs() {
  const nav = document.getElementById("folder-tabs");
  nav.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "folder-tab" + (activeCategoryFilter === "all" ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeCategoryFilter = "all";
    render();
  });
  nav.appendChild(allBtn);

  categories.forEach(category => {
    const btn = document.createElement("button");
    btn.className = "folder-tab" + (activeCategoryFilter === category.id ? " active" : "");
    btn.textContent = category.name;
    btn.addEventListener("click", () => {
      activeCategoryFilter = category.id;
      render();
    });
    nav.appendChild(btn);
  });

  nav.appendChild(makeAddIcon("Add a category", "Add category", openCategoryModal));
}

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

  container.appendChild(makeAddIcon("Add a folder", "Add folder", openFolderModal));
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
  const assessment = task.status === "active" ? assessTask(task, settings, today) : null;
  if (assessment) {
    row.classList.add("quadrant-" + assessment.quadrant.key);
    row.style.setProperty("--p", assessment.intensity.toFixed(3));
    makeTaskDraggable(row, task); // into the Now window (see windows.js)
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

  const addSub = document.createElement("button");
  addSub.type = "button";
  addSub.className = "link-btn add-subtask-row";
  addSub.textContent = "+";
  addSub.title = "Add subtask";
  addSub.setAttribute("aria-label", "Add subtask to " + task.title);
  addSub.addEventListener("click", () => openTaskModal({ folder_id: task.folder_id, parent_task_id: task.id }));
  main.appendChild(addSub);

  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "task-actions";

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
  const doneCount = items.filter(isRecurringDoneNow).length;

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

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = folder.name;
  header.appendChild(name);

  const count = document.createElement("span");
  count.className = "folder-count";
  const done = folderItems.filter(isRecurringDoneNow).length;
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

function renderRecurringRow(rt) {
  const li = document.createElement("li");

  const row = document.createElement("div");
  const done = isRecurringDoneNow(rt);
  row.className = "task-row" + (done ? " done" : "");

  const spacer = document.createElement("span");
  spacer.className = "task-caret-spacer";
  row.appendChild(spacer);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = done;
  checkbox.addEventListener("change", () => toggleRecurringTask(rt));
  row.appendChild(checkbox);

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

function toggleTaskDone(task) {
  if (task.status === "done") {
    task.status = "active";
    task.completed_at = null;
  } else {
    task.status = "done";
    task.completed_at = new Date().toISOString();
  }
  task.last_touched_at = new Date().toISOString();
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

// `prefillOrTask` is either an existing task (edit) or a prefill object for a new one:
// folder_id / parent_task_id as before, plus optional deadline / do_date / importance /
// is_quick_win (the Now window's "+ Add to Now" uses these).
function openTaskModal(prefillOrTask) {
  const isEdit = tasks.some(t => t.id === prefillOrTask.id);
  document.getElementById("task-modal-title").textContent = isEdit ? "Edit Task" : "Add Task";

  populateFolderSelectInto(taskFolderSelect, prefillOrTask.folder_id);
  populateParentSelect(prefillOrTask.folder_id, isEdit ? prefillOrTask.id : null, prefillOrTask.parent_task_id);

  document.getElementById("task-id").value = isEdit ? prefillOrTask.id : "";
  document.getElementById("task-title").value = isEdit ? prefillOrTask.title : "";
  document.getElementById("task-notes").value = isEdit ? prefillOrTask.notes : "";
  document.getElementById("task-deadline").value = prefillOrTask.deadline || "";
  document.getElementById("task-do-date").value = prefillOrTask.do_date || "";
  document.getElementById("task-importance").value = prefillOrTask.importance || "Low";
  // Bite-size is the universal default for a new task; an edit shows the task's own value.
  setSizeToggle(prefillOrTask.is_quick_win === undefined ? true : !!prefillOrTask.is_quick_win);
  renderWeekPicker();
  taskError.textContent = "";

  taskFolderSelect.value = prefillOrTask.folder_id || folders[0]?.id || "";
  taskParentSelect.value = prefillOrTask.parent_task_id || "";

  taskModal.classList.remove("hidden");
  document.getElementById("task-title").focus();
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  taskForm.reset();
  taskError.textContent = "";
}

function populateFolderSelectInto(selectEl, selectedId) {
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
  const currentId = document.getElementById("task-id").value || null;
  populateParentSelect(taskFolderSelect.value, currentId, null);
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

  const existing = id ? tasks.find(t => t.id === id) : null;
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
  // a do_date without a deadline would roll forward silently forever with nothing else eventually
  // forcing it to surface; a High/Critical task would otherwise sit dateless in Plan. Assess the
  // second case as the task would actually be saved (last_touched_at reset, staleness at zero).
  const candidate = Object.assign({}, existing || makeTask({}), data, { last_touched_at: now, status: "active" });
  const opts = (data.do_date && !data.deadline) ? NOW_DEADLINE_PROMPT
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

function populateFolderCategorySelect(selectedId) {
  folderCategorySelect.innerHTML = "";
  categories.forEach(category => {
    const opt = document.createElement("option");
    opt.value = category.id;
    opt.textContent = category.name;
    folderCategorySelect.appendChild(opt);
  });
  if (selectedId) folderCategorySelect.value = selectedId;
}

function openFolderModal() {
  if (categories.length === 0) {
    alert("Add a category first.");
    return;
  }
  folderForm.reset();
  const defaultCategoryId = activeCategoryFilter !== "all" ? activeCategoryFilter : categories[0].id;
  populateFolderCategorySelect(defaultCategoryId);
  folderModal.classList.remove("hidden");
  document.getElementById("folder-name").focus();
}

function closeFolderModal() {
  folderModal.classList.add("hidden");
}

folderForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("folder-name").value.trim();
  const categoryId = folderCategorySelect.value;
  if (!name || !categoryId) return;
  folders.push({ id: makeId(), category_id: categoryId, name });
  closeFolderModal();
  persist();
  render();
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

function openCategoryModal() {
  categoryForm.reset();
  categoryModal.classList.remove("hidden");
  document.getElementById("category-name").focus();
}

function closeCategoryModal() {
  categoryModal.classList.add("hidden");
}

categoryForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("category-name").value.trim();
  if (!name) return;
  const category = { id: makeId(), name };
  categories.push(category);
  activeCategoryFilter = category.id;
  closeCategoryModal();
  persist();
  render();
});

document.getElementById("category-cancel-btn").addEventListener("click", closeCategoryModal);
categoryModal.addEventListener("click", e => {
  if (e.target === categoryModal) closeCategoryModal();
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

// ---------- Theme toggle ----------

const themeToggleBtn = document.getElementById("theme-toggle-btn");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyThemeIcon() {
  themeToggleBtn.innerHTML = currentTheme() === "dark" ? ICONS.sun : ICONS.moon;
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  applyThemeIcon();
});

applyThemeIcon();
document.getElementById("settings-btn").innerHTML = ICONS.gear;

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

// ---------- Quick capture ----------
// Frictionless add, sort later: one field, no modal, no required folder pick. A bare title
// lands in an auto-created Inbox folder; optional mechanical tags (same vocabulary as the
// spec's Bulk Import) route or date it on the way in instead. Importance defaults to Low, so
// the deadline requirement never blocks a capture — sorting it into a real quadrant is exactly
// the follow-up work this feature intentionally defers.

const quickCaptureIconBtn = document.getElementById("quick-capture-icon-btn");
const quickCaptureForm = document.getElementById("quick-capture-form");
const quickCaptureInput = document.getElementById("quick-capture-input");

const QUICK_CAPTURE_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// "today" / "tomorrow" / a weekday name (full or 3-letter, next occurrence, today doesn't
// count) / a literal "YYYY-MM-DD". Returns null for anything else, left in the title as-is.
function parseQuickCaptureDate(token) {
  const word = token.toLowerCase();
  if (word === "today") return todayISODate();
  if (word === "tomorrow") return addDaysISODate(todayISODate(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const weekday = QUICK_CAPTURE_WEEKDAYS.findIndex(name => name === word || name.slice(0, 3) === word);
  if (weekday === -1) return null;
  const diff = (weekday - new Date().getDay() + 7) % 7;
  return addDaysISODate(todayISODate(), diff === 0 ? 7 : diff);
}

// Auto-created once, then reused: a dedicated landing spot so an untagged capture never has
// to block on "which folder", the whole point of this being frictionless.
function ensureInboxFolder() {
  let category = categories.find(c => c.name.toLowerCase() === "inbox");
  if (!category) {
    category = { id: makeId(), name: "Inbox" };
    categories.push(category);
  }
  let folder = folders.find(f => f.category_id === category.id && f.name.toLowerCase() === "inbox");
  if (!folder) {
    folder = { id: makeId(), category_id: category.id, name: "Inbox" };
    folders.push(folder);
  }
  return folder;
}

// Strips #folder / @date / a standalone ! out of the raw text; whatever's left, trimmed, is
// the title. Each tag is optional and independent, same as the Bulk Import spec's line format.
function parseQuickCapture(raw) {
  let title = raw;
  let folder = null;
  let deadline = null;

  title = title.replace(/#(\S+)/, (match, name) => {
    const found = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (found) folder = found;
    return "";
  });

  title = title.replace(/@(\S+)/, (match, token) => {
    const parsed = parseQuickCaptureDate(token);
    if (parsed) deadline = parsed;
    return parsed ? "" : match;
  });

  title = title.replace(/(^|\s)!(?=\s|$)/, (match, before) => {
    deadline = todayISODate();
    return before;
  });

  return { title: title.replace(/\s+/g, " ").trim(), folder, deadline };
}

function flashQuickCapture() {
  quickCaptureInput.classList.remove("quick-capture-flash");
  void quickCaptureInput.offsetWidth; // restart the animation on back-to-back captures
  quickCaptureInput.classList.add("quick-capture-flash");
}

// Collapsed to just the icon by default — expanding is the one deliberate action; collapsing
// back happens on its own (Esc, or losing focus to anything outside the form) so it never
// sits open once you're done with it.
function expandQuickCapture() {
  quickCaptureIconBtn.hidden = true;
  quickCaptureForm.hidden = false;
  quickCaptureInput.focus();
  quickCaptureInput.select();
}

function collapseQuickCapture() {
  quickCaptureForm.hidden = true;
  quickCaptureIconBtn.hidden = false;
  quickCaptureInput.value = "";
}

function isQuickCaptureExpanded() {
  return !quickCaptureForm.hidden;
}

quickCaptureIconBtn.addEventListener("click", expandQuickCapture);

// focusout (unlike blur) reports what's about to gain focus via relatedTarget, so a click on
// the form's own submit button doesn't get mistaken for "clicked elsewhere" and collapse out
// from under the click. Anything else — clicking the page background, another button, another
// field — has a relatedTarget outside the form (or none at all), and that's a real "done here."
quickCaptureForm.addEventListener("focusout", e => {
  if (!quickCaptureForm.contains(e.relatedTarget)) collapseQuickCapture();
});

// Belt-and-suspenders alongside the form's own implicit Enter-submits-a-single-field
// behavior: some IME/autofill/extension setups swallow that native path, and this is the
// one interaction the whole feature hinges on working every time.
quickCaptureInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    quickCaptureForm.requestSubmit();
  }
});

quickCaptureForm.addEventListener("submit", e => {
  e.preventDefault();
  const raw = quickCaptureInput.value;
  if (!raw.trim()) return;

  const { title, folder, deadline } = parseQuickCapture(raw);
  if (!title) { quickCaptureInput.value = ""; return; }

  const data = { folder_id: (folder || ensureInboxFolder()).id, title, deadline };
  applyDeadlineDefault(data);
  tasks.push(makeTask(data));

  quickCaptureInput.value = "";
  persist();
  render();
  flashQuickCapture();
  quickCaptureInput.focus(); // stays put (and stays expanded) so a run of captures needs no re-click
});

// ---------- Keyboard shortcuts ----------
// A short, deliberate set: jump to Quick add, switch views, toggle Focus mode, and a cheat
// sheet so they stay discoverable. Suppressed while typing anywhere (any field, including
// Quick add itself) or when a modifier key is held, so browser/OS shortcuts are never shadowed
// — Esc is the one exception, since backing out of whatever's open should always work.

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
// markup comment), so Esc must not open one either.
function closeTopModal() {
  if (!taskModal.classList.contains("hidden")) return closeTaskModal();
  if (!folderModal.classList.contains("hidden")) return closeFolderModal();
  if (!recurringModal.classList.contains("hidden")) return closeRecurringModal();
  if (!categoryModal.classList.contains("hidden")) return closeCategoryModal();
  if (!settingsModal.classList.contains("hidden")) return closeSettingsModal();
  if (!shortcutsModal.classList.contains("hidden")) return closeShortcutsModal();
  if (!nowDeadlineModal.classList.contains("hidden")) return settleDeadlinePrompt(null);
}

function anyModalOpen() {
  return [taskModal, folderModal, recurringModal, categoryModal, settingsModal, shortcutsModal, nowDeadlineModal]
    .some(modal => !modal.classList.contains("hidden"));
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (anyModalOpen()) { closeTopModal(); return; }
    // Blurring (rather than collapsing directly) routes through the same focusout listener
    // a click-elsewhere would use, so there's exactly one place that decides "done here."
    if (isQuickCaptureExpanded()) quickCaptureInput.blur();
    return; // Focus mode's own Esc handling lives in windows.js
  }

  if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || anyModalOpen()) return;

  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    expandQuickCapture();
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
