// Overview: the read-only orientation view (spec: "Overview", formerly Matrix/Digest).
// Three parts, top to bottom: the task map (scatter plot or quadrant list, chosen by the
// overview_display_mode setting), the priority summary panel beside it, and the
// "what changed since yesterday" digest. No checkboxes, no edit/delete, nothing to tick
// off — that happens in the List view. Only regular Tasks appear; RecurringTasks have no
// importance/urgency/quadrant and never show up here.
//
// Reads app state (tasks, folders, settings, quadrantHistory, activeView) and the pure
// helpers in urgency.js / digest.js. Uses the same quadrant-q* / --p CSS heat-map as
// List rows, so a dot, a card and a list row for the same task are always the same colour.

// Corner layout shared by both display modes: Do top-left, Remember top-right,
// Clear bottom-left, Backlog bottom-right. Urgency therefore runs high -> low from left
// to right, importance high -> low from top to bottom.
const OVERVIEW_CORNERS = [QUADRANTS.q1, QUADRANTS.q2, QUADRANTS.q3, QUADRANTS.q4];

const OVERVIEW_MODES = [
  { key: "scatter", label: "Scatter" },
  { key: "list", label: "Quadrants" },
];

function renderOverview() {
  if (activeView !== "overview") return; // nothing visible to draw; skip the work
  const today = todayISODate();
  const ranked = rankActiveTasks(today);
  const summary = selectPrioritySummary(ranked, settings);
  const summaryIds = new Set(summary.map(entry => entry.task.id));

  renderOverviewModeToggle();

  const mode = settings.overview_display_mode;
  document.getElementById("overview-scatter").hidden = mode !== "scatter";
  document.getElementById("matrix-grid").hidden = mode !== "list";
  if (mode === "scatter") renderScatter(ranked, summaryIds);
  else renderQuadrantGrid(ranked);

  renderPrioritySummary(ranked, summary);
  renderDigest(today);
}

// Every active task assessed and sorted by priority_score, best first, with its 1-based
// rank attached. Ties keep the original array order.
function rankActiveTasks(today) {
  return tasks
    .filter(t => t.status === "active")
    .map(task => ({ task, assessment: assessTask(task, settings, today) }))
    .sort((a, b) => b.assessment.priorityScore - a.assessment.priorityScore)
    .map((entry, i) => Object.assign(entry, { rank: i + 1 }));
}

// Priority panel inclusion rule: rank within overview_top_n OR score >= overview_flag_threshold,
// whichever is broader. 3 tasks at 70/60/50 all show (top-3); 90/90/90/80/70 shows four.
function selectPrioritySummary(ranked, settings) {
  const topN = settings.overview_top_n;
  const threshold = settings.overview_flag_threshold;
  return ranked.filter(entry => entry.rank <= topN || entry.assessment.priorityScore >= threshold);
}

// ---------- Display mode toggle ----------
// overview_display_mode is a real setting (synced in the data file), so the toggle here
// and the select in the Settings modal are two handles on the same value.

function renderOverviewModeToggle() {
  const toggle = document.getElementById("overview-mode");
  toggle.innerHTML = "";
  OVERVIEW_MODES.forEach(mode => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-switch-btn" + (settings.overview_display_mode === mode.key ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", settings.overview_display_mode === mode.key ? "true" : "false");
    btn.textContent = mode.label;
    btn.addEventListener("click", () => setOverviewDisplayMode(mode.key));
    toggle.appendChild(btn);
  });
}

function setOverviewDisplayMode(mode) {
  if (settings.overview_display_mode === mode) return;
  settings = normalizeSettings(Object.assign({}, settings, { overview_display_mode: mode }));
  persist();
  render();
}

// ---------- Scatter plot ----------
// SVG in viewBox units; scales to the container width via CSS. x = urgency (100 on the
// left, so Do is top-left), y = importance (100 on top). Backgrounds split at
// quadrant_split_score on both axes, the same boundary assessTask() buckets with.

const SCATTER = Object.freeze({
  width: 640,
  height: 430,
  margin: Object.freeze({ top: 24, right: 18, bottom: 46, left: 92 }),
  inset: 16, // the 0-100 scale stops this far inside the plot edges so edge dots aren't clipped
  dotRadius: 7,
  clusterRadius: 9, // dots sharing exact coordinates fan out on a ring this far from the point
});

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  });
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderScatter(ranked, summaryIds) {
  const container = document.getElementById("overview-scatter");
  container.innerHTML = "";

  const { width, height, margin, inset } = SCATTER;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xFor = urgency => margin.left + inset + ((100 - urgency) / 100) * (plotW - 2 * inset); // 100 at the left
  const yFor = importance => margin.top + inset + ((100 - importance) / 100) * (plotH - 2 * inset); // 100 at the top
  const split = splitScore(settings);
  const sx = xFor(split);
  const sy = yFor(split);
  const right = margin.left + plotW;
  const bottom = margin.top + plotH;

  const svg = svgEl("svg", {
    viewBox: "0 0 " + width + " " + height,
    class: "scatter-svg",
    role: "img",
    "aria-label": "Scatter plot of active tasks: urgency across, importance up, one dot per task",
  });

  // Quadrant backgrounds, one per corner. Labels sit at the INNER corners, hugging the
  // split lines: the outer corners are exactly where extreme scores (100/100, Critical
  // with urgency 10) pile up, while importance can never equal the split and urgency
  // rarely does, so this spot stays clear of dots.
  const regions = {
    q1: { x: margin.left, y: margin.top, w: sx - margin.left, h: sy - margin.top, anchor: "end", lx: sx - 8, ly: sy - 8 },
    q2: { x: sx, y: margin.top, w: right - sx, h: sy - margin.top, anchor: "start", lx: sx + 8, ly: sy - 8 },
    q3: { x: margin.left, y: sy, w: sx - margin.left, h: bottom - sy, anchor: "end", lx: sx - 8, ly: sy + 17 },
    q4: { x: sx, y: sy, w: right - sx, h: bottom - sy, anchor: "start", lx: sx + 8, ly: sy + 17 },
  };
  OVERVIEW_CORNERS.forEach(q => {
    const r = regions[q.key];
    const g = svgEl("g", { class: "scatter-region quadrant-" + q.key });
    g.style.setProperty("--p", "1");
    if (r.w > 0 && r.h > 0) {
      g.appendChild(svgEl("rect", { x: r.x, y: r.y, width: r.w, height: r.h, class: "scatter-region-fill" }));
      g.appendChild(svgEl("text", { x: r.lx, y: r.ly, "text-anchor": r.anchor, class: "scatter-region-label" }, q.label));
    }
    svg.appendChild(g);
  });

  // Split lines.
  svg.appendChild(svgEl("line", { x1: sx, y1: margin.top, x2: sx, y2: bottom, class: "scatter-split" }));
  svg.appendChild(svgEl("line", { x1: margin.left, y1: sy, x2: right, y2: sy, class: "scatter-split" }));

  // Axes, ticks and titles.
  svg.appendChild(svgEl("line", { x1: margin.left, y1: bottom, x2: right, y2: bottom, class: "scatter-axis" }));
  svg.appendChild(svgEl("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: bottom, class: "scatter-axis" }));
  [100, 75, 50, 25, 0].forEach(v => {
    const x = xFor(v);
    svg.appendChild(svgEl("line", { x1: x, y1: bottom, x2: x, y2: bottom + 4, class: "scatter-axis" }));
    svg.appendChild(svgEl("text", { x, y: bottom + 15, "text-anchor": "middle", class: "scatter-tick" }, v));
  });
  const importanceTicks = [[100, "Critical"], [75, "High"], [50, "Medium"], [25, "Low"], [0, ""]];
  importanceTicks.forEach(([v, name]) => {
    const y = yFor(v);
    svg.appendChild(svgEl("line", { x1: margin.left - 4, y1: y, x2: margin.left, y2: y, class: "scatter-axis" }));
    svg.appendChild(svgEl("text", { x: margin.left - 7, y: y + 3.5, "text-anchor": "end", class: "scatter-tick" }, name ? v + " " + name : v));
  });
  svg.appendChild(svgEl("text", { x: margin.left + plotW / 2, y: height - 8, "text-anchor": "middle", class: "scatter-axis-title" }, "◀ more urgent · urgency"));
  const yTitle = svgEl("text", {
    x: 12, y: margin.top + plotH / 2, "text-anchor": "middle", class: "scatter-axis-title",
    transform: "rotate(-90 12 " + (margin.top + plotH / 2) + ")",
  }, "importance · more important ▶");
  svg.appendChild(yTitle);
  svg.appendChild(svgEl("text", { x: sx, y: margin.top - 8, "text-anchor": "middle", class: "scatter-split-label" }, "split " + split));

  // Dots. Importance is discrete and urgency often pins at 10 or 100, so identical
  // coordinates are common: fan those dots out on a small ring around the true point
  // so every task stays visible without pretending it has a different score.
  const clusters = new Map();
  ranked.forEach(entry => {
    const key = entry.assessment.urgency.score + "|" + entry.assessment.importanceScore;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(entry);
  });

  const dots = svgEl("g", { class: "scatter-dots" });
  clusters.forEach(entries => {
    const cx = xFor(entries[0].assessment.urgency.score);
    const cy = yFor(entries[0].assessment.importanceScore);
    entries.forEach((entry, i) => {
      let x = cx;
      let y = cy;
      if (entries.length > 1) {
        const ring = Math.floor(i / 8);
        const angle = (2 * Math.PI * i) / Math.min(entries.length, 8) - Math.PI / 2 + ring * 0.4;
        const radius = SCATTER.clusterRadius * (1 + ring);
        x = cx + radius * Math.cos(angle);
        y = cy + radius * Math.sin(angle);
      }
      dots.appendChild(renderScatterDot(entry, x, y, summaryIds.has(entry.task.id)));
    });
  });
  svg.appendChild(dots);

  container.appendChild(svg);

  if (ranked.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "No active tasks to plot.";
    container.appendChild(empty);
  }

  const legend = document.createElement("p");
  legend.className = "scatter-legend";
  legend.textContent = "One dot per task at its exact urgency × importance. Hue = quadrant, intensity = priority. Numbered dots are in the priority panel. Hover a dot for details.";
  container.appendChild(legend);
}

function renderScatterDot(entry, x, y, inSummary) {
  const { task, assessment } = entry;
  const g = svgEl("g", { class: "scatter-dot-group quadrant-" + assessment.quadrant.key, tabindex: "0" });
  g.style.setProperty("--p", assessment.intensity.toFixed(3));
  g.appendChild(svgEl("title", {}, [
    task.title,
    taskContextLabel(task),
    assessment.quadrant.label + " · priority " + assessment.priorityScore,
    "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ") · importance " + task.importance,
  ].filter(Boolean).join("\n")));
  g.appendChild(svgEl("circle", { cx: x, cy: y, r: SCATTER.dotRadius, class: "scatter-dot" }));
  if (inSummary) {
    g.appendChild(svgEl("text", { x, y, class: "scatter-dot-rank" }, entry.rank));
  }
  return g;
}

// ---------- Quadrant list (alternate display mode) ----------
// Four boxes in the same corner layout, tasks listed inside each. Better for scanning
// within one quadrant. Cell positions are pinned in CSS (.matrix-cell-q*).

function renderQuadrantGrid(ranked) {
  const grid = document.getElementById("matrix-grid");
  grid.innerHTML = "";

  const byQuadrant = { q1: [], q2: [], q3: [], q4: [] };
  ranked.forEach(entry => byQuadrant[entry.assessment.quadrant.key].push(entry)); // already priority-sorted

  grid.appendChild(makeMatrixAxis("matrix-corner", ""));
  grid.appendChild(makeMatrixAxis("matrix-axis matrix-axis-col matrix-axis-col-high", "Urgency high / critical"));
  grid.appendChild(makeMatrixAxis("matrix-axis matrix-axis-col matrix-axis-col-low", "Urgency low / medium"));

  OVERVIEW_CORNERS.forEach((quadrant, i) => {
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

// ---------- Priority summary panel ----------

function renderPrioritySummary(ranked, summary) {
  const panel = document.getElementById("overview-panel");
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "overview-panel-header";

  const title = document.createElement("h2");
  title.className = "overview-panel-title";
  title.textContent = "Priority today";
  header.appendChild(title);

  const rule = document.createElement("span");
  rule.className = "overview-panel-rule";
  rule.textContent = "top " + settings.overview_top_n + " or score ≥ " + settings.overview_flag_threshold;
  rule.title = "A task is listed if it ranks within the top " + settings.overview_top_n + " by priority, or scores at least " + settings.overview_flag_threshold + " — whichever includes more.";
  header.appendChild(rule);

  panel.appendChild(header);

  if (summary.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = ranked.length === 0 ? "No active tasks." : "Nothing qualifies right now.";
    panel.appendChild(empty);
    return;
  }

  const ol = document.createElement("ol");
  ol.className = "overview-panel-list";
  summary.forEach(entry => ol.appendChild(renderPriorityCard(entry)));
  panel.appendChild(ol);

  if (summary.length < ranked.length) {
    const rest = document.createElement("p");
    rest.className = "overview-panel-rest";
    rest.textContent = (ranked.length - summary.length) + " more active task" + (ranked.length - summary.length === 1 ? "" : "s") + " below the line.";
    panel.appendChild(rest);
  }
}

function renderPriorityCard(entry) {
  const { task, assessment } = entry;
  const li = document.createElement("li");
  li.className = "priority-card quadrant-" + assessment.quadrant.key;
  li.style.setProperty("--p", assessment.intensity.toFixed(3));
  li.title = "urgency " + assessment.urgency.score + " (" + assessment.urgency.reason + ") · importance " + task.importance + (task.deadline ? " · due " + task.deadline : "");

  const rank = document.createElement("span");
  rank.className = "priority-card-rank";
  rank.textContent = entry.rank;
  li.appendChild(rank);

  const body = document.createElement("div");
  body.className = "priority-card-body";

  const title = document.createElement("span");
  title.className = "priority-card-title";
  title.textContent = task.title;
  body.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "priority-card-meta";
  const context = taskContextLabel(task);
  meta.textContent = (context ? context + " · " : "") + assessment.quadrant.label + " · " + assessment.urgency.reason;
  body.appendChild(meta);

  li.appendChild(body);

  const score = document.createElement("span");
  score.className = "priority-card-score";
  score.textContent = assessment.priorityScore;
  li.appendChild(score);

  return li;
}

// ---------- What changed since yesterday ----------
// Rendering only; the diff itself is buildDigest() in digest.js and is unchanged.

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
