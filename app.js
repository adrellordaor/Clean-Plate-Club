// List view — categories, folders, nested tasks, add/edit/delete, category filter.
// Data is persisted through storage.js (folder file via File System Access API, IndexedDB fallback).

// Random ids so tasks created on two devices before a OneDrive sync can't collide.
function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const IMPORTANCE_VALUES = { Low: 25, Medium: 50, High: 75, Critical: 100 };
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DATA_VERSION = 1;

let categories = []; // Category: top-level grouping, drives the tabs.
let folders = [];    // Folder: a named grouping within a category (e.g. "Finances" inside Errands).
let tasks = [];

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
  generateRecurringInstances();
}

function serializeState() {
  return {
    version: DATA_VERSION,
    saved_at: new Date().toISOString(),
    categories,
    folders,
    tasks,
  };
}

function persist() {
  storage.save(serializeState());
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
    recurrence: "none",
    recurrence_weekday: null, // 0 (Sun) - 6 (Sat), only meaningful when recurrence === "weekly"
    series_id: null, // links regenerated recurring instances back to the same recurring task
    instance_date: null, // "YYYY-MM-DD" day this instance was generated for
    status: "active",
    completed_at: null,
  }, overrides);
}

// ---------- Recurrence engine ----------
// Each recurring task belongs to a "series" (tasks sharing series_id, or a lone task
// keyed by its own id before any instance has regenerated). On its scheduled day, if
// the series has no instance dated today yet — active or completed — a fresh active
// instance is added. Existing instances (done or still open) are never touched here;
// silently carrying over an incomplete task is an Evening Review decision, not this engine's.

function todayISODate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function dateOnly(isoTimestamp) {
  return isoTimestamp ? isoTimestamp.slice(0, 10) : null;
}

function weekdayOfISODate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function generateRecurringInstances() {
  const todayStr = todayISODate();
  const series = new Map(); // seriesId -> tasks

  tasks.forEach(t => {
    if (t.recurrence === "none") return;
    const key = t.series_id || t.id;
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(t);
  });

  let changed = false;

  series.forEach((seriesTasks, seriesId) => {
    const alreadyHasToday = seriesTasks.some(t => (t.instance_date || dateOnly(t.created_at)) === todayStr);
    if (alreadyHasToday) return;

    const template = seriesTasks.reduce((latest, t) => (t.created_at > latest.created_at ? t : latest));

    if (!folders.some(f => f.id === template.folder_id)) return; // folder was deleted, nowhere to place it

    if (template.recurrence === "weekly") {
      if (template.recurrence_weekday === null || template.recurrence_weekday === undefined) return;
      if (weekdayOfISODate(todayStr) !== template.recurrence_weekday) return;
    }

    if (!template.series_id) template.series_id = seriesId;

    const parentStillExists = template.parent_task_id && tasks.some(t => t.id === template.parent_task_id);

    tasks.push(makeTask({
      folder_id: template.folder_id,
      parent_task_id: parentStillExists ? template.parent_task_id : null,
      title: template.title,
      notes: template.notes,
      importance: template.importance,
      recurrence: template.recurrence,
      recurrence_weekday: template.recurrence_weekday,
      series_id: seriesId,
      instance_date: todayStr,
    }));
    changed = true;
  });

  if (changed) persist();
  return changed;
}

let activeCategoryFilter = "all"; // "all" or a category id
let collapsedFolders = new Set();
let collapsedTasks = new Set();

// ---------- Rendering ----------

function render() {
  renderCategoryTabs();
  renderFolderList();
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

  const count = document.createElement("span");
  const activeCount = tasks.filter(t => t.folder_id === folder.id && t.status === "active" && !t.parent_task_id).length;
  count.className = "folder-count";
  count.textContent = activeCount + " active";
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
  if (task.recurrence !== "none") {
    const label = task.recurrence === "weekly" && task.recurrence_weekday != null
      ? "weekly (" + WEEKDAY_LABELS[task.recurrence_weekday] + ")"
      : task.recurrence;
    titleLine.appendChild(makeBadge(label, "badge-recurring"));
  }

  main.appendChild(titleLine);

  if (children.length > 0) {
    main.appendChild(renderSubtaskProgress(children));
  }

  if (task.deadline) {
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
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openTaskModal(task));
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-icon";
  delBtn.style.color = "var(--danger)";
  delBtn.textContent = "Delete";
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
const taskRecurrenceSelect = document.getElementById("task-recurrence");
const taskRecurrenceWeekdaySelect = document.getElementById("task-recurrence-weekday");
const taskRecurrenceWeekdayLabel = document.getElementById("task-recurrence-weekday-label");

function updateRecurrenceWeekdayVisibility() {
  taskRecurrenceWeekdayLabel.hidden = taskRecurrenceSelect.value !== "weekly";
}

taskRecurrenceSelect.addEventListener("change", updateRecurrenceWeekdayVisibility);

function openTaskModal(prefillOrTask) {
  const isEdit = tasks.some(t => t.id === prefillOrTask.id);
  document.getElementById("task-modal-title").textContent = isEdit ? "Edit Task" : "Add Task";

  populateFolderSelect(prefillOrTask.folder_id);
  populateParentSelect(prefillOrTask.folder_id, isEdit ? prefillOrTask.id : null, prefillOrTask.parent_task_id);

  document.getElementById("task-id").value = isEdit ? prefillOrTask.id : "";
  document.getElementById("task-title").value = isEdit ? prefillOrTask.title : "";
  document.getElementById("task-notes").value = isEdit ? prefillOrTask.notes : "";
  document.getElementById("task-deadline").value = isEdit ? (prefillOrTask.deadline || "") : "";
  document.getElementById("task-importance").value = isEdit ? prefillOrTask.importance : "Low";
  taskRecurrenceSelect.value = isEdit ? prefillOrTask.recurrence : "none";
  taskRecurrenceWeekdaySelect.value = isEdit && prefillOrTask.recurrence_weekday != null
    ? prefillOrTask.recurrence_weekday
    : new Date().getDay();
  updateRecurrenceWeekdayVisibility();
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

function populateFolderSelect(selectedId) {
  taskFolderSelect.innerHTML = "";
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
    taskFolderSelect.appendChild(group);
  });
  if (selectedId) taskFolderSelect.value = selectedId;
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
    recurrence: taskRecurrenceSelect.value,
    recurrence_weekday: taskRecurrenceSelect.value === "weekly" ? Number(taskRecurrenceWeekdaySelect.value) : null,
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

// ---------- Theme toggle ----------

const themeToggleBtn = document.getElementById("theme-toggle-btn");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyThemeIcon() {
  themeToggleBtn.textContent = currentTheme() === "dark" ? "☀️" : "\u{1F319}";
}

themeToggleBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  applyThemeIcon();
});

applyThemeIcon();

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
    render();
    return;
  }
  if (generateRecurringInstances()) render();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromFolder();
  else storage.flush();
});
window.addEventListener("focus", syncFromFolder);
setInterval(syncFromFolder, 30000);

// ---------- Init ----------

storage.onStatusChange = renderStorageBar;
runStorageAction(() => storage.init());
