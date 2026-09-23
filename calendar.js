// Calendar view: retrospective, replaces the earlier "productivity view" idea. A monthly
// grid colored by that day's overall pace across ALL tasks (regular deadlines plus recurring
// habits), two independent overlays (an overdue ring and a gold "big win" glow), future
// due-date markers, a secondary badge for regular tasks completed, a click-through day
// repository, and a Weekly Accomplishments panel. Read-only, like Overview — nothing to tick
// off here, that happens in the List view.
//
// Red, the overdue ring, the gold glow, the count badge and the future markers are derived
// live from fields that never move retroactively (deadline, completed_at, created_at,
// importance, CompletionLog). The Green/Blue/Gray "planned" set is different: it reads
// do_date, and do_date rolls forward every day a task stays unfinished (see
// runDailyMaintenance in app.js), so recomputing a past day live would quietly rewrite an
// honest Blue into Green or Gray. Each past day's planned set is therefore frozen once, in
// plannedHistory (a permanent, append-only per-day record in the data file, captured right
// before that day's rollover), and past days read from it. Today is still computed live.
// A past day with no record (before this shipped) falls back to a live best-effort read.
// RecurringTasks carry no created_at/start date (see makeRecurringTask in app.js), so
// "scheduled" for a live-evaluated day is read off the CURRENT set of RecurringTasks.
//
// Depends on urgency.js (assessTask, importanceBucket, parseLocalDate, localDateString,
// toLocalDateString), overview.js (rankActiveTasks, selectPrioritySummary) and app.js's live
// state + startOfWeekISODate/todayISODate, but only from inside functions that run after
// every script has loaded (see the lazy defaults in renderCalendar below) — nothing here
// runs at top-level parse time.

// Strict priority order — the first rule that applies wins (same override pattern as the
// do_date urgency floor). "upcoming" is for days after today, which haven't happened yet.
const CALENDAR_DAY_BUCKETS = Object.freeze({
  red: Object.freeze({ key: "red", label: "Red" }),
  green: Object.freeze({ key: "green", label: "Green" }),
  blue: Object.freeze({ key: "blue", label: "Blue" }),
  gray: Object.freeze({ key: "gray", label: "Gray" }),
  upcoming: Object.freeze({ key: "upcoming", label: "Upcoming" }),
});

function addDaysISODate(dateStr, delta) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + delta);
  return localDateString(d);
}

function weekDates(weekStartDate) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDaysISODate(weekStartDate, i));
  return out;
}

function daysInMonthArray(year, month) {
  const count = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let day = 1; day <= count; day++) out.push(localDateString(new Date(year, month, day)));
  return out;
}

// ---------- Per-day pace rules ----------

// "YYYY-MM-DD" a regular task was completed on, or null while it's still open.
function completedDateOf(task) {
  return task.completed_at ? toLocalDateString(task.completed_at) : null;
}

// A task can't be due or overdue on a day before it existed — a backdated deadline on a
// task added later shouldn't repaint the days in between.
function taskExistedOn(task, dateStr) {
  return !task.created_at || toLocalDateString(task.created_at) <= dateStr;
}

// Overdue as of `dateStr`: deadline strictly before that day and still open past it —
// completed_at null, or a completion date after `dateStr`. The day it finally gets cleared
// is not itself an overdue day.
function isOverdueOn(task, dateStr) {
  if (!task.deadline || task.deadline >= dateStr || !taskExistedOn(task, dateStr)) return false;
  const done = completedDateOf(task);
  return done === null || done > dateStr;
}

// Regular task planned for exactly `dateStr` (do_date, the self-chosen day — not the
// deadline); it counts as done if completed on or before that day (finishing early is still
// finishing). Only meaningful for a live read of today (or a best-effort fallback for an
// unfrozen past day): once a day is over its planned set lives in plannedHistory.
function isPlannedOn(task, dateStr) {
  return task.do_date === dateStr && taskExistedOn(task, dateStr);
}

function plannedTaskDone(task, dateStr) {
  const done = completedDateOf(task);
  return done !== null && done <= dateStr;
}

// The frozen shape of one day's planned set: which regular Tasks had do_date == that day
// and whether each got done by day's end, plus which RecurringTasks were scheduled and
// done. Titles are stored so a later rename or delete can't change what a frozen day says.
// Pure, so the same code both freezes a day (runDailyMaintenance, right before rollover)
// and evaluates today live.
function buildPlannedRecord(dateStr, tasks, recurringTasks, completionLog) {
  return {
    tasks: tasks
      .filter(t => isPlannedOn(t, dateStr))
      .map(t => ({ id: t.id, title: t.title, done: plannedTaskDone(t, dateStr) })),
    recurring: recurringTasks
      .filter(rt => recurringScheduledOn(rt, dateStr))
      .map(rt => ({ id: rt.id, title: rt.title, done: recurringDoneFor(rt, dateStr, completionLog) })),
  };
}

// The planned set to score `dateStr` with: the frozen record for a past day, a live read
// for today (and, best-effort, for a past day that was never frozen).
function plannedRecordFor(dateStr, data, today) {
  const frozen = data.plannedHistory && dateStr < today ? data.plannedHistory[dateStr] : null;
  if (frozen && Array.isArray(frozen.tasks) && Array.isArray(frozen.recurring)) return frozen;
  return buildPlannedRecord(dateStr, data.tasks, data.recurringTasks, data.completionLog);
}

// RecurringTasks scheduled on a day: daily ones every day; weekly ones on their weekday
// (Sunday — the end of the Monday-start week — when no weekday was picked); monthly ones on
// their day-of-month (the month's last day when none was picked, clamped in short months).
function recurringScheduledOn(rt, dateStr) {
  if (rt.cadence === "daily") return true;
  if (rt.cadence === "weekly") return parseLocalDate(dateStr).getDay() === recurringWeekday(rt);
  if (rt.cadence === "monthly") return parseLocalDate(dateStr).getDate() === recurringDayOfMonth(rt, dateStr);
  return false;
}

// The period a habit resets on, as an inclusive { start, end } date range containing
// `dateStr`: the day itself (daily), its Mon–Sun week (weekly), its calendar month (monthly).
function periodRangeFor(cadence, dateStr) {
  if (cadence === "weekly") {
    const start = startOfWeekISODate(dateStr);
    return { start, end: addDaysISODate(start, 6) };
  }
  if (cadence === "monthly") {
    const d = parseLocalDate(dateStr);
    return {
      start: localDateString(new Date(d.getFullYear(), d.getMonth(), 1)),
      end: localDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  }
  return { start: dateStr, end: dateStr };
}

// The period immediately before the one containing `dateStr`.
function previousPeriodRangeFor(cadence, dateStr) {
  const current = periodRangeFor(cadence, dateStr);
  return periodRangeFor(cadence, addDaysISODate(current.start, -1));
}

function recurringDoneInRange(rt, range, completionLog) {
  return completionLog.some(l => l.recurring_task_id === rt.id && l.completed_date >= range.start && l.completed_date <= range.end);
}

// skipped_date is a single field, not a log (the Skip action writes no CompletionLog row), so
// "skipped within range" just tests whether that one date falls inside it.
function recurringSkippedInRange(rt, range) {
  return Boolean(rt.skipped_date && rt.skipped_date >= range.start && rt.skipped_date <= range.end);
}

// A daily habit is done for a day if it was logged that day. A weekly habit is done for its
// scheduled day if any CompletionLog row for it falls in that same Mon–Sun week — the same
// "done this week" reading isRecurringDoneNow uses in the Checklist. Monthly: that month.
function recurringDoneFor(rt, dateStr, completionLog) {
  return recurringDoneInRange(rt, periodRangeFor(rt.cadence, dateStr), completionLog);
}

// missed_last_period: the previous period (yesterday / last week / last month) went by with
// no completion AND no skip, and the habit already existed by the end of it. A deliberate skip
// counts the same as a completion here (a rest day is a real choice, not neglect). Refreshed at
// every reset boundary by runDailyMaintenance, cleared the moment the current period is
// completed or skipped. A habit with no created_at (written before the field existed) counts
// as having existed.
function computeMissedLastPeriod(rt, today, completionLog) {
  const previous = previousPeriodRangeFor(rt.cadence, today);
  if (rt.created_at && toLocalDateString(rt.created_at) > previous.end) return false;
  if (recurringDoneInRange(rt, previous, completionLog) || recurringSkippedInRange(rt, previous)) return false;
  const current = periodRangeFor(rt.cadence, today);
  return !(recurringDoneInRange(rt, current, completionLog) || recurringSkippedInRange(rt, current));
}

// Pace bucket for one day, in strict priority order (spec, Calendar view):
//   red   — a High/Critical-importance regular task is overdue as of that day (deadline only,
//           do_date plays no part, and this is always computed live)
//   green — nothing High-importance overdue, and everything planned that day got done
//   blue  — nothing High-importance overdue, but not everything planned got done
//   gray  — nothing was planned at all ("no obligation, not a failure")
// "Planned" = RecurringTasks scheduled that day plus regular Tasks with do_date exactly that
// day, read from the frozen plannedHistory record for a past day (see plannedRecordFor).
// "High importance" uses the same bucket boundary as quadrant placement (importanceBucket).
// A Low/Medium overdue task never forces red; it's surfaced as `lowOverdue` for the ring
// overlay instead. Days strictly after `today` haven't happened, so they get the
// "upcoming" bucket plus future due-date markers instead of a pace color.
//
// `data` is { tasks, folders, recurringTasks, completionLog, plannedHistory, topPriorityIds? }
// — the same bundle every function below takes, so callers build it once. `topPriorityIds`
// is the Set of task ids the Overview's priority summary panel would list (rank within
// overview_top_n OR score ≥ overview_flag_threshold); upcoming deadlines in that set get the
// accented marker.
function computeDayStats(dateStr, data, settings, today) {
  const upcoming = Boolean(today && dateStr > today);
  const regularCompleted = data.tasks.filter(t => completedDateOf(t) === dateStr);
  const regularCompletedCount = regularCompleted.length;

  if (upcoming) {
    const topIds = data.topPriorityIds || new Set();
    const upcomingDeadlines = data.tasks
      .filter(t => t.status === "active" && t.deadline === dateStr)
      .map(task => ({ task, top: topIds.has(task.id) }));
    // Weekly and monthly RecurringTasks get a future marker on their scheduled day too
    // ("Tuesday is laundry day" is genuinely informative). Daily ones deliberately don't: a
    // marker on every single day is constant noise, not information, and they're already
    // surfaced twice elsewhere (the habit boxes and Now).
    const upcomingWeeklyRecurring = data.recurringTasks
      .filter(rt => rt.cadence !== "daily" && recurringScheduledOn(rt, dateStr))
      .map(task => ({ task, top: false }));
    return {
      date: dateStr, upcoming: true, bucket: CALENDAR_DAY_BUCKETS.upcoming,
      highOverdue: [], lowOverdue: [], due: [], dueCount: 0, doneCount: 0,
      goldWins: [], regularCompletedCount, upcomingDeadlines, upcomingWeeklyRecurring,
    };
  }

  const overdue = data.tasks.filter(t => isOverdueOn(t, dateStr));
  const highOverdue = overdue.filter(t => importanceBucket(t.importance, settings) === "high");
  const lowOverdue = overdue.filter(t => importanceBucket(t.importance, settings) !== "high");

  const planned = plannedRecordFor(dateStr, data, today);
  const due = planned.recurring
    .map(r => ({ kind: "recurring", id: r.id, title: r.title, done: !!r.done }))
    .concat(planned.tasks.map(t => ({ kind: "task", id: t.id, title: t.title, done: !!t.done })));
  const dueCount = due.length;
  const doneCount = due.filter(d => d.done).length;

  let bucket;
  if (highOverdue.length > 0) bucket = CALENDAR_DAY_BUCKETS.red;
  else if (dueCount === 0) bucket = CALENDAR_DAY_BUCKETS.gray;
  else if (doneCount === dueCount) bucket = CALENDAR_DAY_BUCKETS.green;
  else bucket = CALENDAR_DAY_BUCKETS.blue;

  // Gold glow: a regular task completed that day whose importance buckets High/Critical —
  // the same importanceBucket boundary (quadrant_split_score) the Red rule above uses, so
  // "important" means the same thing everywhere on this grid. No new setting. Independent
  // of the base color: a red day can still glow if something important also got cleared.
  const goldWins = regularCompleted.filter(task => importanceBucket(task.importance, settings) === "high");

  return {
    date: dateStr, upcoming: false, bucket,
    highOverdue, lowOverdue, due, dueCount, doneCount,
    goldWins, regularCompletedCount, upcomingDeadlines: [], upcomingWeeklyRecurring: [],
  };
}

// ---------- Capacity view ----------
// A day's effort, independent of Pace's red/green/blue/gray judgment — purely "how much
// volume", so it can render as a continuous gradient rather than a discrete bucket.
// Bite-size = 1 point, Main Course = 2, same weight the List view's sizing already
// uses. A RecurringTask completion/occurrence is a flat 1, regardless of cadence — they
// don't carry is_quick_win (they live outside the matrix entirely), so there's no finer
// signal to weight by.
function quickWinWeight(task) {
  return task.is_quick_win ? 1 : 2;
}

// Past days (and today, live): reads completed_at, regardless of what was planned — a raw
// "how much did I actually do" volume. Future days: reads do_date, the intended-effort
// field, not deadline — see the Calendar spec section for why they diverge. Both add a flat
// 1 point per RecurringTask: completions that day (CompletionLog) for past/today, scheduled
// occurrences (recurringScheduledOn — daily every day, weekly only its weekday) for future.
function computeDayCapacity(dateStr, data, settings, today) {
  const isPast = dateStr <= today;
  let effort = 0;

  if (isPast) {
    data.tasks.filter(t => completedDateOf(t) === dateStr).forEach(t => { effort += quickWinWeight(t); });
    effort += data.completionLog.filter(l => l.completed_date === dateStr).length;
  } else {
    data.tasks.filter(t => isPlannedOn(t, dateStr)).forEach(t => { effort += quickWinWeight(t); });
    effort += data.recurringTasks.filter(rt => recurringScheduledOn(rt, dateStr)).length;
  }

  const capacity = settings.daily_capacity_points;
  const ratio = capacity > 0 ? effort / capacity : (effort > 0 ? Infinity : 0);
  return {
    date: dateStr, isPast, effort, capacity, ratio,
    clampedRatio: Math.min(1, ratio),
    overloaded: ratio > 1,
  };
}

// Everything completed on `dateStr`: regular tasks via completed_at, recurring tasks (daily
// AND weekly) via CompletionLog rows for that date. Each entry: { kind: "task" | "recurring",
// task, folder }. A recurring entry's title comes from the log's own stored snapshot, not a
// lookup on the parent RecurringTask, so a completion from a since-deleted habit still
// displays correctly (folder is still a live lookup, best-effort, since only title is
// snapshotted — see CompletionLog in the Data Model).
function completionsOnDay(dateStr, data) {
  const regular = data.tasks
    .filter(t => t.completed_at && toLocalDateString(t.completed_at) === dateStr)
    .map(task => ({ kind: "task", task, folder: data.folders.find(f => f.id === task.folder_id) || null }));
  const recurring = data.completionLog
    .filter(l => l.completed_date === dateStr)
    .map(log => {
      const rt = data.recurringTasks.find(r => r.id === log.recurring_task_id);
      const task = { id: log.recurring_task_id, title: log.title || "(deleted habit)", folder_id: rt ? rt.folder_id : null };
      return { kind: "recurring", task, folder: rt ? data.folders.find(f => f.id === rt.folder_id) || null : null };
    });
  return regular.concat(recurring);
}

// Everything the Weekly Accomplishments panel needs for the week starting `weekStartDate` (a
// Monday). Days after `today` carry no data yet, so they're excluded rather than silently
// counting as if nothing happened. `cleared` is a categorical tally (count per category,
// regular Tasks and RecurringTasks combined, most active first) rather than a title-by-title
// list — the Calendar's day-repository already covers that level of per-day detail, so a
// plain list here was redundant regardless of which period it spanned. A weekly aggregate by
// category is the thing that doesn't exist anywhere else.
function computeWeekSummary(weekStartDate, data, settings, today) {
  const dates = weekDates(weekStartDate);
  const daysSoFar = dates.filter(d => d <= today);

  const categoryCounts = new Map(); // category name -> count, first-seen order
  let biggestWin = null;

  daysSoFar.forEach(dateStr => {
    completionsOnDay(dateStr, data).forEach(entry => {
      const category = entry.folder ? data.categories.find(c => c.id === entry.folder.category_id) : null;
      const label = category ? category.name : "Uncategorized";
      categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);

      // Only top-level regular Tasks carry a priority_score (RecurringTasks live outside the
      // Eisenhower matrix entirely, and a subtask has no independent score of its own), so the
      // biggest-win pool is top-level regular tasks only.
      if (entry.kind === "task" && !entry.task.parent_task_id) {
        const assessment = assessTask(entry.task, settings, today);
        if (!biggestWin || assessment.priorityScore > biggestWin.assessment.priorityScore) {
          biggestWin = { task: entry.task, assessment };
        }
      }
    });
  });

  const cleared = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return {
    weekStartDate,
    weekEndDate: dates[6],
    cleared,
    biggestWin,
  };
}

// ---------- Rendering ----------
// Local UI state — which month/week/day is showing — lazily defaulted to "now" on first
// render rather than at top-level parse time, since todayISODate()/startOfWeekISODate() are
// defined in app.js, which loads after this file (same reason overview.js keeps its own
// state initialization inside functions, not at module scope).
let calendarMonth = null; // { year, month(0-11) }
let calendarSelectedWeekStart = null; // "YYYY-MM-DD", always a Monday
// "YYYY-MM-DD" whose repository panel is expanded, null when explicitly closed, or undefined
// before the first render — the sentinel that lets renderCalendar open today's by default on
// load without fighting a later, deliberate close (see renderCalendar below).
let calendarOpenDay;

const CALENDAR_WEEKDAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// calendar_display_mode: "pace" (existing red/green/blue/gray coloring, unchanged) or
// "capacity" (effort vs. daily_capacity_points, same two-mode pattern as
// overview_display_mode / list_display_mode). A per-device display preference (localStorage),
// same category as sort/grouping/theme/folder-count-style — the on-page toggle is its only UI.
const CALENDAR_MODES = [
  { key: "pace", label: "Pace" },
  { key: "capacity", label: "Capacity" },
];
let calendarDisplayMode = localStorage.getItem("calendarDisplayMode") === "capacity" ? "capacity" : "pace";

function renderCalendar() {
  if (activeView !== "calendar") return; // nothing visible to draw; skip the work
  const today = todayISODate();
  if (!calendarMonth) {
    const d = new Date();
    calendarMonth = { year: d.getFullYear(), month: d.getMonth() };
  }
  if (!calendarSelectedWeekStart) calendarSelectedWeekStart = startOfWeekISODate(today);
  // Today's completions open by default on first render; a later toggle (including closing
  // it) is a deliberate choice from here on, so only the undefined sentinel triggers this.
  if (calendarOpenDay === undefined) calendarOpenDay = today;

  // topPriorityIds: the exact set the Overview's priority summary panel lists (rank within
  // overview_top_n OR score ≥ overview_flag_threshold), so the accented future-deadline
  // marker means "top priority" by the same definition used everywhere else in the app.
  const topPriorityIds = new Set(selectPrioritySummary(rankActiveTasks(today), settings).map(e => e.task.id));
  const data = { tasks, folders, categories, recurringTasks, completionLog, plannedHistory, topPriorityIds };

  renderCalendarToolbar();
  renderCalendarModeToggle();
  if (calendarDisplayMode === "capacity") {
    renderCalendarCapacityLegend();
    renderCalendarCapacityGrid(data, today);
  } else {
    renderCalendarLegend();
    renderCalendarGrid(data, today);
  }
  renderCalendarDayRepo(data);
  renderCalendarWeeklyPanel(data, today);
}

function renderCalendarModeToggle() {
  const toggle = document.getElementById("calendar-mode");
  toggle.innerHTML = "";
  CALENDAR_MODES.forEach(mode => {
    const btn = document.createElement("button");
    btn.type = "button";
    const active = calendarDisplayMode === mode.key;
    btn.className = "view-switch-btn" + (active ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.textContent = mode.label;
    btn.addEventListener("click", () => setCalendarDisplayMode(mode.key));
    toggle.appendChild(btn);
  });
}

function setCalendarDisplayMode(mode) {
  if (calendarDisplayMode === mode) return;
  calendarDisplayMode = mode;
  localStorage.setItem("calendarDisplayMode", mode);
  render();
}

function calendarGoToMonth(delta) {
  let { year, month } = calendarMonth;
  month += delta;
  if (month < 0) { month = 11; year -= 1; }
  else if (month > 11) { month = 0; year += 1; }
  calendarMonth = { year, month };
  render();
}

function calendarGoToToday() {
  const d = new Date();
  calendarMonth = { year: d.getFullYear(), month: d.getMonth() };
  render();
}

function renderCalendarToolbar() {
  const label = document.getElementById("calendar-month-label");
  label.textContent = new Date(calendarMonth.year, calendarMonth.month, 1)
    .toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Buttons are static markup (never rebuilt), so assign onclick rather than
  // addEventListener to avoid stacking duplicate handlers across re-renders.
  document.getElementById("calendar-prev-btn").onclick = () => calendarGoToMonth(-1);
  document.getElementById("calendar-next-btn").onclick = () => calendarGoToMonth(1);
  document.getElementById("calendar-today-btn").onclick = calendarGoToToday;
}

function renderCalendarLegend() {
  const legend = document.getElementById("calendar-legend");
  legend.innerHTML = "";
  const threshold = settings.overview_flag_threshold;
  const topN = settings.overview_top_n;

  // Base colors, in the same strict priority order the engine applies them.
  [
    [CALENDAR_DAY_BUCKETS.red, "A High/Critical-importance task was overdue as of that day"],
    [CALENDAR_DAY_BUCKETS.green, "Nothing High-importance overdue, and everything planned that day (habits + tasks with that do-date) got done"],
    [CALENDAR_DAY_BUCKETS.blue, "Nothing High-importance overdue, but not everything planned that day got done"],
    [CALENDAR_DAY_BUCKETS.gray, "Nothing was planned that day"],
    [CALENDAR_DAY_BUCKETS.upcoming, "Hasn't happened yet — shows upcoming deadlines instead"],
  ].forEach(([bucket, hint]) => {
    legend.appendChild(makeCalendarLegendChip(bucket.label, "calendar-day-" + bucket.key, hint));
  });

  // Overlays and markers, each drawn with the same class the grid cell uses so the legend
  // shows the real visual rather than describing it.
  legend.appendChild(makeCalendarLegendChip("Ring", "calendar-day-gray calendar-cell-overdue-ring",
    "A Low/Medium-importance task was overdue as of that day (never forces red)"));
  legend.appendChild(makeCalendarLegendChip("Glow", "calendar-day-gray calendar-cell-gold",
    "Big win: a High/Critical-importance task got completed that day"));

  const markerChip = makeCalendarLegendChip("", "calendar-day-upcoming",
    "Upcoming deadline · accented = top priority (top " + topN + " or score ≥ " + threshold + ") · square = weekly/monthly habit's scheduled day");
  markerChip.appendChild(makeCalendarMarker(false, null));
  markerChip.appendChild(document.createTextNode(" due "));
  markerChip.appendChild(makeCalendarMarker(true, null));
  markerChip.appendChild(document.createTextNode(" top "));
  markerChip.appendChild(makeCalendarMarker(false, null, true));
  markerChip.appendChild(document.createTextNode(" habit"));
  legend.appendChild(markerChip);

  const note = document.createElement("span");
  note.className = "legend-note";
  note.textContent = "color = pace · badge = tasks completed";
  legend.appendChild(note);
}

function makeCalendarLegendChip(text, extraClass, hint) {
  const chip = document.createElement("span");
  chip.className = "calendar-legend-chip " + extraClass;
  chip.textContent = text;
  chip.title = hint;
  return chip;
}

// A future due-date marker: a plain dot, the larger accented diamond for a task the
// Overview's priority panel would list, or the violet square for a weekly RecurringTask's
// scheduled day (same hue the habit boxes use for "weekly", elsewhere in the app).
// `task` is null for the legend sample.
function makeCalendarMarker(top, task, recurring) {
  const m = document.createElement("span");
  m.className = "calendar-cell-marker" + (top ? " calendar-cell-marker-top" : "") + (recurring ? " calendar-cell-marker-recurring" : "");
  if (task) m.title = task.title + (top ? " (top priority)" : recurring ? " (" + task.cadence + ")" : "");
  return m;
}

// Shared month-grid scaffold (weekday heads + leading/trailing blanks) for both display
// modes; only how each day's cell is built (`cellFn`) differs.
function renderCalendarGridScaffold(cellFn) {
  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  CALENDAR_WEEKDAY_HEADS.forEach(label => {
    const head = document.createElement("div");
    head.className = "calendar-weekday-head";
    head.textContent = label;
    grid.appendChild(head);
  });

  const dates = daysInMonthArray(calendarMonth.year, calendarMonth.month);
  const firstWeekday = mondayOffset(parseLocalDate(dates[0]));
  for (let i = 0; i < firstWeekday; i++) grid.appendChild(makeCalendarBlankCell());
  dates.forEach(dateStr => grid.appendChild(cellFn(dateStr)));
  const trailing = (7 - ((firstWeekday + dates.length) % 7)) % 7;
  for (let i = 0; i < trailing; i++) grid.appendChild(makeCalendarBlankCell());
}

function renderCalendarGrid(data, today) {
  renderCalendarGridScaffold(dateStr => renderCalendarCell(dateStr, data, today));
}

function makeCalendarBlankCell() {
  const div = document.createElement("div");
  div.className = "calendar-cell calendar-cell-blank";
  return div;
}

function renderCalendarCell(dateStr, data, today) {
  const stats = computeDayStats(dateStr, data, settings, today);
  const weekStart = startOfWeekISODate(dateStr);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "calendar-cell calendar-day-" + stats.bucket.key;
  if (dateStr === today) cell.classList.add("calendar-cell-today");
  if (weekStart === calendarSelectedWeekStart) cell.classList.add("calendar-cell-selected-week");
  if (dateStr === calendarOpenDay) cell.classList.add("calendar-cell-open");
  // Overlays are independent of the base fill: both can sit on any color, including each
  // other (a red day with a minor overdue ring that also glows gold is a legitimate day).
  if (stats.lowOverdue.length > 0) cell.classList.add("calendar-cell-overdue-ring");
  if (stats.goldWins.length > 0) cell.classList.add("calendar-cell-gold");

  cell.title = calendarCellTitle(stats);

  const num = document.createElement("span");
  num.className = "calendar-cell-num";
  num.textContent = String(Number(dateStr.slice(8, 10)));
  cell.appendChild(num);

  if (stats.upcomingDeadlines.length > 0 || stats.upcomingWeeklyRecurring.length > 0) {
    const markers = document.createElement("span");
    markers.className = "calendar-cell-markers";
    // Top-priority deadline markers first, then plain deadlines, then weekly habits, so the
    // most important thing stays visible first if a crowded day wraps.
    stats.upcomingDeadlines
      .slice()
      .sort((a, b) => Number(b.top) - Number(a.top))
      .forEach(({ task, top }) => markers.appendChild(makeCalendarMarker(top, task)));
    stats.upcomingWeeklyRecurring.forEach(({ task }) => markers.appendChild(makeCalendarMarker(false, task, true)));
    cell.appendChild(markers);
  }

  if (stats.regularCompletedCount > 0) {
    const badge = document.createElement("span");
    badge.className = "calendar-cell-badge";
    badge.textContent = stats.regularCompletedCount;
    cell.appendChild(badge);
  }

  cell.addEventListener("click", () => {
    calendarSelectedWeekStart = weekStart;
    calendarOpenDay = calendarOpenDay === dateStr ? null : dateStr;
    render();
  });

  return cell;
}

// ---------- Capacity view rendering ----------
// Same grid scaffold and day-click/day-repo/weekly-panel behavior as Pace; only the fill
// and markers differ — a continuous effort/capacity gradient instead of a discrete bucket,
// with no overdue ring, gold glow, or deadline markers, since those all carry the red/green
// "judgment" this view deliberately avoids.

function renderCalendarCapacityGrid(data, today) {
  renderCalendarGridScaffold(dateStr => renderCalendarCapacityCell(dateStr, data, today));
}

function renderCalendarCapacityCell(dateStr, data, today) {
  const stats = computeDayCapacity(dateStr, data, settings, today);
  const weekStart = startOfWeekISODate(dateStr);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "calendar-cell calendar-cell-capacity" + (stats.overloaded ? " calendar-cell-capacity-overload" : "");
  cell.style.setProperty("--p", stats.clampedRatio.toFixed(3));
  if (dateStr === today) cell.classList.add("calendar-cell-today");
  if (weekStart === calendarSelectedWeekStart) cell.classList.add("calendar-cell-selected-week");
  if (dateStr === calendarOpenDay) cell.classList.add("calendar-cell-open");

  cell.title = calendarCapacityCellTitle(stats);

  const num = document.createElement("span");
  num.className = "calendar-cell-num";
  num.textContent = String(Number(dateStr.slice(8, 10)));
  cell.appendChild(num);

  const badge = document.createElement("span");
  badge.className = "calendar-cell-badge";
  badge.textContent = stats.effort % 1 === 0 ? stats.effort : stats.effort.toFixed(1);
  cell.appendChild(badge);

  cell.addEventListener("click", () => {
    calendarSelectedWeekStart = weekStart;
    calendarOpenDay = calendarOpenDay === dateStr ? null : dateStr;
    render();
  });

  return cell;
}

function calendarCapacityCellTitle(stats) {
  const pct = Math.round(stats.ratio * 100);
  const source = stats.isPast ? "completed" : "scheduled (do-date)";
  return pluralCount(stats.effort, "point") + " " + source + " of " + stats.capacity
    + " (" + pct + "%)" + (stats.overloaded ? " — over capacity" : "");
}

function renderCalendarCapacityLegend() {
  const legend = document.getElementById("calendar-legend");
  legend.innerHTML = "";

  const gradientChip = makeCalendarLegendChip("Effort ÷ daily capacity", "calendar-cell-capacity",
    "Pale = little scheduled/done that day, vivid = at capacity. Past/today reads completed_at; future reads do_date.");
  gradientChip.style.setProperty("--p", "0.85");
  legend.appendChild(gradientChip);

  legend.appendChild(makeCalendarLegendChip("Overload", "calendar-cell-capacity calendar-cell-capacity-overload",
    "Effort crossed 100% of daily capacity — a volume flag, not the same red as Pace's overdue trigger"));

  const note = document.createElement("span");
  note.className = "legend-note";
  note.textContent = "badge = effort points that day";
  legend.appendChild(note);
}

// pluralCount(n, noun) now lives in urgency.js (loads before this file), shared with digest.js.

// Hover text: why the day is the color it is, then each overlay, then the badge count.
function calendarCellTitle(stats) {
  const parts = [];
  if (stats.upcoming) {
    const n = stats.upcomingDeadlines.length;
    const top = stats.upcomingDeadlines.filter(d => d.top).length;
    parts.push(n === 0
      ? "Hasn't happened yet"
      : pluralCount(n, "deadline") + (top > 0 ? " (" + top + " top priority)" : "")
        + ": " + stats.upcomingDeadlines.map(d => d.task.title).join(", "));
    if (stats.upcomingWeeklyRecurring.length > 0) {
      parts.push("Habits: " + stats.upcomingWeeklyRecurring.map(d => d.task.title).join(", "));
    }
    return parts.join(" · ");
  }

  if (stats.highOverdue.length > 0) {
    parts.push("Overdue (high importance): " + stats.highOverdue.map(t => t.title).join(", "));
  }
  if (stats.dueCount === 0) parts.push("Nothing planned");
  else {
    const missed = stats.due.filter(d => !d.done).map(d => d.title);
    parts.push(stats.doneCount + "/" + stats.dueCount + " planned items done"
      + (missed.length > 0 ? " (missed: " + missed.join(", ") + ")" : ""));
  }
  if (stats.lowOverdue.length > 0) {
    parts.push("Overdue (low/medium): " + stats.lowOverdue.map(t => t.title).join(", "));
  }
  if (stats.goldWins.length > 0) {
    parts.push("Big win: " + stats.goldWins.map(t => t.title + " (" + t.importance + ")").join(", "));
  }
  if (stats.regularCompletedCount > 0) parts.push(pluralCount(stats.regularCompletedCount, "task") + " completed");
  return parts.join(" · ");
}

function formatCalendarLongDate(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatCalendarShortDate(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderCalendarDayRepo(data) {
  const panel = document.getElementById("calendar-day-repo");
  panel.innerHTML = "";
  if (!calendarOpenDay) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-icon calendar-day-repo-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => { calendarOpenDay = null; render(); });
  panel.appendChild(closeBtn);

  const heading = document.createElement("h3");
  heading.className = "calendar-day-repo-heading";
  heading.textContent = "Completed on " + formatCalendarLongDate(calendarOpenDay);
  panel.appendChild(heading);

  const entries = completionsOnDay(calendarOpenDay, data);
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "Nothing completed this day.";
    panel.appendChild(empty);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "calendar-day-repo-list";
  entries.forEach(entry => {
    const li = document.createElement("li");
    li.className = "calendar-day-repo-item";

    const title = document.createElement("span");
    title.className = "calendar-day-repo-title";
    title.textContent = entry.task.title;
    li.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "calendar-day-repo-meta";
    meta.textContent = [entry.folder ? entry.folder.name : null, entry.kind === "recurring" ? "recurring" : null].filter(Boolean).join(" · ");
    li.appendChild(meta);

    ul.appendChild(li);
  });
  panel.appendChild(ul);
}

function renderCalendarWeeklyPanel(data, today) {
  const panel = document.getElementById("calendar-weekly-panel");
  panel.innerHTML = "";

  const summary = computeWeekSummary(calendarSelectedWeekStart, data, settings, today);

  const header = document.createElement("div");
  header.className = "calendar-weekly-header";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "btn-icon";
  prevBtn.setAttribute("aria-label", "Previous week");
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", () => { calendarSelectedWeekStart = addDaysISODate(calendarSelectedWeekStart, -7); render(); });
  header.appendChild(prevBtn);

  const title = document.createElement("h2");
  title.className = "calendar-weekly-title";
  title.textContent = formatCalendarShortDate(summary.weekStartDate) + " – " + formatCalendarShortDate(summary.weekEndDate);
  header.appendChild(title);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn-icon";
  nextBtn.setAttribute("aria-label", "Next week");
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", () => { calendarSelectedWeekStart = addDaysISODate(calendarSelectedWeekStart, 7); render(); });
  header.appendChild(nextBtn);

  if (summary.weekStartDate !== startOfWeekISODate(today)) {
    const thisWeekBtn = document.createElement("button");
    thisWeekBtn.type = "button";
    thisWeekBtn.className = "link-btn calendar-weekly-thisweek";
    thisWeekBtn.textContent = "This week";
    thisWeekBtn.addEventListener("click", () => { calendarSelectedWeekStart = startOfWeekISODate(today); render(); });
    header.appendChild(thisWeekBtn);
  }

  panel.appendChild(header);

  appendCalendarSubhead(panel, "Cleared this week");
  if (summary.cleared.length === 0) {
    panel.appendChild(makeCalendarEmptyHint("Nothing completed yet this week."));
  } else {
    const line = document.createElement("div");
    line.className = "calendar-weekly-summary";
    line.textContent = summary.cleared.map(c => c.count + " " + c.name).join(", ");
    panel.appendChild(line);
  }

  appendCalendarSubhead(panel, "Biggest win");
  if (summary.biggestWin) {
    const { task, assessment } = summary.biggestWin;
    const win = document.createElement("div");
    win.className = "calendar-biggest-win quadrant-" + assessment.quadrant.key;
    win.style.setProperty("--p", assessment.intensity.toFixed(3));

    const winTitle = document.createElement("span");
    winTitle.className = "calendar-biggest-win-title";
    winTitle.textContent = task.title;
    win.appendChild(winTitle);

    const winScore = document.createElement("span");
    winScore.className = "calendar-biggest-win-score";
    winScore.textContent = assessment.quadrant.label + " · priority " + assessment.priorityScore;
    win.appendChild(winScore);

    panel.appendChild(win);
  } else {
    panel.appendChild(makeCalendarEmptyHint("No regular tasks completed yet this week."));
  }
}

function appendCalendarSubhead(panel, text) {
  const h = document.createElement("h3");
  h.className = "calendar-weekly-subhead";
  h.textContent = text;
  panel.appendChild(h);
}

function makeCalendarEmptyHint(text) {
  const div = document.createElement("div");
  div.className = "empty-hint";
  div.textContent = text;
  return div;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CALENDAR_DAY_BUCKETS, addDaysISODate, weekDates, daysInMonthArray,
    completedDateOf, taskExistedOn, isOverdueOn, isPlannedOn, plannedTaskDone,
    buildPlannedRecord, plannedRecordFor, recurringScheduledOn, recurringDoneFor,
    periodRangeFor, previousPeriodRangeFor, recurringDoneInRange, recurringSkippedInRange, computeMissedLastPeriod,
    computeDayStats, completionsOnDay, computeWeekSummary,
    quickWinWeight, computeDayCapacity,
  };
}
