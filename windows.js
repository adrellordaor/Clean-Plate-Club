// Now / Later windows: the two side-by-side "intention" panels at the top of the List view.
//
//   Now   — membership is do_date == today (and not yet completed): what you told yourself
//           to get done today. Populated by hand (drag a task in, its own "+ Add task", or
//           type a do_date in the task form) and automatically, once, on the day a task's
//           urgency crosses into the High/Critical bucket (runDailyMaintenance in app.js).
//           Being in Now floors the task's urgency (do_today_urgency_floor), which is what
//           moves it into Do or Clear rather than merely making it look more urgent.
//   Later — the long-view counterpart: every active task whose live quadrant is Plan or
//           Backlog, i.e. genuinely "not needed today", for two different reasons. Tasks keep
//           their own quadrant hue (teal / gray); this is a filtered view, not a new scheme.
//           Has its own "+ Add task" too, opening the plain shared form with no prefill —
//           unlike Now, Plan vs. Backlog falls out of importance/urgency after the fact, not
//           a choice made upfront.
//
// Both windows share a sort-key control (Priority / Urgency / Importance / Quick win) and a
// flat-vs-by-folder grouping toggle, kept as per-device preferences in localStorage (like
// the theme and folderCountDisplay). Either window can be expanded to take more width.
//
// Empty-Now suggestion: whenever Now has zero tasks (checked live on every render, never a
// stored/dismissible flag), the Later window gets a highlighted box around its top 3 tasks
// by priority (independent of whatever sort/group Later is currently set to), plus an
// "Add all N" button chaining addToNow across them. The box vanishes the instant Now stops
// being empty, from that button, a drag, or anything else — there's no state to clear.
//
// Reads app.js state (tasks, folders, settings, activeView, todayISODate, persist, render,
// openTaskModal, toggleTaskDone, defaultNowDeadline, ICONS) and
// overview.js helpers (rankActiveTasks, taskContextLabel) only from inside functions that
// run after every script has loaded — nothing here touches them at parse time.

const WINDOW_SORT_KEYS = [
  { key: "priority", label: "Priority" },
  { key: "urgency", label: "Urgency" },
  { key: "importance", label: "Importance" },
  { key: "quickwin", label: "Quick win" },
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

// ---------- Membership and ordering (pure) ----------

// In the Now window: active with a do_date of today. do_date < today only exists between a
// day change and the next runDailyMaintenance, so it's treated as "today" here too.
function isInNow(task, today) {
  return task.status === "active" && !!task.do_date && task.do_date <= today;
}

// `entries` are { task, assessment } (from rankActiveTasks). Every key falls back to
// priority_score, so the order is stable and "Quick win" groups quick wins first then keeps
// each group priority-sorted, as the spec asks.
function sortWindowEntries(entries, key) {
  const byPriority = (a, b) => b.assessment.priorityScore - a.assessment.priorityScore;
  const sorted = entries.slice();
  if (key === "urgency") {
    sorted.sort((a, b) => b.assessment.urgency.score - a.assessment.urgency.score || byPriority(a, b));
  } else if (key === "importance") {
    sorted.sort((a, b) => b.assessment.importanceScore - a.assessment.importanceScore || byPriority(a, b));
  } else if (key === "quickwin") {
    sorted.sort((a, b) => Number(!!b.task.is_quick_win) - Number(!!a.task.is_quick_win) || byPriority(a, b));
  } else {
    sorted.sort(byPriority);
  }
  return sorted;
}

const WINDOWS = {
  now: {
    key: "now", elementId: "now-window", title: "Now", hint: "planned for today",
    sortPref: "nowSort", groupPref: "nowGroup",
    member: (entry, today) => isInNow(entry.task, today),
    empty: "Nothing planned for today. Drag a task here, or add one.",
  },
  later: {
    key: "later", elementId: "later-window", title: "Later", hint: "Plan + Backlog",
    sortPref: "laterSort", groupPref: "laterGroup",
    member: entry => entry.assessment.quadrant.key === "q2" || entry.assessment.quadrant.key === "q4",
    empty: "Nothing in Plan or Backlog.",
  },
};

// ---------- Rendering ----------

function renderNowLaterWindows() {
  if (activeView !== "list") return; // hidden with the rest of the List view; skip the work
  const today = todayISODate();
  const ranked = rankActiveTasks(today);

  const row = document.getElementById("windows-row");
  row.classList.toggle("focus-now", windowPrefs.focus === "now");
  row.classList.toggle("focus-later", windowPrefs.focus === "later");

  const nowIsEmpty = !ranked.some(entry => WINDOWS.now.member(entry, today));

  renderWindow(WINDOWS.now, ranked, today);
  renderWindow(WINDOWS.later, ranked, today, nowIsEmpty);
}

function renderWindow(win, ranked, today, nowIsEmpty) {
  const el = document.getElementById(win.elementId);
  el.innerHTML = "";
  const focused = windowPrefs.focus === win.key;
  el.classList.toggle("window-focused", focused);

  const unsorted = ranked.filter(entry => win.member(entry, today));
  const entries = sortWindowEntries(unsorted, windowPrefs[win.sortPref]);

  // Header: title, count, hint, expand/shrink.
  const header = document.createElement("div");
  header.className = "window-header";

  const title = document.createElement("h2");
  title.className = "window-title";
  title.textContent = win.title;
  header.appendChild(title);

  const count = document.createElement("span");
  count.className = "window-count";
  count.textContent = entries.length;
  header.appendChild(count);

  const hint = document.createElement("span");
  hint.className = "window-hint";
  hint.textContent = win.hint;
  header.appendChild(hint);

  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "btn-icon window-focus-btn";
  focusBtn.innerHTML = focused ? ICONS.minimize : ICONS.maximize;
  focusBtn.title = focused ? "Shrink: back to equal widths" : "Expand: give this window more room";
  focusBtn.setAttribute("aria-label", focused ? "Shrink" : "Expand");
  focusBtn.addEventListener("click", () => setWindowPref("focus", focused ? "none" : win.key));
  header.appendChild(focusBtn);

  el.appendChild(header);

  // Controls: sort key + grouping, two small segmented switches.
  const controls = document.createElement("div");
  controls.className = "window-controls";
  controls.appendChild(makeWindowSwitch(WINDOW_SORT_KEYS, windowPrefs[win.sortPref], key => setWindowPref(win.sortPref, key), win.title + " sort"));
  controls.appendChild(makeWindowSwitch(WINDOW_GROUP_MODES, windowPrefs[win.groupPref], key => setWindowPref(win.groupPref, key), win.title + " grouping"));
  el.appendChild(controls);

  // Empty-Now suggestion (Later only, live-checked every render — see file header).
  if (win.key === "later" && nowIsEmpty) {
    const suggested = sortWindowEntries(unsorted, "priority").slice(0, 3);
    if (suggested.length) el.appendChild(renderSuggestionBox(suggested));
  }

  // Body.
  const body = document.createElement("div");
  body.className = "window-body";
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint window-empty";
    empty.textContent = win.empty;
    body.appendChild(empty);
  } else if (windowPrefs[win.groupPref] === "folder") {
    groupEntriesByFolder(entries).forEach(group => {
      const head = document.createElement("div");
      head.className = "window-group-header";
      head.textContent = group.name + " · " + group.entries.length;
      body.appendChild(head);
      group.entries.forEach(entry => body.appendChild(renderWindowCard(entry, win)));
    });
  } else {
    entries.forEach(entry => body.appendChild(renderWindowCard(entry, win)));
  }
  el.appendChild(body);

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "link-btn window-add";
  addLink.textContent = "+ Add task";
  addLink.addEventListener("click", win.key === "now" ? addTaskToNowDirectly : addTaskToLaterDirectly);
  el.appendChild(addLink);
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
// priority intensity. Quick wins render as the compact variant.
function renderWindowCard(entry, win) {
  const { task, assessment } = entry;
  const card = document.createElement("div");
  card.className = "window-card quadrant-" + assessment.quadrant.key + (task.is_quick_win ? " window-card-quick" : "");
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

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "window-card-check";
  checkbox.checked = false;
  checkbox.setAttribute("aria-label", "Mark done");
  checkbox.addEventListener("change", () => toggleTaskDone(task));
  card.appendChild(checkbox);

  const body = document.createElement("div");
  body.className = "window-card-body";

  const title = document.createElement("span");
  title.className = "window-card-title";
  title.textContent = task.title;
  body.appendChild(title);

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

  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "window-card-actions";

  // Quick-win chip: toggles the display tag. Not a "touch" — it changes nothing about the
  // task's scheduling, so it must not reset the staleness clock.
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "window-chip" + (task.is_quick_win ? " active" : "");
  chip.textContent = task.is_quick_win ? "quick win" : "tackle";
  chip.title = task.is_quick_win ? "Quick win — click to mark as something to tackle" : "Need to tackle — click to mark as a quick win";
  chip.addEventListener("click", () => toggleQuickWin(task));
  actions.appendChild(chip);

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

// Empty-Now suggestion box: the top 3 Later tasks by priority, boxed up with an "Add all N"
// button. Cards are the real renderWindowCard, source "later" — draggable into Now exactly
// like any other Later card; the box is just a highlighted second look at them.
function renderSuggestionBox(suggested) {
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
  suggested.forEach(entry => cards.appendChild(renderWindowCard(entry, WINDOWS.later)));
  box.appendChild(cards);

  return box;
}

// Chains addToNow across the suggested tasks, one at a time — addToNow's deadline prompt can
// only have one open at a time (promptForNowDeadline cancels any prior one), so these must
// resolve in sequence rather than fire concurrently.
async function addSuggestedTasksToNow(tasksToAdd) {
  for (const task of tasksToAdd) {
    await addToNow(task, { manual: true });
  }
}

// ---------- Actions ----------

// Puts a task in Now for today. `manual` = the user did it (drag, "+ Add task"), which
// makes it a quick win by default and counts as a genuine edit (touches last_touched_at).
// A manual add of a task with no deadline first asks for one (Now-window deadline prompt),
// so nothing can roll forward in Now indefinitely with nothing else forcing it to surface.
// Auto-population lives in runDailyMaintenance (app.js) and touches nothing.
// Returns a promise resolving once the add (or its deadline prompt) settles, so callers that
// need to chain several adds in sequence (the empty-Now "Add all N" suggestion) can await it.
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
    return promptForNowDeadline(task).then(date => {
      if (!date) return; // cancelled: leave the task where it was
      task.deadline = date;
      finish();
    });
  }
  finish();
  return Promise.resolve();
}

// Dragging out of Now clears do_date entirely (and with it the urgency floor).
function removeFromNow(task) {
  if (!task.do_date) return;
  task.do_date = null;
  task.last_touched_at = new Date().toISOString();
  persist();
  render();
}

function toggleQuickWin(task) {
  task.is_quick_win = !task.is_quick_win;
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

// ---------- Now-window deadline prompt ----------
// A small modal: "Set a deadline for <task>", date input defaulted to today +
// deadline_high_days, Confirm / Cancel. Resolves with the chosen "YYYY-MM-DD" or null.

const nowDeadlineModal = document.getElementById("now-deadline-modal");
const nowDeadlineForm = document.getElementById("now-deadline-form");
const nowDeadlineInput = document.getElementById("now-deadline-input");
let nowDeadlineResolve = null;

function promptForNowDeadline(task) {
  return new Promise(resolve => {
    if (nowDeadlineResolve) nowDeadlineResolve(null); // a previous prompt still open: cancel it
    nowDeadlineResolve = resolve;
    document.getElementById("now-deadline-task").textContent = task.title;
    nowDeadlineInput.value = defaultNowDeadline();
    nowDeadlineInput.min = todayISODate();
    nowDeadlineModal.classList.remove("hidden");
    nowDeadlineInput.focus();
  });
}

function settleNowDeadline(value) {
  nowDeadlineModal.classList.add("hidden");
  const resolve = nowDeadlineResolve;
  nowDeadlineResolve = null;
  if (resolve) resolve(value);
}

nowDeadlineForm.addEventListener("submit", e => {
  e.preventDefault();
  if (!nowDeadlineInput.value) return;
  settleNowDeadline(nowDeadlineInput.value);
});
document.getElementById("now-deadline-cancel-btn").addEventListener("click", () => settleNowDeadline(null));
nowDeadlineModal.addEventListener("click", e => {
  if (e.target === nowDeadlineModal) settleNowDeadline(null);
});

// ---------- Drag and drop ----------
// HTML5 DnD. Sources: active rows in the main list ("list"), Now cards ("now"), Later cards
// ("later"). Drop zones: the Now window (adds, from anywhere but Now itself) and the main
// list / Later window (removes from Now, only for a drag that started in Now — so dragging
// a list row and dropping it back on the list is a no-op rather than an accidental removal).

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

// `accepts(source)` decides whether this zone lights up for the current drag.
function wireDropZone(el, accepts, onDrop) {
  el.addEventListener("dragover", e => {
    if (!dragState || !accepts(dragState.source)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
  });
  el.addEventListener("drop", e => {
    if (!dragState || !accepts(dragState.source)) return;
    e.preventDefault();
    el.classList.remove("drop-target");
    let id = "";
    try { id = e.dataTransfer.getData(DRAG_MIME); } catch (err) { id = ""; }
    const task = tasks.find(t => t.id === (id || dragState.taskId));
    dragState = null;
    if (task) onDrop(task);
  });
}

wireDropZone(document.getElementById("now-window"), source => source !== "now", task => addToNow(task, { manual: true }));
wireDropZone(document.getElementById("later-window"), source => source === "now", task => removeFromNow(task));
wireDropZone(document.getElementById("folder-list"), source => source === "now", task => removeFromNow(task));

if (typeof module !== "undefined" && module.exports) {
  module.exports = { WINDOW_SORT_KEYS, WINDOW_GROUP_MODES, isInNow, sortWindowEntries, groupEntriesByFolder };
}
