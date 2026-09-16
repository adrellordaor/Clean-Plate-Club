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
//
// Sorting: a dropdown (five options is too many for a segmented switch) — Priority (default),
// Urgency, Importance, Quick win, Do date. Do date draws a thin divider between date groups:
// in Now that's today / each later date / no date, and the today-vs-rest boundary is
// draggable across (a lighter action than deprioritizing, it just toggles do_date's "today"
// status and lets the live quadrant decide); in Later the divider splits with-date from
// without-date. A separate flat / by-folder toggle nests inside whatever the sort produces.
//
// Compact vs. expanded cards: at default width a card is checkbox + title + tag. When a window
// is the expanded panel its cards also show the meta line, inline do_date / deadline inputs
// and the quick-win chip, so small changes don't need the full form.
//
// Nested subtasks: a card shows its subtasks underneath, collapsible with the same caret and
// the same shared collapsed set (collapsedTasks) as the folder list, so the structure is one
// thing in both places. A member whose parent is also a member of the same window renders
// nested under the parent rather than as a second card; a member whose parent is elsewhere
// (or top-level) gets its own card. This is what makes the "full" List mode optional for
// everyday use rather than the only place subtask structure is visible.
//
// Habits in Now: a schedule-filtered view of the same RecurringTasks the Weekly/Daily boxes
// show (isRecurringNowMember in urgency.js — daily always, weekly on its weekday or near the
// week's end). Rendered as their own block under the task cards: no importance, urgency,
// quadrant, tag, sort or drag, and ticking one off logs to CompletionLog exactly as the boxes
// do. Only shown in the "windows" List display mode (list_display_mode); "full" keeps the
// original folder page and the boxes.
//
// Focus mode (Now only): an on-demand overlay over the page showing just the do_date == today
// subset of Now, same cards, same drag mechanics (drop on the dimmed backdrop = deprioritize).
// Rendering mode only, no membership rule of its own, nothing to keep in sync.
//
// Empty-Now suggestion: whenever Now has zero tasks (live-checked every render), Later boxes
// its top 3 by priority with an "Add all N" button chaining addToNow. No state to clear.
//
// Per-device prefs (sort, grouping, which window is expanded) live in localStorage like the
// theme. Reads app.js state (tasks, folders, settings, activeView, todayISODate, persist,
// render, openTaskModal, toggleTaskDone, defaultNowDeadline, applyDeadlineDefault,
// isDeadlineViolator, showBackfillIfNeeded, appendTagBadge, ICONS), calendar.js
// (addDaysISODate) and overview.js (rankActiveTasks, taskContextLabel) only from inside
// functions that run after every script has loaded.

const WINDOW_SORT_KEYS = [
  { key: "priority", label: "Priority" },
  { key: "urgency", label: "Urgency" },
  { key: "importance", label: "Importance" },
  { key: "quickwin", label: "Quick win" },
  { key: "dodate", label: "Do date" },
];

const WINDOW_GROUP_MODES = [
  { key: "flat", label: "Flat" },
  { key: "folder", label: "By folder" },
];

const WINDOW_PREFS_KEY = "windowPrefs";
const DEFAULT_WINDOW_PREFS = Object.freeze({
  focus: "none",       // "none" | "now" | "later" — which window is expanded
  nowSort: "priority", laterSort: "priority",
  nowGroup: "flat",    laterGroup: "flat",
});

let windowPrefs = loadWindowPrefs();
let focusModeOpen = false; // transient, never persisted

function loadWindowPrefs() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(WINDOW_PREFS_KEY) || "{}") || {}; } catch (e) { raw = {}; }
  const sortKeys = WINDOW_SORT_KEYS.map(s => s.key);
  const groupKeys = WINDOW_GROUP_MODES.map(g => g.key);
  return {
    focus: ["none", "now", "later"].includes(raw.focus) ? raw.focus : DEFAULT_WINDOW_PREFS.focus,
    nowSort: sortKeys.includes(raw.nowSort) ? raw.nowSort : DEFAULT_WINDOW_PREFS.nowSort,
    laterSort: sortKeys.includes(raw.laterSort) ? raw.laterSort : DEFAULT_WINDOW_PREFS.laterSort,
    nowGroup: groupKeys.includes(raw.nowGroup) ? raw.nowGroup : DEFAULT_WINDOW_PREFS.nowGroup,
    laterGroup: groupKeys.includes(raw.laterGroup) ? raw.laterGroup : DEFAULT_WINDOW_PREFS.laterGroup,
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
// priority_score, so the order is stable: "Quick win" groups quick wins first, "Do date" runs
// chronologically ascending (no date last), each with priority as the tiebreak inside a group.
function sortWindowEntries(entries, key) {
  const byPriority = (a, b) => b.assessment.priorityScore - a.assessment.priorityScore;
  const sorted = entries.slice();
  if (key === "urgency") {
    sorted.sort((a, b) => b.assessment.urgency.score - a.assessment.urgency.score || byPriority(a, b));
  } else if (key === "importance") {
    sorted.sort((a, b) => b.assessment.importanceScore - a.assessment.importanceScore || byPriority(a, b));
  } else if (key === "quickwin") {
    sorted.sort((a, b) => Number(!!b.task.is_quick_win) - Number(!!a.task.is_quick_win) || byPriority(a, b));
  } else if (key === "dodate") {
    sorted.sort((a, b) => compareDoDates(a.task.do_date, b.task.do_date) || byPriority(a, b));
  } else {
    sorted.sort(byPriority);
  }
  return sorted;
}

// Do-date groups for the divider layout. `entries` must already be in "dodate" order.
//   Now:   { today: [...], other: [{ key, label, entries }, ...] } — one group per later date,
//          ascending, then "No date". today/other is the draggable boundary.
//   Later: { withDate: [...], withoutDate: [...] } — not every Plan/Backlog task has a
//          do_date (only the deadline default gives one), so chronological groups don't apply.
function splitByDoDate(entries, winKey, today) {
  if (winKey === "later") {
    return {
      withDate: entries.filter(e => !!e.task.do_date),
      withoutDate: entries.filter(e => !e.task.do_date),
    };
  }
  const todayGroup = entries.filter(e => e.task.do_date === today);
  const other = [];
  entries.filter(e => e.task.do_date !== today).forEach(entry => {
    const key = entry.task.do_date || "";
    let group = other.find(g => g.key === key);
    if (!group) {
      group = { key, label: key ? describeDoDate(key, today) : "No date", entries: [] };
      other.push(group);
    }
    group.entries.push(entry);
  });
  return { today: todayGroup, other };
}

// "Tomorrow", or "Fri 19 Sep" for a date group label.
function describeDoDate(dateStr, today) {
  const days = calendarDaysBetween(today, dateStr);
  if (days === 1) return "Tomorrow";
  if (days < 0) return "Past · " + dateStr; // only visible between midnight and the next maintenance run
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const WINDOWS = {
  now: {
    key: "now", elementId: "now-window", title: "Now", hint: "do today · Do · Clear",
    sortPref: "nowSort", groupPref: "nowGroup",
    member: (entry, today) => isNowMember(entry.task, entry.assessment, today),
    empty: "Nothing urgent or planned for today. Drag a task here, or add one.",
  },
  later: {
    key: "later", elementId: "later-window", title: "Later", hint: "Plan + Backlog",
    sortPref: "laterSort", groupPref: "laterGroup",
    member: entry => isLaterMember(entry.assessment),
    empty: "Nothing in Plan or Backlog.",
  },
};

// ---------- Rendering ----------

function renderNowLaterWindows() {
  if (activeView !== "list" || settings.list_display_mode !== "windows") {
    renderFocusOverlay(null, null); // hides the overlay if a view/mode switch happened under it
    return;
  }
  const today = todayISODate();
  const ranked = rankActiveTasks(today);

  const row = document.getElementById("windows-row");
  row.classList.toggle("focus-now", windowPrefs.focus === "now");
  row.classList.toggle("focus-later", windowPrefs.focus === "later");

  const nowIsEmpty = !ranked.some(entry => WINDOWS.now.member(entry, today));

  renderWindow(WINDOWS.now, ranked, today);
  renderWindow(WINDOWS.later, ranked, today, nowIsEmpty);
  renderFocusOverlay(ranked, today);
}

function renderWindow(win, ranked, today, nowIsEmpty) {
  const el = document.getElementById(win.elementId);
  el.innerHTML = "";
  const expanded = windowPrefs.focus === win.key;
  el.classList.toggle("window-focused", expanded);

  const unsorted = ranked.filter(entry => win.member(entry, today));
  // Members nested under a member parent render inside that parent's card, not as their own.
  const entries = topLevelEntries(sortWindowEntries(unsorted, windowPrefs[win.sortPref]));

  // Header: title, count, hint, focus mode (Now only), expand/shrink.
  const header = document.createElement("div");
  header.className = "window-header";

  const title = document.createElement("h2");
  title.className = "window-title";
  title.textContent = win.title;
  header.appendChild(title);

  const count = document.createElement("span");
  count.className = "window-count";
  count.textContent = unsorted.length; // every member, nested ones included
  header.appendChild(count);

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

  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "btn-icon window-focus-btn";
  focusBtn.innerHTML = expanded ? ICONS.minimize : ICONS.maximize;
  focusBtn.title = expanded ? "Shrink: back to equal widths" : "Expand: give this window more room and show details";
  focusBtn.setAttribute("aria-label", expanded ? "Shrink" : "Expand");
  focusBtn.addEventListener("click", () => setWindowPref("focus", expanded ? "none" : win.key));
  header.appendChild(focusBtn);

  el.appendChild(header);

  // Controls: sort dropdown + grouping switch.
  const controls = document.createElement("div");
  controls.className = "window-controls";
  controls.appendChild(makeWindowSortSelect(WINDOW_SORT_KEYS, windowPrefs[win.sortPref], key => setWindowPref(win.sortPref, key), win.title + " sort"));
  controls.appendChild(makeWindowSwitch(WINDOW_GROUP_MODES, windowPrefs[win.groupPref], key => setWindowPref(win.groupPref, key), win.title + " grouping"));
  el.appendChild(controls);

  // Empty-Now suggestion (Later only, live-checked every render — see file header).
  if (win.key === "later" && nowIsEmpty) {
    const suggested = sortWindowEntries(unsorted, "priority").slice(0, 3);
    if (suggested.length) el.appendChild(renderSuggestionBox(suggested, expanded));
  }

  el.appendChild(renderWindowBody(win, entries, today, expanded));

  if (win.key === "now") {
    const habits = renderNowHabits(today);
    if (habits) el.appendChild(habits);
  }

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "link-btn window-add";
  addLink.textContent = "+ Add task";
  addLink.addEventListener("click", win.key === "now" ? addTaskToNowDirectly : addTaskToLaterDirectly);
  el.appendChild(addLink);
}

// Drops every entry whose parent is itself in `entries` — those render nested under the
// parent's card (renderCardSubtasks) instead. Order is preserved.
function topLevelEntries(entries) {
  const ids = new Set(entries.map(e => e.task.id));
  return entries.filter(e => !e.task.parent_task_id || !ids.has(e.task.parent_task_id));
}

// ---------- Habits in Now ----------
// The same RecurringTasks the Weekly/Daily boxes list, filtered to today's schedule. Undone
// first, then daily before weekly. Done ones stay visible and ticked (like the boxes) so a
// mis-click can be undone here too. Returns null when no habit is due, so Now stays clean.
function renderNowHabits(today) {
  const due = recurringTasks.filter(rt => isRecurringNowMember(rt, settings, today));
  if (due.length === 0) return null;
  const cadenceOrder = rt => (rt.cadence === "daily" ? 0 : 1);
  due.sort((a, b) => Number(isRecurringDoneNow(a)) - Number(isRecurringDoneNow(b)) || cadenceOrder(a) - cadenceOrder(b));
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
  hint.textContent = "daily · weekly due soon";
  hint.title = "Daily habits every day; weekly ones on their weekday or within " + settings.weekly_recurring_now_days + " day(s) of the week ending. Not scored.";
  header.appendChild(hint);

  block.appendChild(header);

  const list = document.createElement("div");
  list.className = "window-habits-list";
  due.forEach(rt => list.appendChild(renderNowHabitRow(rt)));
  block.appendChild(list);
  return block;
}

function renderNowHabitRow(rt) {
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

  const folder = folders.find(f => f.id === rt.folder_id);
  const meta = document.createElement("span");
  meta.className = "window-habit-meta";
  meta.textContent = [
    folder ? folder.name : null,
    rt.cadence === "weekly" ? WEEKDAY_LABELS[recurringWeekday(rt)] : "daily",
  ].filter(Boolean).join(" · ");
  row.appendChild(meta);

  return row;
}

function renderWindowBody(win, entries, today, expanded) {
  const body = document.createElement("div");
  body.className = "window-body";

  if (windowPrefs[win.sortPref] === "dodate") {
    renderDoDateBody(body, win, entries, today, expanded);
    return body;
  }

  if (entries.length === 0) {
    body.appendChild(makeEmptyHint(win.empty, "window-empty"));
  } else {
    appendCards(body, entries, win, expanded);
  }
  return body;
}

// Do-date layout: thin dividers between groups; in Now the today group and the rest are two
// drop zones (source "now" only) so a card can be dragged across the boundary.
function renderDoDateBody(body, win, entries, today, expanded) {
  if (win.key === "later") {
    const { withDate, withoutDate } = splitByDoDate(entries, "later", today);
    body.appendChild(makeDateDivider("With a do date", withDate.length, true));
    if (withDate.length) appendCards(body, withDate, win, expanded);
    else body.appendChild(makeEmptyHint("No dated tasks.", "window-zone-empty"));
    body.appendChild(makeDateDivider("No do date", withoutDate.length));
    if (withoutDate.length) appendCards(body, withoutDate, win, expanded);
    else body.appendChild(makeEmptyHint("Everything here has a date.", "window-zone-empty"));
    return;
  }

  const { today: todayGroup, other } = splitByDoDate(entries, "now", today);

  const todayZone = document.createElement("div");
  todayZone.className = "window-date-zone";
  todayZone.dataset.zone = "today";
  todayZone.appendChild(makeDateDivider("Today", todayGroup.length, true));
  if (todayGroup.length) appendCards(todayZone, todayGroup, win, expanded);
  else todayZone.appendChild(makeEmptyHint("Drop a card here to plan it for today.", "window-zone-empty"));
  wireDropZone(todayZone, source => source === "now", task => {
    if (task.do_date !== today) addToNow(task, { manual: true });
  });
  body.appendChild(todayZone);

  const otherZone = document.createElement("div");
  otherZone.className = "window-date-zone";
  otherZone.dataset.zone = "other";
  if (other.length) {
    other.forEach(group => {
      otherZone.appendChild(makeDateDivider(group.label, group.entries.length));
      appendCards(otherZone, group.entries, win, expanded);
    });
  } else {
    otherZone.appendChild(makeDateDivider("Later dates", 0));
    otherZone.appendChild(makeEmptyHint("Drop a card here to clear its today status.", "window-zone-empty"));
  }
  wireDropZone(otherZone, source => source === "now", task => {
    if (task.do_date === today) clearDoToday(task);
  });
  body.appendChild(otherZone);
}

// Cards, nested inside folder groups when that toggle is on.
function appendCards(container, entries, win, expanded) {
  if (windowPrefs[win.groupPref] === "folder") {
    groupEntriesByFolder(entries).forEach(group => {
      const head = document.createElement("div");
      head.className = "window-group-header";
      head.textContent = group.name + " · " + group.entries.length;
      container.appendChild(head);
      group.entries.forEach(entry => container.appendChild(renderWindowCard(entry, win, expanded)));
    });
  } else {
    entries.forEach(entry => container.appendChild(renderWindowCard(entry, win, expanded)));
  }
}

function makeDateDivider(label, count, first) {
  const div = document.createElement("div");
  div.className = "window-date-divider" + (first ? " window-date-divider-first" : "");
  div.textContent = label + " · " + count;
  return div;
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
    if (inFolder.length) groups.push({ name: folder.name, entries: inFolder });
  });
  const known = new Set(folders.map(f => f.id));
  const unfiled = entries.filter(e => !known.has(e.task.folder_id));
  if (unfiled.length) groups.push({ name: "Unfiled", entries: unfiled });
  return groups;
}

// One task card. Same heat-map as everywhere else: hue from the live quadrant, --p from
// priority intensity. Compact = checkbox, title, tag (and the hover pencil). Expanded adds
// the meta line, inline date inputs and the quick-win chip. Quick wins render slimmer.
function renderWindowCard(entry, win, expanded) {
  const { task, assessment } = entry;
  const today = todayISODate();
  const card = document.createElement("div");
  card.className = "window-card quadrant-" + assessment.quadrant.key
    + (task.is_quick_win ? " window-card-quick" : "")
    + (expanded ? " window-card-expanded" : "");
  card.dataset.taskId = task.id;
  card.style.setProperty("--p", assessment.intensity.toFixed(3));
  card.title = [
    assessment.quadrant.label + " · priority " + assessment.priorityScore,
    "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ")",
    "importance " + task.importance,
    task.deadline ? "due " + task.deadline : "no deadline",
    task.do_date ? "planned " + task.do_date : null,
    task.is_quick_win ? "quick win" : null,
  ].filter(Boolean).join(" · ");
  makeTaskDraggable(card, task, win.key);

  const children = tasks.filter(t => t.parent_task_id === task.id);
  if (children.length > 0) card.appendChild(makeSubtaskCaret(task));

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "window-card-check";
  checkbox.checked = false;
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => toggleTaskDone(task));
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
  body.appendChild(titleLine);

  if (children.length > 0) body.appendChild(renderSubtaskProgress(children));

  if (expanded) {
    const meta = document.createElement("span");
    meta.className = "window-card-meta";
    const context = taskContextLabel(task);
    meta.textContent = [
      context || null,
      assessment.quadrant.label,
      assessment.urgency.reason,
      task.deadline ? "due " + task.deadline : null,
    ].filter(Boolean).join(" · ");
    body.appendChild(meta);
    body.appendChild(renderInlineDates(task, card));
  }

  if (children.length > 0 && !collapsedTasks.has(task.id)) {
    body.appendChild(renderCardSubtasks(children, win, today));
  }

  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "window-card-actions";

  if (expanded) {
    // Quick-win chip: toggles the display tag. Not a "touch" — it changes nothing about the
    // task's scheduling, so it must not reset the staleness clock.
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "window-chip" + (task.is_quick_win ? " active" : "");
    chip.textContent = task.is_quick_win ? "quick win" : "tackle";
    chip.title = task.is_quick_win ? "Quick win — click to mark as something to tackle" : "Need to tackle — click to mark as a quick win";
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

  card.appendChild(actions);
  return card;
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
  row.className = "window-subtask" + (task.status === "done" ? " done" : "");
  const grandchildren = tasks.filter(t => t.parent_task_id === task.id);

  if (task.status === "active") {
    const assessment = assessTask(task, settings, today);
    row.classList.add("quadrant-" + assessment.quadrant.key);
    row.style.setProperty("--p", assessment.intensity.toFixed(3));
    row.title = assessment.quadrant.label + " · priority " + assessment.priorityScore + " · urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ")";
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
  checkbox.checked = task.status === "done";
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => toggleTaskDone(task));
  head.appendChild(checkbox);

  const titleLine = document.createElement("span");
  titleLine.className = "window-subtask-title-line";
  const title = document.createElement("span");
  title.className = "window-subtask-title";
  title.textContent = task.title;
  titleLine.appendChild(title);
  appendTagBadge(titleLine, task, today);
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
  return row;
}

// Inline do_date / deadline inputs (expanded cards only). While the pointer is over an input
// the card stops being draggable, otherwise Chrome starts a drag instead of opening the picker.
function renderInlineDates(task, card) {
  const wrap = document.createElement("div");
  wrap.className = "window-card-dates";

  const make = (labelText, value, onChange) => {
    const label = document.createElement("label");
    label.className = "window-card-date";
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "date";
    input.value = value || "";
    input.addEventListener("pointerenter", () => { card.draggable = false; });
    input.addEventListener("pointerleave", () => { card.draggable = true; });
    input.addEventListener("change", () => onChange(input.value));
    label.appendChild(input);
    return label;
  };

  wrap.appendChild(make("Do", task.do_date, value => inlineSetDoDate(task, value)));
  wrap.appendChild(make("Due", task.deadline, value => inlineSetDeadline(task, value)));
  return wrap;
}

// Empty-Now suggestion box: the top 3 Later tasks by priority, boxed up with an "Add all N"
// button. Cards are the real renderWindowCard, source "later" — draggable into Now exactly
// like any other Later card; the box is just a highlighted second look at them.
function renderSuggestionBox(suggested, expanded) {
  const box = document.createElement("div");
  box.className = "window-suggestion";

  const header = document.createElement("div");
  header.className = "window-suggestion-header";

  const label = document.createElement("span");
  label.className = "window-suggestion-label";
  label.textContent = "Now is empty — top " + suggested.length + " from Later";
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

  const members = ranked.filter(entry => WINDOWS.now.member(entry, today) && entry.task.do_date === today);
  const entries = topLevelEntries(sortWindowEntries(members, windowPrefs.nowSort));
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

// Puts a task in Now for today. `manual` = the user did it (drag, "+ Add task", the divider
// drag), which makes it a quick win by default and counts as a genuine edit (touches
// last_touched_at). A manual add of a task with no deadline first asks for one (Now-window
// deadline prompt), so nothing can roll forward in Now indefinitely with nothing else forcing
// it to surface. Returns a promise resolving once the add (or its prompt) settles, so callers
// that chain several adds (the empty-Now "Add all N" suggestion) can await it.
function addToNow(task, opts) {
  const manual = !!(opts && opts.manual);
  const today = todayISODate();
  if (task.status !== "active" || task.do_date === today) return Promise.resolve();

  const finish = () => {
    task.do_date = today;
    if (manual) {
      task.is_quick_win = true;
      task.last_touched_at = new Date().toISOString();
    }
    persist();
    render();
  };

  if (manual && !task.deadline) {
    return promptForDeadline(task, NOW_DEADLINE_PROMPT).then(date => {
      if (!date) return; // cancelled: leave the task where it was
      task.deadline = date;
      finish();
    });
  }
  finish();
  return Promise.resolve();
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
// Returns a promise, like addToNow.
function deprioritize(task) {
  const today = todayISODate();
  if (task.status !== "active" || !isNowMember(task, assessTask(task, settings, today), today)) return Promise.resolve();

  if (isDeadlineDriven(task, settings, today)) {
    return promptForDeadline(task, {
      heading: "Pick a new deadline",
      text: "This is in Now because its deadline is close. Commit to a new date before it leaves:",
      confirmLabel: "Reschedule",
      defaultDate: addDaysISODate(today, Math.max(0, Math.round(settings.deadline_medium_days))),
    }).then(date => {
      if (!date) return; // cancelled: it stays
      task.deadline = date;
      task.do_date = date;
      task.last_touched_at = new Date().toISOString();
      persist();
      render();
    });
  }

  task.do_date = task.deadline || null;
  task.last_touched_at = new Date().toISOString();
  persist();
  render();
  showBackfillIfNeeded(); // an undated High/Critical task that just settled into Plan needs a deadline
  return Promise.resolve();
}

// The lighter divider-drag action (Do date sort, Now): clears "today" status only. No prompt,
// no touch — the live quadrant decides whether the task stays in Now (still urgent underneath)
// or leaves (today was its only reason).
function clearDoToday(task) {
  if (task.do_date !== todayISODate()) return;
  task.do_date = task.deadline || null;
  persist();
  render();
}

function toggleQuickWin(task) {
  task.is_quick_win = !task.is_quick_win;
  persist();
  render();
}

// Inline do_date edit (expanded cards). A genuine edit, so it touches last_touched_at. Setting
// a date on a deadline-less task runs the same deadline prompt as adding to Now would.
function inlineSetDoDate(task, value) {
  const next = value || null;
  if (next === (task.do_date || null)) return;
  const finish = () => {
    task.do_date = next;
    task.last_touched_at = new Date().toISOString();
    persist();
    render();
  };
  if (next && !task.deadline) {
    promptForDeadline(task, NOW_DEADLINE_PROMPT).then(date => {
      if (!date) { render(); return; } // cancelled: re-render puts the old value back
      task.deadline = date;
      finish();
    });
    return;
  }
  finish();
}

// Inline deadline edit (expanded cards). Same rules as the task form: a newly set deadline
// defaults do_date (if empty), and the deadline requirement blocks leaving a High/Critical
// task dateless in Plan. Editing the deadline here before dragging out sidesteps the
// reschedule prompt entirely — the deadline's already been dealt with.
function inlineSetDeadline(task, value) {
  const next = value || null;
  if (next === (task.deadline || null)) return;
  const now = new Date().toISOString();
  const candidate = Object.assign({}, task, { deadline: next, last_touched_at: now });
  if (isDeadlineViolator(candidate, todayISODate())) {
    alert("High/Critical tasks need a deadline — without one this would sit in Plan with no target. Set a date (a generous one is fine) or lower the importance.");
    render();
    return;
  }
  task.deadline = next;
  if (next) applyDeadlineDefault(task);
  task.last_touched_at = now;
  persist();
  render();
}

// Inline importance edit (the Overview's expanded priority list). Same deadline requirement
// as the form: raising a dateless task to High/Critical while it would sit in Plan is blocked.
function inlineSetImportance(task, value) {
  if (!IMPORTANCE_SCORES[value] || value === task.importance) return;
  const now = new Date().toISOString();
  const candidate = Object.assign({}, task, { importance: value, last_touched_at: now });
  if (isDeadlineViolator(candidate, todayISODate())) {
    alert("High/Critical tasks need a deadline — without one this would sit in Plan with no target. Set a deadline first (a generous one is fine).");
    render();
    return;
  }
  task.importance = value;
  task.last_touched_at = now;
  persist();
  render();
}

// Now's "+ Add task": the task form, prefilled as a quick win planned for today with the
// Now-window default deadline already in place (editable before saving).
function addTaskToNowDirectly() {
  if (folders.length === 0) {
    alert("Add a folder first.");
    return;
  }
  const candidates = activeCategoryFilter !== "all" ? folders.filter(f => f.category_id === activeCategoryFilter) : folders;
  openTaskModal({
    folder_id: (candidates[0] || folders[0]).id,
    do_date: todayISODate(),
    is_quick_win: true,
    deadline: defaultNowDeadline(),
  });
}

// Later's "+ Add task": the plain shared form, no special prefill — unlike Now there's no
// single default (Plan vs. Backlog falls out of importance/urgency after the fact, not a
// choice made upfront). The existing deadline requirement (High/Critical can't sit in Plan
// without one) already applies on save, nothing extra needed here.
function addTaskToLaterDirectly() {
  if (folders.length === 0) {
    alert("Add a folder first.");
    return;
  }
  const candidates = activeCategoryFilter !== "all" ? folders.filter(f => f.category_id === activeCategoryFilter) : folders;
  openTaskModal({ folder_id: (candidates[0] || folders[0]).id });
}

// ---------- Deadline prompt ----------
// One small modal, two uses: "Set a deadline" when a task enters Now without one, and "Pick a
// new deadline" when a deadline-driven task is dragged out. Resolves with the chosen
// "YYYY-MM-DD" or null on cancel. Only one can be open at a time; opening another cancels it.

const NOW_DEADLINE_PROMPT = Object.freeze({
  heading: "Set a deadline",
  text: "Anything in Now needs a real deadline, so it can't roll forward forever unnoticed. Set one for",
  confirmLabel: "Add to Now",
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
// Now — so dragging a list row and dropping it back on the list is a no-op); and, in Do date
// sort, the today / other zones inside Now (the divider drag, source "now" only).

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
// accepted dragover/drop stops propagating, so a zone nested inside another (the divider
// zones inside the Now window, the focus panel inside its backdrop) is the only one that acts.
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
    const task = tasks.find(t => t.id === (id || dragState.taskId));
    dragState = null;
    if (task) onDrop(task);
  });
}

wireDropZone(document.getElementById("now-window"), source => source !== "now", task => addToNow(task, { manual: true }));
wireDropZone(document.getElementById("later-window"), source => source === "now", task => deprioritize(task));
wireDropZone(document.getElementById("folder-list"), source => source === "now", task => deprioritize(task));
// Focus mode: the dimmed backdrop, not the panel itself, is the drop target.
wireDropZone(focusOverlay, (source, e) => source === "now" && !focusPanel.contains(e.target), task => deprioritize(task));

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WINDOW_SORT_KEYS, WINDOW_GROUP_MODES, compareDoDates, sortWindowEntries, splitByDoDate, groupEntriesByFolder, topLevelEntries };
}
