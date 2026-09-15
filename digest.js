// Daily digest: pure functions for the Overview view. Depends on urgency.js (assessTask,
// calendarDaysBetween, parseLocalDate, QUADRANTS) but touches no DOM or storage.
//
// Quadrant and priority_score are derived, never stored on the task — but "what changed
// since yesterday" needs something to diff against, so the app keeps a small history: one
// snapshot per calendar day, mapping each active task's id to a record of everything that
// can drive its quadrant. Today's entry is rewritten every time state is saved, so whatever
// the app last saw on a given day is that day's end-of-day snapshot. The history lives in
// the synced data file so both devices diff against the same baseline.
//
// Only regular Tasks are snapshotted. RecurringTasks never appear in the matrix or digest.

const HISTORY_KEEP_DAYS = 30;

// Order used when listing quadrants in the digest: most actionable first.
const QUADRANT_RANK = { q1: 0, q2: 1, q3: 2, q4: 3 };

// Everything about a task that can move it between quadrants or shift its priority_score,
// captured once at (roughly) the end of each day. quadrant/priorityScore are the derived
// outcome; the other four fields are the raw inputs the digest compares against tomorrow
// to tell automatic drift (a deadline getting closer, staleness ticking up) apart from a
// manual edit (you changed the deadline, importance, flag, or touched the task yourself).
function buildDailySnapshot(tasks, settings, today) {
  const snapshot = {};
  tasks.forEach(task => {
    if (task.status !== "active") return;
    const assessment = assessTask(task, settings, today);
    snapshot[task.id] = {
      quadrant: assessment.quadrant.key,
      priorityScore: assessment.priorityScore,
      deadline: task.deadline || null,
      importance: task.importance,
      manual_urgent_flag: !!task.manual_urgent_flag,
      last_touched_at: task.last_touched_at || null,
    };
  });
  return snapshot;
}

function snapshotRecordsEqual(a, b) {
  if (!a || !b) return false;
  return a.quadrant === b.quadrant
    && a.priorityScore === b.priorityScore
    && (a.deadline || null) === (b.deadline || null)
    && a.importance === b.importance
    && !!a.manual_urgent_flag === !!b.manual_urgent_flag
    && (a.last_touched_at || null) === (b.last_touched_at || null);
}

function sameSnapshot(a, b) {
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(id => snapshotRecordsEqual(a[id], b[id]));
}

// A day stored before this record shape existed holds a plain quadrant-key string per
// task instead of a record ({ quadrant, priorityScore, deadline, ... }). Drop any such day
// so buildDigest never has to guess at field values it was never given — costs at most one
// day's baseline, the first time a file saved by the older version loads here.
function sanitizeQuadrantHistory(history) {
  Object.keys(history).forEach(date => {
    const day = history[date];
    const isLegacy = Object.values(day).some(record => typeof record !== "object" || record === null);
    if (isLegacy) delete history[date];
  });
  return history;
}

// Writes today's snapshot into `history` (mutating it) and drops days older than
// HISTORY_KEEP_DAYS. Returns true when anything actually changed, so callers can skip a
// save when the file is already up to date (avoids two synced devices rewriting the same
// file back and forth).
function recordQuadrantSnapshot(history, tasks, settings, today) {
  let changed = false;
  const snapshot = buildDailySnapshot(tasks, settings, today);
  if (!sameSnapshot(history[today], snapshot)) {
    history[today] = snapshot;
    changed = true;
  }
  Object.keys(history).forEach(date => {
    if (date === today) return;
    const age = calendarDaysBetween(date, today);
    if (!Number.isFinite(age) || age < 0 || age > HISTORY_KEEP_DAYS) {
      delete history[date];
      changed = true;
    }
  });
  return changed;
}

// The most recent snapshot from a day before `today`: { date, snapshot, daysAgo }, or null
// when the app has never been opened on an earlier day. Normally that's yesterday; if the
// app sat closed for a few days it's the last day it was open, and the view says so.
function findDigestBaseline(history, today) {
  const dates = Object.keys(history).filter(date => date < today).sort();
  if (dates.length === 0) return null;
  const date = dates[dates.length - 1];
  return { date, snapshot: history[date], daysAgo: calendarDaysBetween(date, today) };
}

// One-line reason for a task's quadrant change, built from what moved: the importance
// bucket (a manual edit) and/or the urgency bucket (the engine, or a deadline/flag edit).
// The urgency reason is the live one ("due in 2 days", "untouched 9 days", "flagged urgent").
function describeQuadrantChange(fromKey, task, assessment) {
  const to = assessment.quadrant;
  const from = fromKey ? QUADRANTS[fromKey] : null;
  const parts = [];
  if (from && from.importance !== to.importance) {
    parts.push("importance now " + task.importance);
  }
  if (!from || from.urgency !== to.urgency || parts.length === 0) {
    parts.push(assessment.urgency.reason);
  }
  return parts.join(", ");
}

// True when any of the four fields that can cause a manual quadrant shift differ from the
// baseline snapshot: the task's deadline, importance, or urgent flag was edited, or it was
// touched (edited, bumped, or checked and un-checked) since that snapshot was taken. A task
// that moved quadrants with none of these different did so purely because a day passed —
// a deadline got closer, or staleness ticked up — with nobody touching it.
function movedByManualEdit(fromRecord, task) {
  return (fromRecord.deadline || null) !== (task.deadline || null)
    || fromRecord.importance !== task.importance
    || !!fromRecord.manual_urgent_flag !== !!task.manual_urgent_flag
    || (fromRecord.last_touched_at || null) !== (task.last_touched_at || null);
}

// Diffs today's live quadrants against the baseline snapshot. Returns
// { baseline, primary, secondary, entered, left }; every list is sorted most-actionable-first.
//   primary:   quadrant shifted with deadline/importance/flag/last_touched_at all unchanged
//              since the baseline — automatic drift, the digest's core purpose
//              { task, from, to, assessment, reason, scoreFrom, scoreTo }
//   secondary: quadrant shifted AND one of those fields changed too — a manual edit caused
//              or contributed to it; same shape as primary, shown de-emphasized
//   entered:   active tasks with no baseline entry (new or reopened) { task, to, assessment, reason }
//   left:      baseline tasks no longer active (done/dropped)        { task, from, status }
// A task whose priority_score moved but stayed in the same quadrant isn't surfaced at all —
// that's routine daily creep, not the boundary-crossing signal this digest exists to catch.
// Deleted tasks can't be named (only their id was stored), so they're skipped.
function buildDigest(history, tasks, settings, today) {
  const baseline = findDigestBaseline(history, today);
  if (!baseline) return { baseline: null, primary: [], secondary: [], entered: [], left: [] };

  const previous = baseline.snapshot;
  const primary = [];
  const secondary = [];
  const entered = [];
  const left = [];

  tasks.forEach(task => {
    const fromRecord = previous[task.id];
    if (task.status !== "active") {
      if (fromRecord) left.push({ task, from: QUADRANTS[fromRecord.quadrant], status: task.status });
      return;
    }

    const assessment = assessTask(task, settings, today);
    const to = assessment.quadrant;

    if (!fromRecord) {
      entered.push({ task, to, assessment, reason: describeQuadrantChange(null, task, assessment) });
      return;
    }
    if (fromRecord.quadrant === to.key) return; // still here, whatever the score did

    const entry = {
      task, from: QUADRANTS[fromRecord.quadrant], to, assessment,
      reason: describeQuadrantChange(fromRecord.quadrant, task, assessment),
      scoreFrom: fromRecord.priorityScore, scoreTo: assessment.priorityScore,
    };
    (movedByManualEdit(fromRecord, task) ? secondary : primary).push(entry);
  });

  const byDestination = (a, b) =>
    QUADRANT_RANK[a.to.key] - QUADRANT_RANK[b.to.key] || b.assessment.priorityScore - a.assessment.priorityScore;
  primary.sort(byDestination);
  secondary.sort(byDestination);
  entered.sort(byDestination);
  left.sort((a, b) => QUADRANT_RANK[a.from.key] - QUADRANT_RANK[b.from.key] || a.task.title.localeCompare(b.task.title));

  return { baseline, primary, secondary, entered, left };
}

// "yesterday", or "Fri 12 Sep (3 days ago)" when the app wasn't opened yesterday.
function describeBaseline(baseline) {
  if (baseline.daysAgo <= 1) return "yesterday";
  const label = parseLocalDate(baseline.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return label + " (" + baseline.daysAgo + " days ago)";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HISTORY_KEEP_DAYS, QUADRANT_RANK, buildDailySnapshot, snapshotRecordsEqual, sameSnapshot,
    sanitizeQuadrantHistory, recordQuadrantSnapshot, findDigestBaseline, describeQuadrantChange,
    movedByManualEdit, buildDigest, describeBaseline,
  };
}
