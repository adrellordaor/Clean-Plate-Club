// Daily digest: pure functions for the Matrix/Digest view. Depends on urgency.js
// (assessTask, calendarDaysBetween, parseLocalDate, QUADRANTS) but touches no DOM or storage.
//
// Quadrant is derived, never stored on the task — but "what changed since yesterday" needs
// something to diff against, so the app keeps a small history: one entry per calendar day
// mapping active task id -> quadrant key. Today's entry is rewritten every time state is
// saved, so whatever the app last saw on a given day is that day's end-of-day snapshot.
// The history lives in the synced data file so both devices diff against the same baseline.
//
// Only regular Tasks are snapshotted. RecurringTasks never appear in the matrix or digest.

const HISTORY_KEEP_DAYS = 30;

// Order used when listing quadrants in the digest: most actionable first.
const QUADRANT_RANK = { q1: 0, q2: 1, q3: 2, q4: 3 };

function buildQuadrantSnapshot(tasks, settings, today) {
  const snapshot = {};
  tasks.forEach(task => {
    if (task.status !== "active") return;
    snapshot[task.id] = assessTask(task, settings, today).quadrant.key;
  });
  return snapshot;
}

function sameSnapshot(a, b) {
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(id => a[id] === b[id]);
}

// Writes today's snapshot into `history` (mutating it) and drops days older than
// HISTORY_KEEP_DAYS. Returns true when anything actually changed, so callers can skip a
// save when the file is already up to date (avoids two synced devices rewriting the same
// file back and forth).
function recordQuadrantSnapshot(history, tasks, settings, today) {
  let changed = false;
  const snapshot = buildQuadrantSnapshot(tasks, settings, today);
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

// Diffs today's live quadrants against the baseline snapshot. Returns
// { baseline, moved, entered, left }; every list is sorted most-actionable-first.
//   moved:   tasks in both snapshots whose quadrant differs   { task, from, to, assessment, reason }
//   entered: active tasks with no baseline entry (new or reopened) { task, to, assessment, reason }
//   left:    baseline tasks no longer active (done/dropped)    { task, from, status }
// Deleted tasks can't be named (only their id was stored), so they're skipped.
function buildDigest(history, tasks, settings, today) {
  const baseline = findDigestBaseline(history, today);
  if (!baseline) return { baseline: null, moved: [], entered: [], left: [] };

  const previous = baseline.snapshot;
  const moved = [];
  const entered = [];
  const left = [];

  tasks.forEach(task => {
    const fromKey = previous[task.id];
    if (task.status !== "active") {
      if (fromKey) left.push({ task, from: QUADRANTS[fromKey], status: task.status });
      return;
    }
    const assessment = assessTask(task, settings, today);
    const to = assessment.quadrant;
    if (!fromKey) {
      entered.push({ task, to, assessment, reason: describeQuadrantChange(null, task, assessment) });
    } else if (fromKey !== to.key) {
      moved.push({ task, from: QUADRANTS[fromKey], to, assessment, reason: describeQuadrantChange(fromKey, task, assessment) });
    }
  });

  const byDestination = (a, b) =>
    QUADRANT_RANK[a.to.key] - QUADRANT_RANK[b.to.key] || b.assessment.priorityScore - a.assessment.priorityScore;
  moved.sort(byDestination);
  entered.sort(byDestination);
  left.sort((a, b) => QUADRANT_RANK[a.from.key] - QUADRANT_RANK[b.from.key] || a.task.title.localeCompare(b.task.title));

  return { baseline, moved, entered, left };
}

// "yesterday", or "Fri 12 Sep (3 days ago)" when the app wasn't opened yesterday.
function describeBaseline(baseline) {
  if (baseline.daysAgo <= 1) return "yesterday";
  const label = parseLocalDate(baseline.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return label + " (" + baseline.daysAgo + " days ago)";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HISTORY_KEEP_DAYS, QUADRANT_RANK, buildQuadrantSnapshot, sameSnapshot, recordQuadrantSnapshot,
    findDigestBaseline, describeQuadrantChange, buildDigest, describeBaseline,
  };
}
