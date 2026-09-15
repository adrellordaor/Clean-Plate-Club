// List view — categories, folders, nested tasks, add/edit/delete, category filter.
// Data is persisted through storage.js (folder file via File System Access API, IndexedDB fallback).

// Random ids so tasks created on two devices before a OneDrive sync can't collide.
function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DATA_VERSION = 4; // v3: settings object (urgency thresholds); v4: quadrantHistory (daily digest)

// Minimalist outline icons (stroke = currentColor, so they inherit button text color).
const SVG_ATTRS = 'viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  pencil: `<svg ${SVG_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  trash: `<svg ${SVG_ATTRS}><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
  sun: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>`,
  moon: `<svg ${SVG_ATTRS}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`,
  gear: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  bump: `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`,
};

let categories = []; // Category: top-level grouping, drives the tabs.
let folders = [];    // Folder: a named grouping within a category (e.g. "Finances" inside Errands).
let tasks = [];
let recurringTasks = []; // RecurringTask: singular, resets on schedule, outside the Eisenhower matrix.
let completionLog = [];  // CompletionLog: one row per recurring-task check-off, feeds future history views.
let settings = normalizeSettings(null); // Urgency thresholds etc. (see urgency.js); synced with the data file.
let quadrantHistory = {}; // "YYYY-MM-DD" -> { taskId: quadrantKey }, one end-of-day snapshot per day (see digest.js).

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
    deadline: null,
    importance: "Low",
    manual_urgent_flag: false,
    status: "active",
    completed_at: null,
  }, overrides);
}

function makeRecurringTask(overrides) {
  return Object.assign({
    id: makeId(),
    folder_id: null,
    title: "",
    cadence: "daily", // "daily" | "weekly"
    weekday: null, // 0 (Sun) - 6 (Sat), only meaningful when cadence === "weekly"
    last_completed_date: null, // "YYYY-MM-DD"; checking off sets this to today
  }, overrides);
}

// ---------- Recurring habits ----------
// A RecurringTask is a single row that resets rather than piling up instances.
// "Done for the current period" is derived from last_completed_date vs today (daily)
// or the current week (weekly) every render, the same way quadrant is derived rather
// than stored — so nothing needs an explicit daily "reset" scan or migration.

function todayISODate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function startOfWeekISODate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysSinceMonday = (date.getDay() + 6) % 7; // getDay(): 0=Sun..6=Sat, so Mon=0 days back
  date.setDate(date.getDate() - daysSinceMonday); // back up to Monday
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function isRecurringDoneNow(rt) {
  if (!rt.last_completed_date) return false;
  const today = todayISODate();
  if (rt.cadence === "daily") return rt.last_completed_date === today;
  return rt.last_completed_date >= startOfWeekISODate(today) && rt.last_completed_date <= today;
}

function toggleRecurringTask(rt) {
  if (isRecurringDoneNow(rt)) {
    const loggedDate = rt.last_completed_date;
    completionLog = completionLog.filter(l => !(l.recurring_task_id === rt.id && l.completed_date === loggedDate));
    rt.last_completed_date = null;
  } else {
    const today = todayISODate();
    rt.last_completed_date = today;
    completionLog.push({ id: makeId(), recurring_task_id: rt.id, completed_date: today });
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

// ---------- Views ----------
// "list" is where work happens; "matrix" is the read-only orientation glance. Which one is
// showing is a per-device preference (like theme), not synced task data.

let activeView = localStorage.getItem("view") === "matrix" ? "matrix" : "list";

function setActiveView(view) {
  activeView = view === "matrix" ? "matrix" : "list";
  localStorage.setItem("view", activeView);
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
  document.getElementById("list-view").hidden = !isList;
  document.getElementById("folder-tabs").hidden = !isList;
  document.getElementById("top-banner").hidden = !isList;
  document.getElementById("matrix-view").hidden = isList;
}

// ---------- Rendering ----------

function render() {
  renderViewSwitch();
  renderCategoryTabs();
  renderTopBanner();
  renderHeatMapLegend();
  renderFolderList();
  renderRecurringSidebar();
  renderMatrixView();
}

// ---------- Matrix / Digest view ----------
// Read-only: no checkboxes, no edit/delete, nothing to click. Only regular Tasks appear;
// RecurringTasks have no importance/urgency/quadrant and never show up here.

// Grid placement follows the spec table: rows are importance (high on top), columns are
// urgency (high on the right), so Do sits top-right and Backlog bottom-left. The actual
// cell positions are pinned in CSS (.matrix-cell-q*), this is just the DOM order.
const MATRIX_LAYOUT = [QUADRANTS.q2, QUADRANTS.q1, QUADRANTS.q4, QUADRANTS.q3];

function renderMatrixView() {
  if (activeView !== "matrix") return; // nothing visible to draw; skip the work
  const today = todayISODate();
  renderMatrixGrid(today);
  renderDigest(today);
}

function renderMatrixGrid(today) {
  const grid = document.getElementById("matrix-grid");
  grid.innerHTML = "";

  const byQuadrant = { q1: [], q2: [], q3: [], q4: [] };
  tasks
    .filter(t => t.status === "active")
    .forEach(task => {
      const assessment = assessTask(task, settings, today);
      byQuadrant[assessment.quadrant.key].push({ task, assessment });
    });
  Object.values(byQuadrant).forEach(list => list.sort((a, b) => b.assessment.priorityScore - a.assessment.priorityScore));

  // Axis labels: corner, two column heads (urgency), then each row's head (importance).
  grid.appendChild(makeMatrixAxis("matrix-corner", ""));
  grid.appendChild(makeMatrixAxis("matrix-axis matrix-axis-col matrix-axis-col-low", "Urgency low / medium"));
  grid.appendChild(makeMatrixAxis("matrix-axis matrix-axis-col matrix-axis-col-high", "Urgency high / critical"));

  MATRIX_LAYOUT.forEach((quadrant, i) => {
    if (i % 2 === 0) {
      const high = quadrant.importance === "high";
      grid.appendChild(makeMatrixAxis(
        "matrix-axis matrix-axis-row " + (high ? "matrix-axis-row-high" : "matrix-axis-row-low"),
        high ? "Importance high / critical" : "Importance low / medium"
      ));
    }
    grid.appendChild(renderMatrixCell(quadrant, byQuadrant[quadrant.key]));
  });
}

function makeMatrixAxis(className, text) {
  const el = document.createElement("div");
  el.className = className;
  if (text) {
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
  }
  return el;
}

function renderMatrixCell(q, entries) {
  const cell = document.createElement("section");
  cell.className = "matrix-cell matrix-cell-" + q.key + " quadrant-" + q.key;
  cell.style.setProperty("--p", "1");

  const header = document.createElement("header");
  header.className = "matrix-cell-header";

  const label = document.createElement("h2");
  label.className = "matrix-cell-label";
  label.textContent = q.label;
  header.appendChild(label);

  const hint = document.createElement("span");
  hint.className = "matrix-cell-hint";
  hint.textContent = (q.importance === "high" ? "important" : "less important") + " · " + (q.urgency === "high" ? "urgent" : "not urgent");
  header.appendChild(hint);

  const count = document.createElement("span");
  count.className = "matrix-cell-count";
  count.textContent = entries.length;
  header.appendChild(count);

  cell.appendChild(header);

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "Nothing here.";
    cell.appendChild(empty);
    return cell;
  }

  const ul = document.createElement("ul");
  ul.className = "matrix-list";
  entries.forEach(({ task, assessment }) => ul.appendChild(renderMatrixItem(task, assessment)));
  cell.appendChild(ul);
  return cell;
}

function renderMatrixItem(task, assessment) {
  const li = document.createElement("li");
  li.className = "matrix-item quadrant-" + assessment.quadrant.key;
  li.style.setProperty("--p", assessment.intensity.toFixed(3));
  li.title = [
    "priority " + assessment.priorityScore,
    "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ")",
    "importance " + task.importance,
    task.deadline ? "due " + task.deadline : null,
  ].filter(Boolean).join(" · ");

  const title = document.createElement("span");
  title.className = "matrix-item-title";
  title.textContent = task.title;
  li.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "matrix-item-meta";
  meta.textContent = taskContextLabel(task);
  li.appendChild(meta);

  const score = document.createElement("span");
  score.className = "matrix-item-score";
  score.textContent = assessment.priorityScore;
  li.appendChild(score);

  return li;
}

// "Folder" for a top-level task, "Folder › Parent" for a subtask.
function taskContextLabel(task) {
  const folder = folders.find(f => f.id === task.folder_id);
  const parent = task.parent_task_id ? tasks.find(t => t.id === task.parent_task_id) : null;
  return [folder ? folder.name : null, parent ? parent.title : null].filter(Boolean).join(" › ");
}

function renderDigest(today) {
  const container = document.getElementById("digest");
  container.innerHTML = "";

  const digest = buildDigest(quadrantHistory, tasks, settings, today);

  const heading = document.createElement("h2");
  heading.className = "digest-heading";
  heading.textContent = "What changed since " + (digest.baseline ? describeBaseline(digest.baseline) : "yesterday");
  container.appendChild(heading);

  const sub = document.createElement("p");
  sub.className = "digest-sub";

  if (!digest.baseline) {
    sub.textContent = "No earlier day to compare against yet. Today's quadrants are saved as you go; changes show up from tomorrow.";
    container.appendChild(sub);
    return;
  }

  const total = digest.moved.length + digest.entered.length + digest.left.length;
  if (total === 0) {
    sub.textContent = "No quadrant changes. Everything is where it was at the end of " + digest.baseline.date + ".";
    container.appendChild(sub);
    return;
  }

  sub.textContent = [
    digest.moved.length ? digest.moved.length + " moved" : null,
    digest.entered.length ? digest.entered.length + " new" : null,
    digest.left.length ? digest.left.length + " finished" : null,
  ].filter(Boolean).join(" · ") + " · compared with the end of " + digest.baseline.date;
  container.appendChild(sub);

  const ul = document.createElement("ul");
  ul.className = "digest-list";
  digest.moved.forEach(change => ul.appendChild(renderDigestLine(change.task, change.from, change.to, change.reason)));
  digest.entered.forEach(change => ul.appendChild(renderDigestLine(change.task, null, change.to, change.reason)));
  digest.left.forEach(change => ul.appendChild(renderDigestLine(change.task, change.from, null, change.status === "done" ? "completed" : "dropped")));
  container.appendChild(ul);
}

// One line: [from] → [to]  Title · reason. `from` null = entered the matrix, `to` null = left it.
function renderDigestLine(task, from, to, reason) {
  const li = document.createElement("li");
  li.className = "digest-line";

  li.appendChild(makeDigestChip(from, "new"));

  const arrow = document.createElement("span");
  arrow.className = "digest-arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");
  li.appendChild(arrow);

  li.appendChild(makeDigestChip(to, "done"));

  const text = document.createElement("span");
  text.className = "digest-text";

  const title = document.createElement("span");
  title.className = "digest-title";
  title.textContent = task.title;
  text.appendChild(title);

  const context = taskContextLabel(task);
  if (context) {
    const ctx = document.createElement("span");
    ctx.className = "digest-context";
    ctx.textContent = context;
    text.appendChild(ctx);
  }

  const why = document.createElement("span");
  why.className = "digest-reason";
  why.textContent = (to ? to.label + ": " : "") + reason;
  text.appendChild(why);

  li.appendChild(text);
  return li;
}

function makeDigestChip(quadrant, fallbackText) {
  const chip = document.createElement("span");
  if (quadrant) {
    chip.className = "digest-chip quadrant-" + quadrant.key;
    chip.style.setProperty("--p", "1");
    chip.textContent = quadrant.label;
  } else {
    chip.className = "digest-chip digest-chip-neutral";
    chip.textContent = fallbackText;
  }
  return chip;
}

// Top priority banner: top 3-5 tasks by priority_score across ALL folders/categories,
// independent of activeCategoryFilter, so the highest-priority items are never scrolled
// out of view or hidden by whichever tab happens to be selected. Lives in the sticky
// header so it stays visible while scrolling the list below. Recurring tasks never
// appear here — only regular Tasks carry a priority_score.
const TOP_BANNER_MAX = 5;

function renderTopBanner() {
  const banner = document.getElementById("top-banner");
  banner.innerHTML = "";

  const ranked = tasks
    .filter(t => t.status === "active")
    .map(task => ({ task, assessment: assessTask(task, settings, todayISODate()) }))
    .sort((a, b) => b.assessment.priorityScore - a.assessment.priorityScore)
    .slice(0, TOP_BANNER_MAX);

  banner.classList.toggle("has-items", ranked.length > 0);
  // With fewer than 3-5 active tasks total there's no real "top" to distinguish from the
  // rest; show whatever exists rather than an empty strip, and skip the banner entirely
  // once there are zero active tasks.
  if (ranked.length === 0) return;

  const label = document.createElement("span");
  label.className = "top-banner-label";
  label.textContent = "Top priority";
  banner.appendChild(label);

  const strip = document.createElement("div");
  strip.className = "top-banner-strip";
  ranked.forEach(({ task, assessment }) => strip.appendChild(renderTopBannerCard(task, assessment)));
  banner.appendChild(strip);
}

function renderTopBannerCard(task, assessment) {
  const folder = folders.find(f => f.id === task.folder_id);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "top-banner-card quadrant-" + assessment.quadrant.key;
  card.style.setProperty("--p", assessment.intensity.toFixed(3));
  card.title = [
    assessment.quadrant.label,
    "priority " + assessment.priorityScore,
    "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ")",
    task.deadline ? "due " + task.deadline : null,
  ].filter(Boolean).join(" · ");
  card.addEventListener("click", () => openTaskModal(task));

  const title = document.createElement("span");
  title.className = "top-banner-title";
  title.textContent = task.title;
  card.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "top-banner-meta";
  meta.textContent = (folder ? folder.name + " · " : "") + assessment.quadrant.label;
  card.appendChild(meta);

  const score = document.createElement("span");
  score.className = "top-banner-score";
  score.textContent = "priority " + assessment.priorityScore;
  card.appendChild(score);

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
}

function renderFolderSection(folder) {
  const topLevelTasks = tasks.filter(t => t.folder_id === folder.id && !t.parent_task_id);

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

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "link-btn";
  addLink.textContent = "+ Add task";
  addLink.addEventListener("click", () => openTaskModal({ folder_id: folder.id }));
  body.appendChild(addLink);

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

  const row = document.createElement("div");
  row.className = "task-row" + (task.status === "done" ? " done" : "");

  // Heat-map tint only applies to live tasks; done/dropped rows stay neutral. The quadrant
  // class picks the hue, --p (0-1 intensity from priority_score) drives saturation/lightness
  // in CSS, so the colour maths stays theme-aware without a re-render on theme toggle.
  const assessment = task.status === "active" ? assessTask(task, settings, todayISODate()) : null;
  if (assessment) {
    row.classList.add("quadrant-" + assessment.quadrant.key);
    row.style.setProperty("--p", assessment.intensity.toFixed(3));
  }

  const children = tasks.filter(t => t.parent_task_id === task.id);
  const isCollapsed = collapsedTasks.has(task.id);

  if (children.length > 0) {
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
  checkbox.checked = task.status === "done";
  checkbox.addEventListener("change", () => toggleTaskDone(task));
  row.appendChild(checkbox);

  const main = document.createElement("div");
  main.className = "task-main";

  const titleLine = document.createElement("div");
  titleLine.className = "task-title-line";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  titleLine.appendChild(title);

  if (task.manual_urgent_flag) {
    titleLine.appendChild(makeBadge("Urgent", "badge-urgent"));
  }
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

  if (children.length > 0) {
    const subtaskContainer = document.createElement("div");
    subtaskContainer.className = "subtask-container" + (isCollapsed ? " collapsed" : "");
    subtaskContainer.appendChild(renderTaskList(children));
    main.appendChild(subtaskContainer);
  }

  const addSub = document.createElement("button");
  addSub.type = "button";
  addSub.className = "link-btn add-subtask-row";
  addSub.textContent = "+ Add subtask";
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

  if (task.status === "active") {
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

// One line under the title showing just the quadrant label; the numbers behind it
// (priority, urgency + reason, deadline) live in the tooltip.
function renderUrgencyMeta(task, assessment) {
  const meta = document.createElement("div");
  meta.className = "task-meta task-urgency-meta";

  const quadrant = document.createElement("span");
  quadrant.className = "quadrant-label";
  quadrant.textContent = assessment.quadrant.label;
  const parts = [
    "priority " + assessment.priorityScore,
    "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ")",
  ];
  if (task.deadline) parts.push("due " + task.deadline);
  quadrant.title = parts.join(" · ");
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

  const label = document.createElement("span");
  label.className = "subtask-progress-text";
  label.textContent = percent + "%";
  wrap.appendChild(label);

  return wrap;
}

// ---------- Recurring sidebar (Weekly/Daily boxes) ----------
// Fully separate from the folder/matrix system: no importance, urgency, or heat-map
// coloring applies here, just a folder-grouped checklist with a completion fraction.

function renderRecurringSidebar() {
  renderRecurringBox("weekly", "recurring-weekly", "Weekly");
  renderRecurringBox("daily", "recurring-daily", "Daily");
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

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "link-btn";
  addLink.textContent = "+ Add";
  addLink.addEventListener("click", () => openRecurringModal({ cadence }));
  body.appendChild(addLink);

  container.appendChild(body);
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

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "link-btn";
  addLink.textContent = "+ Add";
  addLink.addEventListener("click", () => openRecurringModal({ cadence, folder_id: folder.id }));
  body.appendChild(addLink);

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

  if (rt.cadence === "weekly" && rt.weekday != null) {
    titleLine.appendChild(makeBadge(WEEKDAY_LABELS[rt.weekday], "badge-recurring"));
  }

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

function openTaskModal(prefillOrTask) {
  const isEdit = tasks.some(t => t.id === prefillOrTask.id);
  document.getElementById("task-modal-title").textContent = isEdit ? "Edit Task" : "Add Task";

  populateFolderSelectInto(taskFolderSelect, prefillOrTask.folder_id);
  populateParentSelect(prefillOrTask.folder_id, isEdit ? prefillOrTask.id : null, prefillOrTask.parent_task_id);

  document.getElementById("task-id").value = isEdit ? prefillOrTask.id : "";
  document.getElementById("task-title").value = isEdit ? prefillOrTask.title : "";
  document.getElementById("task-notes").value = isEdit ? prefillOrTask.notes : "";
  document.getElementById("task-deadline").value = isEdit ? (prefillOrTask.deadline || "") : "";
  document.getElementById("task-importance").value = isEdit ? prefillOrTask.importance : "Low";
  document.getElementById("task-urgent-flag").checked = isEdit ? prefillOrTask.manual_urgent_flag : false;

  taskFolderSelect.value = prefillOrTask.folder_id || folders[0]?.id || "";
  taskParentSelect.value = prefillOrTask.parent_task_id || "";

  taskModal.classList.remove("hidden");
  document.getElementById("task-title").focus();
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  taskForm.reset();
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

taskForm.addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("task-id").value;
  const data = {
    folder_id: taskFolderSelect.value,
    parent_task_id: taskParentSelect.value || null,
    title: document.getElementById("task-title").value.trim(),
    notes: document.getElementById("task-notes").value.trim(),
    deadline: document.getElementById("task-deadline").value || null,
    importance: document.getElementById("task-importance").value,
    manual_urgent_flag: document.getElementById("task-urgent-flag").checked,
  };

  if (!data.title) return;

  const existing = id ? tasks.find(t => t.id === id) : null;
  if (existing) {
    Object.assign(existing, data);
    existing.last_touched_at = new Date().toISOString();
  } else {
    tasks.push(makeTask(data));
  }

  closeTaskModal();
  persist();
  render();
});

document.getElementById("task-cancel-btn").addEventListener("click", closeTaskModal);
document.getElementById("add-task-btn").addEventListener("click", () => {
  if (folders.length === 0) {
    alert("Add a folder first.");
    return;
  }
  const candidates = activeCategoryFilter !== "all"
    ? folders.filter(f => f.category_id === activeCategoryFilter)
    : folders;
  const folderId = (candidates[0] || folders[0]).id;
  openTaskModal({ folder_id: folderId });
});

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

document.getElementById("add-folder-btn").addEventListener("click", openFolderModal);
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

function updateRecurringWeekdayVisibility() {
  recurringWeekdayLabel.hidden = recurringCadenceSelect.value !== "weekly";
}

recurringCadenceSelect.addEventListener("change", updateRecurringWeekdayVisibility);

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
  recurringWeekdaySelect.value = isEdit && prefillOrRt.weekday != null ? prefillOrRt.weekday : new Date().getDay();
  updateRecurringWeekdayVisibility();

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
    weekday: recurringCadenceSelect.value === "weekly" ? Number(recurringWeekdaySelect.value) : null,
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

document.getElementById("add-category-btn").addEventListener("click", openCategoryModal);
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
  persistIfSnapshotChanged(); // first open of the day: freeze yesterday, start today's snapshot
  render();
  renderStorageBar();
}

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
    persistIfSnapshotChanged();
  }
  render();
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
    persistIfSnapshotChanged();
    render();
    scheduleMidnightRender();
  }, next - now);
}
scheduleMidnightRender();

// ---------- Init ----------

storage.onStatusChange = renderStorageBar;
runStorageAction(() => storage.init());
