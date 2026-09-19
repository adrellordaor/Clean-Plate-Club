// Now / Later windows: the two side-by-side "intention" panels at the top of the List view.
//
//   Now   — membership is a LIVE UNION, checked on every render with no stored write behind
//           it: do_date == today (what you told yourself to do) OR the task's live quadrant is
//           Do or Clear (genuinely urgent, whatever do_date says). See isNowMember in
//           urgency.js. A do_date of today also floors the task's urgency
//           (do_today_urgency_floor), which is what moves a merely-planned task into Do or
//           Clear rather than just making it look more urgent.
//   Later — the long-view counterpart: every active task whose live quadrant is Plan or
//           Backlog. A plain quadrant rule with no special case, because leaving Now is always
//           a real underlying change (see deprioritize below), never an override.
//
// Escalating tag (Do Today < Due Today < Overdue, one slot, most severe wins): every card
// carries it, the same badge list rows and the Overview use (escalatingTag in urgency.js).
// Expanded Now cards add a "Due in N" countdown while a deadline is approaching (1..
// deadline_high_days out); at 0 the tag takes over, so the two never show together.
//
// Sorting: one GLOBAL sort key and one global flat / by-folder grouping, shared by both
// windows (changing either in one place changes both). The dropdown offers Priority
// (default), Urgency, Importance, Size, Do date. Sort keys with a real, non-arbitrary split
// render as BUCKETS (bucketWindowEntries): Importance into its four levels, Size into
// Bite-size / Main Course, Do date and Urgency into Today / Tomorrow / Later dates — but only
// in Now; in Later, Do date keeps its with-date / without-date split and Urgency stays flat,
// like Priority everywhere. Each bucket is a drop zone that makes the task genuinely belong
// there (do_date, deadline, importance or sizing updated, never bypassing a rule that would
// otherwise block the change), and carries its own "+" that pre-fills the form to match.
//
// Habits (RecurringTasks) in the windows: Now shows the ones due soon (isRecurringNowMember —
// daily always, weekly/monthly on their day or near their period's end), Later the exact
// complement (isRecurringLaterMember), so every habit is in exactly one window. In Do date and
// Size sorts they sit inside the buckets (a habit has a real next day, and counts as
// Bite-size for placement only); in the score-based sorts they stay in their own block, since
// they never join the scoring. Never draggable, no tag, no importance — the same isolation
// from the matrix as always. Ticking one off logs to CompletionLog exactly as the boxes do.
//
// Compact vs. expanded cards: at default width a card is checkbox + title + tag. Expanded,
// a card also shows the meta line (never on Bite-size cards — small by definition), the
// sizing chip, and in Later an inline do_date input (with a guard rail against planning a
// task after its deadline). Now shows the countdown instead of any editable date.
//
// Completing a task: the card strikes through at once and, after a short grace period, the
// task moves into Now's collapsed "Completed Today" folder (completed_at == today — no new
// storage), where it stays for the rest of the day as evidence. There is exactly one such
// folder, in Now; a task completed from Later lands there too.
//
// Nested subtasks: a card shows its subtasks underneath, collapsible with the same caret and
// the same shared collapsed set (collapsedTasks) as the folder list.
//
// Focus mode (Now only): an on-demand overlay over the page showing just the do_date == today
// subset of Now, same cards, same drag mechanics (drop on the dimmed backdrop = deprioritize).
//
// Empty-Now suggestion: whenever Now has zero tasks (live-checked every render), Later boxes
// its top 3 by priority with an "Add all N" button chaining addToNow. No state to clear.
//
// Per-device prefs (sort, grouping, which window is expanded) live in localStorage like the
// theme. Reads app.js state (tasks, folders, recurringTasks, settings, activeView,
// todayISODate, persist, render, openTaskModal, toggleTaskDone, defaultNowDeadline,
// applyDeadlineDefault, isDeadlineViolator, showBackfillIfNeeded, appendTagBadge,
// appendRolloverBadge, appendMissedBadge, recurringScheduleLabel, ICONS), calendar.js
// (addDaysISODate) and overview.js (rankActiveTasks, taskContextLabel) only from inside
// functions that run after every script has loaded.

const WINDOW_SORT_KEYS = [
  { key: "priority", label: "Priority" },
  { key: "urgency", label: "Urgency" },
  { key: "importance", label: "Importance" },
  { key: "size", label: "Size" },
  { key: "dodate", label: "Do date" },
];

const WINDOW_GROUP_MODES = [
  { key: "flat", label: "Flat" },
  { key: "folder", label: "Folder" },
];

const WINDOW_PREFS_KEY = "windowPrefs";
const DEFAULT_WINDOW_PREFS = Object.freeze({
  focus: "none",     // "none" | "now" | "later" — which window is expanded
  sort: "priority",  // one shared sort key for both windows
  group: "flat",     // one shared flat / by-folder grouping for both windows
});

const DONE_GRACE_MS = 700; // strikethrough-then-move delay on completing a card

let windowPrefs = loadWindowPrefs();
let focusModeOpen = false;        // transient, never persisted
let completedTodayOpen = false;   // the Completed Today folder, collapsed by default
const pendingDone = new Map();    // taskId -> timeout, while a checked card waits out its grace period

// Older prefs stored a sort/grouping per window (nowSort / laterSort ...); the Now value
// carries over as the shared one. The old "quickwin" sort key is now "size".
function loadWindowPrefs() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(WINDOW_PREFS_KEY) || "{}") || {}; } catch (e) { raw = {}; }
  const sortKeys = WINDOW_SORT_KEYS.map(s => s.key);
  const groupKeys = WINDOW_GROUP_MODES.map(g => g.key);
  let sort = raw.sort !== undefined ? raw.sort : raw.nowSort;
  if (sort === "quickwin") sort = "size";
  const group = raw.group !== undefined ? raw.group : raw.nowGroup;
  return {
    focus: ["none", "now", "later"].includes(raw.focus) ? raw.focus : DEFAULT_WINDOW_PREFS.focus,
    sort: sortKeys.includes(sort) ? sort : DEFAULT_WINDOW_PREFS.sort,
    group: groupKeys.includes(group) ? group : DEFAULT_WINDOW_PREFS.group,
  };
}

function setWindowPref(key, value) {
  if (windowPrefs[key] === value) return;
  windowPrefs[key] = value;
  try { localStorage.setItem(WINDOW_PREFS_KEY, JSON.stringify(windowPrefs)); } catch (e) { /* private mode etc. */ }
  render();
}

// ---------- Ordering (pure) ----------

// null sorts after every real date; equal strings compare equal.
function compareDoDates(a, b) {
  const x = a || null;
  const y = b || null;
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x < y ? -1 : 1;
}

// `entries` are { task, assessment } (from rankActiveTasks). Every key falls back to
// priority_score, so the order is stable: "Size" puts Bite-size first, "Do date" runs
// chronologically ascending (no date last), each with priority as the tiebreak inside a group.
function sortWindowEntries(entries, key) {
  const byPriority = (a, b) => b.assessment.priorityScore - a.assessment.priorityScore;
  const sorted = entries.slice();
  if (key === "urgency") {
    sorted.sort((a, b) => b.assessment.urgency.score - a.assessment.urgency.score || byPriority(a, b));
  } else if (key === "importance") {
    sorted.sort((a, b) => b.assessment.importanceScore - a.assessment.importanceScore || byPriority(a, b));
  } else if (key === "size") {
    sorted.sort((a, b) => Number(!!b.task.is_quick_win) - Number(!!a.task.is_quick_win) || byPriority(a, b));
  } else if (key === "dodate") {
    sorted.sort((a, b) => compareDoDates(a.task.do_date, b.task.do_date) || byPriority(a, b));
  } else {
    sorted.sort(byPriority);
  }
  return sorted;
}

// Do date and Size are the sorts where a habit has a natural place (a real next day; small
// by nature). The score-based sorts keep habits in their own block.
function bucketsTakeHabits(sortKey) {
  return sortKey === "dodate" || sortKey === "size";
}

// Do Date sort's "Today" bucket for Now, and Focus mode's visible set: the same "do_date is
// today (or already passed)" definition, extracted once so both draw from one underlying
// function rather than two independently-written filters (the visible task set is meant to be
// identical, only the presentation differs).
function isDoDateTodayEntry(entry, today) {
  return !!entry.task.do_date && entry.task.do_date <= today;
}
function isDoDateTodayHabit(rt, today) {
  return nextRecurringOccurrence(rt, today) <= today;
}

// The bucket layout for a sort key, or null for a flat list. `entries` must already be in
// sort order (bucket contents keep it). Each bucket:
//   { key, label, hint, entries, habits, drop(task) | null, addPrefill | null }
// drop makes a dropped task genuinely belong (through the same setters the inline edits use,
// so every rule — deadline prompt, deadline requirement, guard rail — still applies);
// addPrefill is what that bucket's "+" hands the task form.
function bucketWindowEntries(entries, sortKey, winKey, today, habits) {
  const isNow = winKey === "now";
  const tomorrow = addDaysISODate(today, 1);
  const later = addDaysISODate(today, 2);
  const allHabits = habits || [];
  const make = (key, label, hint, filter, drop, addPrefill, habitFilter) => ({
    key, label, hint,
    entries: entries.filter(filter),
    habits: habitFilter ? allHabits.filter(habitFilter) : [],
    drop, addPrefill,
  });

  if (sortKey === "importance") {
    return ["Critical", "High", "Medium", "Low"].map(level => make(
      level.toLowerCase(), level, "Importance " + level,
      e => e.task.importance === level,
      task => inlineSetImportance(task, level),
      { importance: level },
      null,
    ));
  }

  if (sortKey === "size") {
    return [
      make("bite", "Bite-size", "Quick ones (habits count as bite-size here)",
        e => !!e.task.is_quick_win, task => setQuickWin(task, true), { is_quick_win: true }, () => true),
      make("main", "Everything else", "Not marked Bite-size",
        e => !e.task.is_quick_win, task => setQuickWin(task, false), { is_quick_win: false }, null),
    ];
  }

  if (sortKey === "dodate") {
    if (!isNow) {
      return [
        make("with", "With date", "Planned for a day (habits always have one)",
          e => !!e.task.do_date,
          task => { if (!task.do_date) setDoDateExplicit(task, tomorrow); },
          { do_date: tomorrow }, () => true),
        make("without", "No date", "Not planned for any day yet",
          e => !e.task.do_date, task => clearDoDate(task), {}, null),
      ];
    }
    const next = rt => nextRecurringOccurrence(rt, today);
    return [
      make("today", "Today", "do_date is today",
        e => isDoDateTodayEntry(e, today),
        task => addToNow(task, { manual: true }),
        { do_date: today, deadline: today }, rt => isDoDateTodayHabit(rt, today)),
      make("tomorrow", "Tomorrow", "do_date is tomorrow",
        e => e.task.do_date === tomorrow,
        task => setDoDateExplicit(task, tomorrow),
        { do_date: tomorrow, deadline: tomorrow }, rt => next(rt) === tomorrow),
      make("later", "Later dates", "do_date from the day after tomorrow on (or none: here through urgency alone)",
        e => !e.task.do_date || e.task.do_date >= later,
        task => setDoDateExplicit(task, later),
        { do_date: later, deadline: later }, rt => next(rt) >= later),
    ];
  }

  // Urgency stays flat in both windows: once the deadline requirement tightened, do_date
  // reliably mirrors deadline, so a Today/Tomorrow/Later split here would nearly duplicate
  // Do Date's own bucketing rather than showing anything genuinely different.
  return null;
}

const WINDOWS = {
  now: {
    key: "now", elementId: "now-window", title: "Daily Plate", hint: "do today · Do · Clear",
    member: (entry, today) => isNowMember(entry.task, entry.assessment, today),
    habitMember: (rt, today) => isRecurringNowMember(rt, settings, today),
    habitHint: "daily · weekly · monthly due soon",
    empty: "Nothing urgent or planned for today. Drag a task here, or add one.",
    add: () => addTaskToNowDirectly(),
  },
  later: {
    key: "later", elementId: "later-window", title: "Fridge", hint: "Plan + Backlog",
    member: entry => isLaterMember(entry.assessment),
    habitMember: (rt, today) => isRecurringLaterMember(rt, settings, today),
    habitHint: "weekly · monthly, not due soon",
    empty: "Nothing in Plan or Backlog.",
    add: () => addTaskToLaterDirectly(),
  },
};

// ---------- Rendering ----------

function renderNowLaterWindows() {
  if (activeView !== "list" || listDisplayMode !== "windows") {
    renderFocusOverlay(null, null); // hides the overlay if a view/mode switch happened under it
    return;
  }
  const today = todayISODate();
  const ranked = rankActiveTasks(today);

  // The shared sort dropdown and grouping switch for both windows sit above them, side by
  // side — one shared value each, not something that needs its own copy per window.
  const toolbar = document.getElementById("windows-toolbar");
  toolbar.innerHTML = "";
  toolbar.appendChild(makeWindowSortSelect(WINDOW_SORT_KEYS, windowPrefs.sort, key => setWindowPref("sort", key), "Sort (both windows)"));
  toolbar.appendChild(makeWindowSwitch(WINDOW_GROUP_MODES, windowPrefs.group, key => setWindowPref("group", key), "Window grouping"));

  const row = document.getElementById("windows-row");
  row.classList.toggle("focus-now", windowPrefs.focus === "now");
  row.classList.toggle("focus-later", windowPrefs.focus === "later");

  const nowIsEmpty = !ranked.some(entry => WINDOWS.now.member(entry, today));

  renderWindow(WINDOWS.now, ranked, today);
  renderWindow(WINDOWS.later, ranked, today, nowIsEmpty);
  renderFocusOverlay(ranked, today);
}

// ---------- Pile-size indicator (fire / ice particles) ----------
// Replaces the plain count badge with the same number wrapped in a small particle effect —
// flame for Daily Plate, ice for Fridge — whose density/speed scale with how full the window
// is relative to a per-window cap (just a feel threshold, not a real limit on either window).
const PILE_FULLNESS_CAP = { now: 6, later: 14 };

// Particle params persist across renders, keyed by window and regenerated only when `count`
// itself changes (a task genuinely added/removed) — render() fires on nearly every interaction,
// and without this cache the particles would reshuffle on any click, not just a real change.
const pileParticleCache = {};

function renderPileIndicator(win, count) {
  const cap = PILE_FULLNESS_CAP[win.key] || 10;
  const fullness = Math.max(0, Math.min(1, count / cap));

  const wrap = document.createElement("span");
  wrap.className = "pile-indicator " + (win.key === "now" ? "pile-fire" : "pile-ice");
  wrap.style.setProperty("--fullness", fullness.toFixed(3));

  const particles = document.createElement("span");
  particles.className = "pile-particles";
  particles.setAttribute("aria-hidden", "true");
  const particleCount = count > 0 ? Math.round(2 + fullness * 5) : 0; // 2..7, none when empty

  const cached = pileParticleCache[win.key];
  let params;
  if (cached && cached.count === count) {
    params = cached.params;
  } else {
    params = [];
    for (let i = 0; i < particleCount; i++) {
      params.push({
        size: 3 + Math.random() * 3 * (0.6 + fullness),
        left: 8 + Math.random() * 84,
        duration: (1 + Math.random() * 0.9) / (0.4 + fullness),
        delay: Math.random() * 1.4,
        dx: Math.random() * 14 - 7,
        spin: 140 + Math.random() * 160,
      });
    }
    pileParticleCache[win.key] = { count, params };
  }

  params.forEach(param => {
    const p = document.createElement("span");
    p.className = "pile-particle";
    p.style.width = param.size + "px";
    p.style.height = param.size + "px";
    p.style.left = param.left + "%";
    p.style.animationDuration = param.duration.toFixed(2) + "s";
    p.style.animationDelay = param.delay.toFixed(2) + "s";
    if (win.key === "later") {
      p.style.setProperty("--dx", param.dx.toFixed(1) + "px");
      p.style.setProperty("--spin", param.spin.toFixed(0) + "deg"); // tumble, not a fixed spin
    }
    particles.appendChild(p);
  });
  wrap.appendChild(particles);

  const countEl = document.createElement("span");
  countEl.className = "window-count";
  countEl.textContent = count; // every active member, nested ones included; never habits or done tasks
  wrap.appendChild(countEl);

  return wrap;
}

function renderWindow(win, ranked, today, nowIsEmpty) {
  const el = document.getElementById(win.elementId);
  el.innerHTML = "";
  const expanded = windowPrefs.focus === win.key;
  el.classList.toggle("window-focused", expanded);

  const unsorted = ranked.filter(entry => win.member(entry, today));
  // Members nested under a member parent render inside that parent's card, not as their own.
  let entries = topLevelEntries(sortWindowEntries(unsorted, windowPrefs.sort));
  // Every habit currently due in this window, regardless of whether the active sort mode
  // buckets them in or keeps them in the standalone Habits block below — the header count
  // reflects the true size of what's showing, RecurringTasks included.
  const habitsDue = windowHabits(win, today);

  const toggleExpand = () => setWindowPref("focus", expanded ? "none" : win.key);

  // Header: expand/focus icon (plate/fridge), title, pile-size indicator, hint, focus mode
  // (Now only), expand/shrink. Clicking non-interactive space anywhere in the window (not
  // just the header) triggers this same toggle — see wireWindowExpandClick, wired once on
  // `el` itself further down, not re-attached per render.
  const header = document.createElement("div");
  header.className = "window-header";

  // The plate/fridge icon doubles as the expand/shrink control. State (expanded or not) shows
  // through the icon's own content — food on the plate, the fridge door open — and its fill,
  // same pattern as the Bite-size toggle: no text change, just appearance.
  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "btn-icon window-focus-btn window-focus-icon-" + win.key + (expanded ? " active" : "");
  focusBtn.innerHTML = win.key === "now" ? plateIcon(expanded) : fridgeIcon(expanded);
  focusBtn.title = expanded ? "Shrink: back to equal widths" : "Expand: give this window more room and show details";
  focusBtn.setAttribute("aria-label", expanded ? "Shrink " + win.title : "Expand " + win.title);
  focusBtn.addEventListener("click", toggleExpand);
  header.appendChild(focusBtn);

  const title = document.createElement("h2");
  title.className = "window-title";
  title.textContent = win.title;
  header.appendChild(title);

  // Pile-size indicator: the count badge (regular tasks + due habits) wrapped in a fire
  // (Daily Plate) or ice (Fridge) particle effect that scales with how full the window is,
  // instead of a static number.
  header.appendChild(renderPileIndicator(win, unsorted.length + habitsDue.length));

  const hint = document.createElement("span");
  hint.className = "window-hint";
  hint.textContent = win.hint;
  header.appendChild(hint);

  if (win.key === "now") {
    const focusModeBtn = document.createElement("button");
    focusModeBtn.type = "button";
    focusModeBtn.className = "btn-icon window-focusmode-btn";
    focusModeBtn.innerHTML = ICONS.focus;
    focusModeBtn.title = "Focus: only what's planned for today";
    focusModeBtn.setAttribute("aria-label", "Focus mode");
    focusModeBtn.addEventListener("click", openFocusMode);
    header.appendChild(focusModeBtn);
  }

  el.appendChild(header);

  // Controls: just the plain global "+" on the right — no bucket defaults, for when none of
  // the per-bucket pre-fills is what you want. The sort dropdown lives in the shared toolbar
  // now, alongside the flat/folder grouping switch, not duplicated per window.
  const controls = document.createElement("div");
  controls.className = "window-controls";
  const addIcon = document.createElement("button");
  addIcon.type = "button";
  addIcon.className = "btn-icon window-add-icon";
  addIcon.innerHTML = ICONS.plus;
  addIcon.title = win.key === "now" ? "Add a task to Daily Plate (do date today)" : "Add a task";
  addIcon.setAttribute("aria-label", "Add task to " + win.title);
  addIcon.addEventListener("click", win.add);
  controls.appendChild(addIcon);
  el.appendChild(controls);

  // Empty-Now suggestion (Later only, live-checked every render — see file header). The
  // suggested 3 are highlighted in place, not duplicated: pull them out of the entries the
  // body renders below so each one shows exactly once.
  if (win.key === "later" && nowIsEmpty) {
    const suggested = sortWindowEntries(unsorted, "priority").slice(0, 3);
    if (suggested.length) {
      el.appendChild(renderSuggestionBox(suggested, expanded));
      const suggestedIds = new Set(suggested.map(entry => entry.task.id));
      entries = entries.filter(entry => !suggestedIds.has(entry.task.id));
    }
  }

  el.appendChild(renderWindowBody(win, entries, today, expanded));

  if (win.key === "now") {
    const completed = renderCompletedToday(today);
    if (completed) el.appendChild(completed);
  }

  if (!bucketsTakeHabits(windowPrefs.sort)) {
    const habits = renderWindowHabits(win, today);
    if (habits) el.appendChild(habits);
  }
}

// Drops every entry whose parent is itself in `entries` — those render nested under the
// parent's card (renderCardSubtasks) instead. Order is preserved.
function topLevelEntries(entries) {
  const ids = new Set(entries.map(e => e.task.id));
  return entries.filter(e => !e.task.parent_task_id || !ids.has(e.task.parent_task_id));
}

// ---------- Habits in the windows ----------
// The same RecurringTasks the habit boxes show, split between the windows by schedule
// (see file header). Undone first, then by next occurrence, then daily < weekly < monthly.
// Done ones stay visible and ticked (like the boxes) so a mis-click can be undone here too.

const CADENCE_ORDER = Object.freeze({ daily: 0, weekly: 1, monthly: 2 });

function windowHabits(win, today) {
  const due = recurringTasks.filter(rt => win.habitMember(rt, today));
  const cadenceOrder = rt => (CADENCE_ORDER[rt.cadence] !== undefined ? CADENCE_ORDER[rt.cadence] : 3);
  due.sort((a, b) => Number(isRecurringDoneNow(a)) - Number(isRecurringDoneNow(b))
    || compareDoDates(nextRecurringOccurrence(a, today), nextRecurringOccurrence(b, today))
    || cadenceOrder(a) - cadenceOrder(b));
  return due;
}

// The standalone Habits block (score-based sorts). Returns null when the window has no
// habit, so it stays clean.
function renderWindowHabits(win, today) {
  const due = windowHabits(win, today);
  if (due.length === 0) return null;
  const doneCount = due.filter(isRecurringDoneNow).length;

  const block = document.createElement("div");
  block.className = "window-habits";

  const header = document.createElement("div");
  header.className = "window-habits-header";

  const title = document.createElement("span");
  title.className = "window-habits-title";
  title.textContent = "Habits";
  header.appendChild(title);

  const fraction = document.createElement("span");
  fraction.className = "window-habits-fraction";
  fraction.textContent = doneCount + "/" + due.length;
  header.appendChild(fraction);

  const hint = document.createElement("span");
  hint.className = "window-hint";
  hint.textContent = win.habitHint;
  hint.title = win.key === "now"
    ? "Daily habits every day; weekly ones on their weekday or within " + settings.weekly_recurring_now_days + " day(s) of the week ending; monthly ones on their day or within " + settings.monthly_recurring_now_days + " day(s) of the month ending. Not scored."
    : "Weekly and monthly habits that aren't due soon — the exact complement of Now's. Not scored.";
  header.appendChild(hint);

  block.appendChild(header);

  const list = document.createElement("div");
  list.className = "window-habits-list";
  due.forEach(rt => list.appendChild(renderWindowHabitRow(rt, today)));
  block.appendChild(list);
  return block;
}

// One habit row: checkbox, title, missed flag, "folder · schedule". Deliberately not
// draggable — a habit's day is fixed or deliberately left at the default, never rescheduled.
function renderWindowHabitRow(rt, today) {
  const done = isRecurringDoneNow(rt);
  const row = document.createElement("label");
  row.className = "window-habit habit-" + rt.cadence + (done ? " done" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = done;
  checkbox.setAttribute("aria-label", (done ? "Undo " : "Complete ") + rt.title);
  checkbox.addEventListener("change", () => toggleRecurringTask(rt));
  row.appendChild(checkbox);

  const title = document.createElement("span");
  title.className = "window-habit-title";
  title.textContent = rt.title;
  row.appendChild(title);

  appendMissedBadge(row, rt);

  const folder = folders.find(f => f.id === rt.folder_id);
  const meta = document.createElement("span");
  meta.className = "window-habit-meta";
  const schedule = recurringScheduleLabel(rt) || "daily";
  const next = nextRecurringOccurrence(rt, today);
  meta.textContent = [folder ? folder.name : null, schedule].filter(Boolean).join(" · ");
  meta.title = rt.cadence === "daily" ? "Every day" : "Next: " + next;
  row.appendChild(meta);

  return row;
}

// ---------- Body: flat list or buckets ----------

function renderWindowBody(win, entries, today, expanded) {
  const body = document.createElement("div");
  body.className = "window-body";

  const habits = bucketsTakeHabits(windowPrefs.sort) ? windowHabits(win, today) : [];
  const buckets = bucketWindowEntries(entries, windowPrefs.sort, win.key, today, habits);

  if (!buckets) {
    if (entries.length === 0) body.appendChild(makeEmptyHint(win.empty, "window-empty"));
    else appendCards(body, entries, win, expanded);
    return body;
  }

  buckets.forEach((bucket, i) => {
    const zone = document.createElement("div");
    zone.className = "window-bucket";
    zone.dataset.bucket = bucket.key;
    zone.appendChild(makeBucketHeader(bucket.label, bucket.entries.length + bucket.habits.length, i === 0, bucket.hint));
    if (bucket.entries.length) appendCards(zone, bucket.entries, win, expanded, bucket.addPrefill);
    bucket.habits.forEach(rt => zone.appendChild(renderWindowHabitRow(rt, today)));
    if (!bucket.entries.length && !bucket.habits.length) {
      // One consistent empty-bucket message everywhere (whether or not the bucket takes a
      // drop) — four buckets all saying "Drop a card here." at once was just repetitive noise.
      zone.appendChild(makeEmptyHint("Nothing here.", "window-zone-empty"));
    }
    if (bucket.addPrefill) zone.appendChild(makeBucketAddIcon(bucket.label, () => addTaskFromBucket(bucket.addPrefill)));
    wireBucketDrop(zone, win, bucket);
    body.appendChild(zone);
  });
  return body;
}

// A bucket is a drop zone that makes the dropped task belong there. In Now, a card from
// anywhere is accepted: from outside Now it's first added to Now (the usual manual add, with
// its deadline prompt), then reclassified; from inside, just reclassified. Later's buckets
// only accept Later's own cards — a Now card dropped anywhere on Later still hits the window
// zone and deprioritizes, as before.
function wireBucketDrop(zone, win, bucket) {
  if (!bucket.drop) return;
  if (win.key === "now") {
    wireDropZone(zone, () => true, (task, source) => {
      if (source === "now") { bucket.drop(task); return; }
      addToNow(task, { manual: true }).then(added => { if (added) bucket.drop(task); });
    });
  } else {
    wireDropZone(zone, source => source === "later", task => bucket.drop(task));
  }
}

// Cards, nested inside folder groups when that toggle is on. A folder group is a bucket like
// any other here: same header component, same bottom "+" add icon, pre-filling that folder —
// plus whatever the enclosing bucket itself prefills (importance level, do_date/deadline,
// is_quick_win), so a folder group nested inside e.g. the Critical bucket still genuinely
// belongs there when added from its own "+", not just visually placed there.
function appendCards(container, entries, win, expanded, addPrefill) {
  if (windowPrefs.group === "folder") {
    groupEntriesByFolder(entries).forEach((group, i) => {
      container.appendChild(makeBucketHeader(group.name, group.entries.length, i === 0));
      group.entries.forEach(entry => container.appendChild(renderWindowCard(entry, win, expanded)));
      if (group.folderId) {
        container.appendChild(makeBucketAddIcon(group.name, () => addTaskFromBucket(Object.assign({}, addPrefill, { folder_id: group.folderId }))));
      }
    });
  } else {
    entries.forEach(entry => container.appendChild(renderWindowCard(entry, win, expanded)));
  }
}

// Bucket divider: just label · count. The bucket's own add control lives at the bottom of the
// bucket instead (makeBucketAddIcon), not up here.
function makeBucketHeader(label, count, first, hint) {
  const div = document.createElement("div");
  div.className = "window-bucket-header" + (first ? " window-bucket-header-first" : "");
  const text = document.createElement("span");
  text.className = "window-bucket-label";
  text.textContent = label + " · " + count;
  if (hint) text.title = hint;
  div.appendChild(text);
  return div;
}

// Bucket-bottom "+": below the last card in the bucket (or the empty hint, if it has none) —
// this is where the single generic "+ Add task" link used to sit at the bottom of the whole
// window, before bucketing existed; now every bucket gets its own, in that same spot, pre-
// filling whatever fields make an added task genuinely belong there. A plain icon rather than
// a text link, since it's tucked at the end of a list rather than standing on its own.
function makeBucketAddIcon(label, onAdd) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-icon window-bucket-add";
  btn.innerHTML = ICONS.plus;
  btn.title = "Add a task here (" + label + ")";
  btn.setAttribute("aria-label", "Add task to " + label);
  btn.addEventListener("click", onAdd);
  return btn;
}

function makeEmptyHint(text, extraClass) {
  const empty = document.createElement("div");
  empty.className = "empty-hint " + extraClass;
  empty.textContent = text;
  return empty;
}

function makeWindowSortSelect(options, active, onPick, label) {
  const select = document.createElement("select");
  select.className = "window-sort-select";
  select.setAttribute("aria-label", label);
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.key;
    option.textContent = opt.label;
    if (opt.key === active) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener("change", () => onPick(select.value));
  return select;
}

function makeWindowSwitch(options, active, onPick, label) {
  const wrap = document.createElement("div");
  wrap.className = "view-switch window-switch";
  wrap.setAttribute("role", "tablist");
  wrap.setAttribute("aria-label", label);
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-switch-btn" + (opt.key === active ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", opt.key === active ? "true" : "false");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => onPick(opt.key));
    wrap.appendChild(btn);
  });
  return wrap;
}

// Folder order follows the `folders` array (the same order the main list uses); anything
// whose folder no longer exists lands in a trailing "Unfiled" group.
function groupEntriesByFolder(entries) {
  const groups = [];
  folders.forEach(folder => {
    const inFolder = entries.filter(e => e.task.folder_id === folder.id);
    if (inFolder.length) groups.push({ name: folder.name, folderId: folder.id, entries: inFolder });
  });
  const known = new Set(folders.map(f => f.id));
  const unfiled = entries.filter(e => !known.has(e.task.folder_id));
  // No real folder behind "Unfiled" to pre-fill, so it never gets an add link — same as any
  // other bucket with no natural default (see Importance's "no addPrefill" case).
  if (unfiled.length) groups.push({ name: "Unfiled", folderId: null, entries: unfiled });
  return groups;
}

// ---------- Cards ----------

// "Due in N" while a deadline is 1..deadline_high_days out. At 0 or past, escalatingTag
// already shows Due Today / Overdue instead, so a card never carries both.
function appendDeadlineCountdown(el, task, today) {
  if (!task.deadline) return;
  const days = calendarDaysBetween(today, task.deadline);
  const limit = Math.max(1, Math.round(Number(settings.deadline_high_days)));
  if (days >= 1 && days <= limit) el.appendChild(makeBadge("Due in " + days, "tag-badge tag-countdown"));
}

// Completing from a card: strike through at once, move after a short grace period (a second
// click within it cancels). The grace period survives a re-render, since the timer, not the
// element, is what's pending.
function scheduleCardDone(task, el, checked) {
  if (checked) {
    if (pendingDone.has(task.id)) return;
    el.classList.add("done-pending");
    const timer = setTimeout(() => {
      pendingDone.delete(task.id);
      if (task.status === "active") toggleTaskDone(task);
    }, DONE_GRACE_MS);
    pendingDone.set(task.id, timer);
  } else {
    clearTimeout(pendingDone.get(task.id));
    pendingDone.delete(task.id);
    el.classList.remove("done-pending");
  }
}

// One task card. Same heat-map as everywhere else: hue from the live quadrant, --p from
// priority intensity. Compact = checkbox, title, tags (and the hover pencil). Expanded adds
// the meta line (not on Bite-size cards), the sizing chip, Now's countdown, Later's inline
// do_date input. Bite-size cards render slimmer, size alone, no icon or label either state.
function renderWindowCard(entry, win, expanded) {
  const { task, assessment } = entry;
  const today = todayISODate();
  const pending = pendingDone.has(task.id);
  const card = document.createElement("div");
  card.className = "window-card quadrant-" + assessment.quadrant.key
    + (task.is_quick_win ? " window-card-quick" : "")
    + (expanded ? " window-card-expanded" : "")
    + (pending ? " done-pending" : "");
  card.dataset.taskId = task.id;
  card.style.setProperty("--p", assessment.intensity.toFixed(3));
  card.title = buildTaskTooltip(task, assessment, {
    quadrant: true, urgency: true, importance: true, deadline: true, deadlineFallback: "no deadline",
    doDate: true, biteSize: true,
  });
  makeTaskDraggable(card, task, win.key);

  const children = tasks.filter(t => t.parent_task_id === task.id);
  if (children.length > 0) card.appendChild(makeSubtaskCaret(task));

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "window-card-check";
  checkbox.checked = pending;
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => scheduleCardDone(task, card, checkbox.checked));
  card.appendChild(checkbox);

  const body = document.createElement("div");
  body.className = "window-card-body";

  const titleLine = document.createElement("span");
  titleLine.className = "window-card-title-line";
  const title = document.createElement("span");
  title.className = "window-card-title";
  title.textContent = task.title;
  titleLine.appendChild(title);
  appendTagBadge(titleLine, task, today);
  if (win.key === "now" && expanded) appendDeadlineCountdown(titleLine, task, today);
  appendRolloverBadge(titleLine, task);
  body.appendChild(titleLine);

  if (children.length > 0) body.appendChild(renderSubtaskProgress(children));

  if (expanded && !task.is_quick_win) {
    const meta = document.createElement("span");
    meta.className = "window-card-meta";
    const context = taskContextLabel(task);
    meta.textContent = [
      context || null,
      assessment.quadrant.label,
      assessment.urgency.reason,
      win.key === "later" && task.deadline ? "due " + task.deadline : null,
    ].filter(Boolean).join(" · ");
    body.appendChild(meta);
  }
  if (expanded && win.key === "later") body.appendChild(renderInlineDates(task, card));

  if (children.length > 0 && !collapsedTasks.has(task.id)) {
    body.appendChild(renderCardSubtasks(children, win, today));
  }

  body.appendChild(makeAddSubtaskLink(task));

  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "window-card-actions";

  if (expanded) {
    // Sizing chip: toggles is_quick_win. Its text never changes — "Bite-size" always — the
    // on/off state shows through .active (filled vs. outline), same as the task form's toggle.
    // Not a "touch" — it changes nothing about the task's scheduling, so it must not reset the
    // staleness clock.
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "window-chip" + (task.is_quick_win ? " active" : "");
    chip.textContent = "Bite-size";
    chip.title = task.is_quick_win ? "Bite-size — click to turn off" : "Click to mark as Bite-size";
    chip.setAttribute("aria-pressed", task.is_quick_win ? "true" : "false");
    chip.addEventListener("click", () => toggleQuickWin(task));
    actions.appendChild(chip);
  }

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-icon";
  editBtn.innerHTML = ICONS.pencil;
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openTaskModal(task));
  actions.appendChild(editBtn);

  if (expanded) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-icon";
    delBtn.style.color = "var(--danger)";
    delBtn.innerHTML = ICONS.trash;
    delBtn.setAttribute("aria-label", "Delete task");
    delBtn.title = "Delete";
    delBtn.addEventListener("click", () => deleteTask(task.id));
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);
  return card;
}

// "+" add-subtask: same inline affordance the original folder-based list has always had,
// opening the shared task form pre-filled to nest under `task` — a bare symbol here rather
// than a text label, the cards are tighter on space than the folder list rows.
function makeAddSubtaskLink(task) {
  const addSub = document.createElement("button");
  addSub.type = "button";
  addSub.className = "link-btn window-card-add-subtask";
  addSub.textContent = "+";
  addSub.title = "Add subtask";
  addSub.setAttribute("aria-label", "Add subtask to " + task.title);
  addSub.addEventListener("click", () => openTaskModal({ folder_id: task.folder_id, parent_task_id: task.id }));
  return addSub;
}

// Collapse/expand caret for a card or nested row with subtasks. Shares collapsedTasks with
// the folder list, so a task folded in one place is folded everywhere.
function makeSubtaskCaret(task) {
  const collapsed = collapsedTasks.has(task.id);
  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "task-caret window-card-caret" + (collapsed ? " collapsed" : "");
  caret.textContent = "▼";
  caret.setAttribute("aria-label", collapsed ? "Expand subtasks" : "Collapse subtasks");
  caret.addEventListener("click", e => {
    e.stopPropagation();
    if (collapsedTasks.has(task.id)) collapsedTasks.delete(task.id);
    else collapsedTasks.add(task.id);
    render();
  });
  return caret;
}

// Nested subtasks under a card: every child (done ones struck through, like the folder list),
// each with its own checkbox, tag, and, recursively, its own subtasks. Active rows carry
// their own live quadrant hue and are draggable with the card's window as source, so a
// subtask can be planned into Now or deprioritized out of it on its own.
function renderCardSubtasks(children, win, today) {
  const list = document.createElement("div");
  list.className = "window-card-subtasks";
  children.forEach(child => list.appendChild(renderCardSubtaskRow(child, win, today)));
  return list;
}

function renderCardSubtaskRow(task, win, today) {
  const row = document.createElement("div");
  const pending = pendingDone.has(task.id);
  row.className = "window-subtask" + (task.status === "done" ? " done" : "") + (pending ? " done-pending" : "");
  const grandchildren = tasks.filter(t => t.parent_task_id === task.id);

  if (task.status === "active") {
    const assessment = assessTask(task, settings, today);
    row.classList.add("quadrant-" + assessment.quadrant.key);
    row.style.setProperty("--p", assessment.intensity.toFixed(3));
    row.title = buildTaskTooltip(task, assessment, { quadrant: true, urgency: true });
    makeTaskDraggable(row, task, win.key);
  }

  const head = document.createElement("div");
  head.className = "window-subtask-head";

  if (grandchildren.length > 0) head.appendChild(makeSubtaskCaret(task));
  else {
    const spacer = document.createElement("span");
    spacer.className = "task-caret-spacer";
    head.appendChild(spacer);
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.status === "done" || pending;
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => {
    if (task.status === "done") toggleTaskDone(task); // undo is immediate
    else scheduleCardDone(task, row, checkbox.checked);
  });
  head.appendChild(checkbox);

  const titleLine = document.createElement("span");
  titleLine.className = "window-subtask-title-line";
  const title = document.createElement("span");
  title.className = "window-subtask-title";
  title.textContent = task.title;
  titleLine.appendChild(title);
  appendTagBadge(titleLine, task, today);
  appendRolloverBadge(titleLine, task);
  if (grandchildren.length > 0) titleLine.appendChild(renderSubtaskProgress(grandchildren));
  head.appendChild(titleLine);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-icon window-subtask-edit";
  editBtn.innerHTML = ICONS.pencil;
  editBtn.setAttribute("aria-label", "Edit subtask");
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openTaskModal(task));
  head.appendChild(editBtn);

  row.appendChild(head);

  if (grandchildren.length > 0 && !collapsedTasks.has(task.id)) {
    row.appendChild(renderCardSubtasks(grandchildren, win, today));
  }

  row.appendChild(makeAddSubtaskLink(task));

  return row;
}

// Inline do_date input (Later's expanded cards only — Now shows the countdown instead).
// Empty is a legitimate state. While the pointer is over the input the card stops being
// draggable, otherwise Chrome starts a drag instead of opening the picker.
function renderInlineDates(task, card) {
  const wrap = document.createElement("div");
  wrap.className = "window-card-dates";

  const label = document.createElement("label");
  label.className = "window-card-date";
  label.textContent = "Do";
  const input = document.createElement("input");
  input.type = "date";
  input.value = task.do_date || "";
  input.addEventListener("pointerenter", () => { card.draggable = false; });
  input.addEventListener("pointerleave", () => { card.draggable = true; });
  input.addEventListener("change", () => inlineSetDoDate(task, input.value));
  label.appendChild(input);
  wrap.appendChild(label);
  return wrap;
}

// ---------- Completed Today (Now only) ----------
// Every task completed today (completed_at's local date == today, whichever window or list it
// was checked off in), in a folder collapsed by default at the bottom of Now. Nothing stored:
// the set clears itself at the next day boundary because the date test is live.
function renderCompletedToday(today) {
  const done = tasks.filter(t => t.status === "done" && t.completed_at && toLocalDateString(t.completed_at) === today);
  if (done.length === 0) return null;
  done.sort((a, b) => (a.completed_at < b.completed_at ? 1 : a.completed_at > b.completed_at ? -1 : 0)); // newest first

  const block = document.createElement("div");
  block.className = "window-completed" + (completedTodayOpen ? " open" : "");

  const header = document.createElement("button");
  header.type = "button";
  header.className = "window-completed-header";
  header.setAttribute("aria-expanded", completedTodayOpen ? "true" : "false");
  const caret = document.createElement("span");
  caret.className = "folder-caret";
  caret.textContent = "▼";
  header.appendChild(caret);
  const label = document.createElement("span");
  label.className = "window-completed-label";
  label.textContent = "Completed Today";
  header.appendChild(label);
  const count = document.createElement("span");
  count.className = "window-count";
  count.textContent = done.length;
  header.appendChild(count);
  header.addEventListener("click", () => {
    completedTodayOpen = !completedTodayOpen;
    render();
  });
  block.appendChild(header);

  if (completedTodayOpen) {
    const list = document.createElement("div");
    list.className = "window-completed-list";
    done.forEach(task => {
      const row = document.createElement("label");
      row.className = "window-completed-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.setAttribute("aria-label", "Reopen " + task.title);
      checkbox.addEventListener("change", () => toggleTaskDone(task));
      row.appendChild(checkbox);
      const title = document.createElement("span");
      title.className = "window-completed-title";
      title.textContent = task.title;
      row.appendChild(title);
      const context = taskContextLabel(task);
      if (context) {
        const meta = document.createElement("span");
        meta.className = "window-habit-meta";
        meta.textContent = context;
        row.appendChild(meta);
      }
      list.appendChild(row);
    });
    block.appendChild(list);
  }
  return block;
}

// ---------- Empty-Now suggestion ----------
// The top 3 Later tasks by priority, boxed up with an "Add all N" button. Cards are the real
// renderWindowCard, source "later" — draggable into Now exactly like any other Later card;
// the box is just a highlighted second look at them.
function renderSuggestionBox(suggested, expanded) {
  const box = document.createElement("div");
  box.className = "window-suggestion";

  const header = document.createElement("div");
  header.className = "window-suggestion-header";

  const label = document.createElement("span");
  label.className = "window-suggestion-label";
  label.textContent = "Daily Plate is empty — top " + suggested.length + " from Fridge";
  header.appendChild(label);

  const addAllBtn = document.createElement("button");
  addAllBtn.type = "button";
  addAllBtn.className = "btn btn-primary window-suggestion-add-all";
  addAllBtn.textContent = "Add all " + suggested.length;
  addAllBtn.addEventListener("click", () => {
    addAllBtn.disabled = true;
    addSuggestedTasksToNow(suggested.map(entry => entry.task));
  });
  header.appendChild(addAllBtn);

  box.appendChild(header);

  const cards = document.createElement("div");
  cards.className = "window-suggestion-cards";
  suggested.forEach(entry => cards.appendChild(renderWindowCard(entry, WINDOWS.later, expanded)));
  box.appendChild(cards);

  return box;
}

// Chains addToNow across the suggested tasks, one at a time — the deadline prompt can only
// have one open at a time (promptForDeadline cancels any prior one), so these must resolve
// in sequence rather than fire concurrently.
async function addSuggestedTasksToNow(tasksToAdd) {
  for (const task of tasksToAdd) {
    await addToNow(task, { manual: true });
  }
}

// ---------- Focus mode ----------
// Overlay over the whole page: only the do_date == today subset of Now, expanded cards, same
// drag mechanics — dropping a card on the dimmed backdrop deprioritizes it exactly as a drop
// on Later would. Purely a rendering mode over existing data.

const focusOverlay = document.getElementById("focus-overlay");
const focusPanel = document.getElementById("focus-panel");
const focusBody = document.getElementById("focus-body");

function openFocusMode() {
  focusModeOpen = true;
  render();
}

function closeFocusMode() {
  if (!focusModeOpen) return;
  focusModeOpen = false;
  render();
}

function renderFocusOverlay(ranked, today) {
  const open = focusModeOpen && activeView === "list" && !!ranked;
  focusOverlay.classList.toggle("hidden", !open);
  if (!open) return;

  const members = ranked.filter(entry => WINDOWS.now.member(entry, today) && isDoDateTodayEntry(entry, today));
  const entries = topLevelEntries(sortWindowEntries(members, windowPrefs.sort));
  document.getElementById("focus-count").textContent = members.length;
  document.getElementById("focus-close-btn").innerHTML = ICONS.close; // ICONS is app.js's, loaded after this file
  focusBody.innerHTML = "";
  if (entries.length === 0) {
    focusBody.appendChild(makeEmptyHint("Nothing planned for today. Close focus and drag something in.", "window-empty"));
    return;
  }
  entries.forEach(entry => focusBody.appendChild(renderWindowCard(entry, WINDOWS.now, true)));
}

document.getElementById("focus-close-btn").addEventListener("click", closeFocusMode);
focusOverlay.addEventListener("click", e => {
  if (e.target === focusOverlay) closeFocusMode();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && focusModeOpen) closeFocusMode();
});

// ---------- Actions ----------

// Puts a task in Now for today. `manual` = the user did it (drag, "+ Add", a bucket drop),
// which counts as a genuine edit (touches last_touched_at). A manual add of a task with no
// deadline first asks for one (Now-window deadline prompt), so nothing can roll forward in
// Now indefinitely with nothing else forcing it to surface. A genuine do_date write, so the
// rollover count starts over. Resolves true once the task is in Now for today, false if the
// prompt was cancelled or there was nothing to do.
function addToNow(task, opts) {
  const manual = !!(opts && opts.manual);
  const today = todayISODate();
  if (task.status !== "active" || task.do_date === today) return Promise.resolve(false);

  const finish = () => {
    task.do_date = today;
    task.do_date_rollover_count = 0;
    if (manual) task.last_touched_at = new Date().toISOString();
    persist();
    render();
  };

  if (manual && !task.deadline) {
    return promptForDeadline(task, NOW_DEADLINE_PROMPT).then(date => {
      if (!date) return false; // cancelled: leave the task where it was
      task.deadline = date;
      finish();
      return true;
    });
  }
  finish();
  return Promise.resolve(true);
}

// Deprioritize: dragging a task out of Now (onto Later, the main list, or focus mode's
// backdrop). Splits on WHY the task is in Now:
//  - a close deadline is the true driver (isDeadlineDriven): it can only leave with a new
//    deadline, so a prompt asks for one first. No validation — pick one still close enough and
//    the live recalculation honestly shows it straight back in Now. do_date follows the new
//    deadline (the deadline default), otherwise do_date == today would keep the floor on.
//  - otherwise (staleness, or purely floor-boosted): a genuine edit. do_date resets to the
//    deadline if there is one, null if not, and last_touched_at legitimately updates (unlike
//    passive rollover, which never touches it). The live quadrant then settles into Plan or
//    Backlog on its own, which is exactly what Later's plain quadrant rule picks up.
// Either way a genuine do_date write: the rollover count resets. Returns a promise.
function deprioritize(task) {
  const today = todayISODate();
  if (task.status !== "active" || !isNowMember(task, assessTask(task, settings, today), today)) return Promise.resolve();

  if (isDeadlineDriven(task, settings, today)) {
    return promptForDeadline(task, {
      heading: "Pick a new deadline",
      text: "This is in Daily Plate because its deadline is close. Commit to a new date before it leaves:",
      confirmLabel: "Reschedule",
      defaultDate: addDaysISODate(today, Math.max(0, Math.round(settings.deadline_medium_days))),
    }).then(date => {
      if (!date) return; // cancelled: it stays
      task.deadline = date;
      task.do_date = date;
      task.do_date_rollover_count = 0;
      task.last_touched_at = new Date().toISOString();
      persist();
      render();
    });
  }

  task.do_date = task.deadline || null;
  task.do_date_rollover_count = 0;
  task.last_touched_at = new Date().toISOString();
  persist();
  render();
  showBackfillIfNeeded(); // an undated High/Critical task that just settled into Plan needs a deadline
  return Promise.resolve();
}

function setQuickWin(task, value) {
  if (!!task.is_quick_win === !!value) return;
  task.is_quick_win = !!value;
  persist();
  render();
}

function toggleQuickWin(task) {
  setQuickWin(task, !task.is_quick_win);
}

// An explicit do_date write — the inline field, a bucket drop, Later's with-date drop. A
// genuine edit: touches last_touched_at and resets the rollover count. Setting a date on a
// deadline-less task runs the same deadline prompt as adding to Now would. Guard rail: a
// do_date after the task's deadline (planning to do it once it's already due) asks first.
// Resolves true when the write happened.
function setDoDateExplicit(task, value) {
  const next = value || null;
  if (next === (task.do_date || null)) return Promise.resolve(false);
  if (next && task.deadline && next > task.deadline) {
    const ok = confirm("That's after this task's deadline (" + task.deadline + ") — planning to do it once it's already due. Set it anyway?");
    if (!ok) { render(); return Promise.resolve(false); } // re-render puts the old value back
  }
  const finish = () => {
    task.do_date = next;
    task.do_date_rollover_count = 0;
    task.last_touched_at = new Date().toISOString();
    persist();
    render();
  };
  if (next && !task.deadline) {
    return promptForDeadline(task, NOW_DEADLINE_PROMPT).then(date => {
      if (!date) { render(); return false; } // cancelled: re-render puts the old value back
      task.deadline = date;
      finish();
      return true;
    });
  }
  finish();
  return Promise.resolve(true);
}

// Inline do_date edit (Later's expanded cards, the Overview's expanded list).
function inlineSetDoDate(task, value) {
  return setDoDateExplicit(task, value);
}

// Later's "No do date" drop: unplan it. A genuine edit.
function clearDoDate(task) {
  if (!task.do_date) return;
  task.do_date = null;
  task.do_date_rollover_count = 0;
  task.last_touched_at = new Date().toISOString();
  persist();
  render();
}

// Inline deadline edit (the Overview's expanded list, Now's Urgency bucket drops). Same rules
// as the task form: a newly set deadline defaults do_date (if empty), and the deadline
// requirement blocks leaving a High/Critical task dateless in Plan.
function inlineSetDeadline(task, value) {
  const next = value || null;
  if (next === (task.deadline || null)) return;
  const now = new Date().toISOString();
  const candidate = Object.assign({}, task, { deadline: next, last_touched_at: now });
  if (isDeadlineViolator(candidate, todayISODate())) {
    // Same deadline-requirement UI everywhere it applies: the shared modal, not a blocking
    // alert(). A resolved date becomes the new deadline; cancelling re-renders the old value back.
    promptForDeadline(task, DEADLINE_REQUIRED_PROMPT).then(date => {
      if (!date) { render(); return; }
      task.deadline = date;
      applyDeadlineDefault(task);
      task.last_touched_at = now;
      persist();
      render();
    });
    return;
  }
  task.deadline = next;
  if (next) applyDeadlineDefault(task);
  task.last_touched_at = now;
  persist();
  render();
}

// Inline importance edit (the Overview's expanded priority list, Importance bucket drops).
// Same deadline requirement as the form: raising a dateless task to High/Critical while it
// would sit in Plan is blocked — a drop is a shortcut for the edit, never a way around it.
function inlineSetImportance(task, value) {
  if (!IMPORTANCE_SCORES[value] || value === task.importance) return;
  const now = new Date().toISOString();
  const candidate = Object.assign({}, task, { importance: value, last_touched_at: now });
  if (isDeadlineViolator(candidate, todayISODate())) {
    promptForDeadline(task, DEADLINE_REQUIRED_PROMPT).then(date => {
      if (!date) { render(); return; }
      task.importance = value;
      task.deadline = date;
      applyDeadlineDefault(task);
      task.last_touched_at = now;
      persist();
      render();
    });
    return;
  }
  task.importance = value;
  task.last_touched_at = now;
  persist();
  render();
}

// The folder a new task defaults to: the first folder in the active category filter.
function defaultFolderPrefill() {
  if (folders.length === 0) return null;
  const candidates = activeCategoryFilter !== "all" ? folders.filter(f => f.category_id === activeCategoryFilter) : folders;
  return { folder_id: (candidates[0] || folders[0]).id };
}

// Now's global "+": the task form planned for today, with a deadline the day after tomorrow —
// some real leeway rather than "due today" by default. Both stay freely editable.
function addTaskToNowDirectly() {
  const base = defaultFolderPrefill();
  if (!base) { alert("Add a folder first."); return; }
  const today = todayISODate();
  openTaskModal(Object.assign(base, { do_date: today, deadline: addDaysISODate(today, 2) }));
}

// Later's global "+": the plain shared form, no special prefill — unlike Now there's no
// single default (Plan vs. Backlog falls out of importance/urgency after the fact, not a
// choice made upfront). The existing deadline requirement (High/Critical can't sit in Plan
// without one) already applies on save, nothing extra needed here.
function addTaskToLaterDirectly() {
  const base = defaultFolderPrefill();
  if (!base) { alert("Add a folder first."); return; }
  openTaskModal(base);
}

// A bucket's own "+": the shared form pre-filled to belong in that bucket.
function addTaskFromBucket(prefill) {
  const base = defaultFolderPrefill();
  if (!base) { alert("Add a folder first."); return; }
  openTaskModal(Object.assign(base, prefill));
}

// ---------- Deadline prompt ----------
// One small modal, two uses: "Set a deadline" when a task enters Now without one, and "Pick a
// new deadline" when a deadline-driven task is dragged out. Resolves with the chosen
// "YYYY-MM-DD" or null on cancel. Only one can be open at a time; opening another cancels it.

const NOW_DEADLINE_PROMPT = Object.freeze({
  heading: "Set a deadline",
  text: "Anything planned for a day needs a real deadline, so it can't roll forward forever unnoticed. Set one for",
  confirmLabel: "Set date",
});

// Same prompt, worded for the other trigger: a High/Critical importance edit that would leave
// a task dateless in Plan (the task form's own submit-time check uses this too, see app.js).
const DEADLINE_REQUIRED_PROMPT = Object.freeze({
  heading: "Set a deadline",
  text: "High/Critical tasks need a deadline — without one this would sit in Plan with no target. Set one for",
  confirmLabel: "Save",
});

const nowDeadlineModal = document.getElementById("now-deadline-modal");
const nowDeadlineForm = document.getElementById("now-deadline-form");
const nowDeadlineInput = document.getElementById("now-deadline-input");
let nowDeadlineResolve = null;

function promptForDeadline(task, opts) {
  return new Promise(resolve => {
    if (nowDeadlineResolve) nowDeadlineResolve(null); // a previous prompt still open: cancel it
    nowDeadlineResolve = resolve;
    document.getElementById("now-deadline-heading").textContent = opts.heading;
    document.getElementById("now-deadline-text").textContent = opts.text;
    document.getElementById("now-deadline-task").textContent = task.title;
    document.getElementById("now-deadline-confirm").textContent = opts.confirmLabel;
    nowDeadlineInput.value = opts.defaultDate || defaultNowDeadline();
    nowDeadlineInput.min = todayISODate();
    nowDeadlineModal.classList.remove("hidden");
    nowDeadlineInput.focus();
  });
}

function settleDeadlinePrompt(value) {
  nowDeadlineModal.classList.add("hidden");
  const resolve = nowDeadlineResolve;
  nowDeadlineResolve = null;
  if (resolve) resolve(value);
}

nowDeadlineForm.addEventListener("submit", e => {
  e.preventDefault();
  if (!nowDeadlineInput.value) return;
  settleDeadlinePrompt(nowDeadlineInput.value);
});
document.getElementById("now-deadline-cancel-btn").addEventListener("click", () => settleDeadlinePrompt(null));
nowDeadlineModal.addEventListener("click", e => {
  if (e.target === nowDeadlineModal) settleDeadlinePrompt(null);
});

// ---------- Drag and drop ----------
// HTML5 DnD. Sources: active rows in the main list ("list"), Now cards ("now"), Later cards
// ("later"). Drop zones: the Now window (adds, from anywhere but Now itself); the main list,
// the Later window and focus mode's backdrop (deprioritize, only for a drag that started in
// Now — so dragging a list row and dropping it back on the list is a no-op); and, in the
// bucketed sorts, each bucket inside a window (wireBucketDrop). Habit rows are never sources.

const DRAG_MIME = "text/task-id";
let dragState = null; // { taskId, source } while a drag is in progress

function makeTaskDraggable(el, task, source) {
  el.draggable = true;
  el.addEventListener("dragstart", e => {
    dragState = { taskId: task.id, source: source || "list" };
    try {
      e.dataTransfer.setData(DRAG_MIME, task.id);
      e.dataTransfer.setData("text/plain", task.title);
      e.dataTransfer.effectAllowed = "move";
    } catch (err) { /* older engines */ }
    el.classList.add("dragging");
    e.stopPropagation(); // a subtask row inside a task row: only the innermost drags
  });
  el.addEventListener("dragend", () => {
    dragState = null;
    el.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach(z => z.classList.remove("drop-target"));
  });
}

// `accepts(source, event)` decides whether this zone lights up for the current drag. An
// accepted dragover/drop stops propagating, so a zone nested inside another (the buckets
// inside a window, the focus panel inside its backdrop) is the only one that acts.
// `onDrop(task, source)` gets the drag's source window too.
function wireDropZone(el, accepts, onDrop) {
  el.addEventListener("dragover", e => {
    if (!dragState || !accepts(dragState.source, e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", e => {
    if (!dragState || !accepts(dragState.source, e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove("drop-target");
    let id = "";
    try { id = e.dataTransfer.getData(DRAG_MIME); } catch (err) { id = ""; }
    const source = dragState.source;
    const task = tasks.find(t => t.id === (id || dragState.taskId));
    dragState = null;
    if (task) onDrop(task, source);
  });
}

wireDropZone(document.getElementById("now-window"), source => source !== "now", task => addToNow(task, { manual: true }));
wireDropZone(document.getElementById("later-window"), source => source === "now", task => deprioritize(task));
wireDropZone(document.getElementById("folder-list"), source => source === "now", task => deprioritize(task));
// Focus mode: the dimmed backdrop, not the panel itself, is the drop target.
wireDropZone(focusOverlay, (source, e) => source === "now" && !focusPanel.contains(e.target), task => deprioritize(task));

// Clicking non-interactive space anywhere inside a window — not just its header/controls, the
// whole panel — also expands it, same toggle the plate/fridge icon uses. Excludes anything
// with its own click behavior: buttons, the sort/add controls, links, inputs, and task-like
// rows (cards, subtasks, habits, Completed Today rows) that carry their own checkbox or drag
// behavior, so a plain click on one never also resizes the window around it. Wired once on the
// stable panel element (never recreated by render, unlike its children), not re-attached every
// render like the old header/controls-only listeners it replaces.
function wireWindowExpandClick(el, win) {
  el.addEventListener("click", e => {
    if (e.target.closest("button, select, input, a, .window-card, .window-subtask, .window-habit, .window-completed-row")) return;
    const expanded = windowPrefs.focus === win.key;
    setWindowPref("focus", expanded ? "none" : win.key);
  });
}
wireWindowExpandClick(document.getElementById("now-window"), WINDOWS.now);
wireWindowExpandClick(document.getElementById("later-window"), WINDOWS.later);

// Clicking anywhere outside the two windows collapses whichever one is expanded back to equal
// widths — a click-away-to-deselect pattern, same idea as a dropdown closing when you click
// elsewhere. A click inside an open modal, the Focus mode overlay, or the view-switch tabs
// doesn't count as "outside": those are their own dialogs or their own navigation, not a
// dismissal click on the page around the windows (switching into Checklist sets its own
// expanded default instead, see setActiveView in app.js).
//
// Uses composedPath(), not e.target/.closest(): the click that expands a window (the plate/
// fridge icon, the header, a bucket's own controls) re-renders that window's contents
// synchronously — el.innerHTML = "" followed by a rebuild — which detaches the actual clicked
// element from the live tree before this listener runs. .closest() on a detached node can't
// walk back up to an ancestor the rebuild already severed it from, so it always looked
// "outside" and undid the very expand that just happened. composedPath() is a snapshot of the
// event's real path taken at dispatch time, before any handler had a chance to mutate the DOM.
const windowsRowEl = document.getElementById("windows-row");
const windowsToolbarEl = document.getElementById("windows-toolbar");
document.addEventListener("click", e => {
  if (windowPrefs.focus === "none") return;
  if (activeView !== "list" || listDisplayMode !== "windows") return;
  const path = e.composedPath();
  const isExempt = path.some(node =>
    node === windowsRowEl ||
    node === windowsToolbarEl ||
    (node.classList && node.classList.contains("modal")) ||
    node.id === "focus-overlay" ||
    node.id === "view-switch"
  );
  if (isExempt) return;
  setWindowPref("focus", "none");
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WINDOW_SORT_KEYS, WINDOW_GROUP_MODES, compareDoDates, sortWindowEntries, bucketWindowEntries, bucketsTakeHabits, groupEntriesByFolder, topLevelEntries };
}
