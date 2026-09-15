// Phase 1: List view skeleton — folders, nested tasks, add/edit/delete, folder filter.
// In-memory only. Storage (File System Access API / IndexedDB) lands in Phase 2.

let nextId = 1;
function makeId() {
  return "id" + (nextId++);
}

const IMPORTANCE_VALUES = { Low: 25, Medium: 50, High: 75, Critical: 100 };

let folders = [
  { id: "f-work", name: "Work", category: "Work" },
  { id: "f-errands", name: "Errands", category: "Errands" },
  { id: "f-recruiting", name: "Recruiting", category: "Recruiting" },
];

let tasks = [];

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
    status: "active",
    completed_at: null,
  }, overrides);
}

// Seed data so folder nesting/collapsing is visible on first load.
tasks.push(makeTask({ folder_id: "f-work", title: "Finish Q3 budget review", importance: "Critical", deadline: null }));
let seedParent = makeTask({ folder_id: "f-work", title: "Prep quarterly presentation", importance: "High" });
tasks.push(seedParent);
tasks.push(makeTask({ folder_id: "f-work", parent_task_id: seedParent.id, title: "Draft slides" }));
tasks.push(makeTask({ folder_id: "f-work", parent_task_id: seedParent.id, title: "Get feedback from manager" }));
tasks.push(makeTask({ folder_id: "f-errands", title: "Pick up dry cleaning" }));
tasks.push(makeTask({ folder_id: "f-errands", title: "Renew car registration", manual_urgent_flag: true }));
tasks.push(makeTask({ folder_id: "f-recruiting", title: "Follow up with recruiter", recurrence: "weekly", importance: "Medium" }));

let activeFolderFilter = "all"; // "all" or a folder id
let collapsedFolders = new Set();
let collapsedTasks = new Set();

// ---------- Rendering ----------

function render() {
  renderFolderTabs();
  renderFolderList();
}

function renderFolderTabs() {
  const nav = document.getElementById("folder-tabs");
  nav.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "folder-tab" + (activeFolderFilter === "all" ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeFolderFilter = "all";
    render();
  });
  nav.appendChild(allBtn);

  folders.forEach(folder => {
    const btn = document.createElement("button");
    btn.className = "folder-tab" + (activeFolderFilter === folder.id ? " active" : "");
    btn.textContent = folder.name;
    btn.addEventListener("click", () => {
      activeFolderFilter = folder.id;
      render();
    });
    nav.appendChild(btn);
  });
}

function renderFolderList() {
  const container = document.getElementById("folder-list");
  container.innerHTML = "";

  const visibleFolders = activeFolderFilter === "all"
    ? folders
    : folders.filter(f => f.id === activeFolderFilter);

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
  const activeCount = tasks.filter(t => t.folder_id === folder.id && t.status === "active").length;
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
    titleLine.appendChild(makeBadge(task.recurrence, "badge-recurring"));
  }

  main.appendChild(titleLine);

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

  populateFolderSelect(prefillOrTask.folder_id);
  populateParentSelect(prefillOrTask.folder_id, isEdit ? prefillOrTask.id : null, prefillOrTask.parent_task_id);

  document.getElementById("task-id").value = isEdit ? prefillOrTask.id : "";
  document.getElementById("task-title").value = isEdit ? prefillOrTask.title : "";
  document.getElementById("task-notes").value = isEdit ? prefillOrTask.notes : "";
  document.getElementById("task-deadline").value = isEdit ? (prefillOrTask.deadline || "") : "";
  document.getElementById("task-importance").value = isEdit ? prefillOrTask.importance : "Low";
  document.getElementById("task-recurrence").value = isEdit ? prefillOrTask.recurrence : "none";
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
  folders.forEach(folder => {
    const opt = document.createElement("option");
    opt.value = folder.id;
    opt.textContent = folder.name;
    taskFolderSelect.appendChild(opt);
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
    recurrence: document.getElementById("task-recurrence").value,
    manual_urgent_flag: document.getElementById("task-urgent-flag").checked,
  };

  if (!data.title) return;

  if (id) {
    const task = tasks.find(t => t.id === id);
    Object.assign(task, data);
    task.last_touched_at = new Date().toISOString();
  } else {
    tasks.push(makeTask(data));
  }

  closeTaskModal();
  render();
});

document.getElementById("task-cancel-btn").addEventListener("click", closeTaskModal);
document.getElementById("add-task-btn").addEventListener("click", () => {
  const folderId = activeFolderFilter !== "all" ? activeFolderFilter : folders[0]?.id;
  openTaskModal({ folder_id: folderId });
});

taskModal.addEventListener("click", e => {
  if (e.target === taskModal) closeTaskModal();
});

// ---------- Folder modal ----------

const folderModal = document.getElementById("folder-modal");
const folderForm = document.getElementById("folder-form");

function openFolderModal() {
  folderForm.reset();
  folderModal.classList.remove("hidden");
  document.getElementById("folder-name").focus();
}

function closeFolderModal() {
  folderModal.classList.add("hidden");
}

folderForm.addEventListener("submit", e => {
  e.preventDefault();
  const name = document.getElementById("folder-name").value.trim();
  const category = document.getElementById("folder-category").value;
  if (!name) return;
  folders.push({ id: makeId(), name, category });
  closeFolderModal();
  render();
});

document.getElementById("add-folder-btn").addEventListener("click", openFolderModal);
document.getElementById("folder-cancel-btn").addEventListener("click", closeFolderModal);
folderModal.addEventListener("click", e => {
  if (e.target === folderModal) closeFolderModal();
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

// ---------- Init ----------

render();
