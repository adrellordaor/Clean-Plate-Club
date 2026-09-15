// Daily digest: pure functions for the Overview view. Depends on urgency.js (assessTask,
// calendarDaysBetween, parseLocalDate, QUADRANTS) but touches no DOM or storage.
//
// Quadrant and priority_score are derived, never stored on the task — but "what changed
// since yesterday" needs something to diff against, so the app keeps a small rolling window
// of daily snapshots: one per calendar day, mapping each active task's id to a record of
// everything that can drive its quadrant. Today's entry is rewritten every time state is
// saved, so whatever the app last saw on a given day is that day's end-of-day snapshot. The
// history lives in the synced data file so both devices diff against the same baseline.
//
// Two tiers, compared against different snapshot pairs (see buildDigest for why):
//   primary:   today's LIVE values vs. yesterday's SNAPSHOT — automatic drift
//   secondary: yesterday's SNAPSHOT vs. the day-before-yesterday's SNAPSHOT — what got
//              edited yesterday, which a live-vs-yesterday comparison can never see, since
//              yesterday's own snapshot already has that edit baked in
// That means only 2-3 days of history are ever needed (today, yesterday, the day before);
// HISTORY_KEEP_DAYS below prunes to a rolling window instead of unbounded history.
//
// Only regular Tasks are snapshotted. RecurringTasks never appear in the matrix or digest.

const HISTORY_KEEP_DAYS = 2; // keeps today + the 2 days before it: exactly what both tiers need

// Order used when listing quadrants in the digest: most actionable first.
const QUADRANT_RANK = { q1: 0, q2: 1, q3: 2, q4: 3 };

// The four raw fields that can cause a manual quadrant shift, in the shape both a live task
// and a stored snapshot record share, so the two can be compared field-for-field.
function snapshotFieldsFor(task) {
  return {
    deadline: task.deadline || null,
    importance: task.importance,
    manual_urgent_flag: !!task.manual_urgent_flag,
    last_touched_at: task.last_touched_at || null,
  };
}

// True when the task's deadline, importance, urgent flag, or last-touched time differ
// between `a` and `b` — the four inputs a quadrant shift can be traced back to. `a` and `b`
// are each either a live task or a stored snapshot record; both shapes carry the same fields.
function fieldsDiffer(a, b) {
  return (a.deadline || null) !== (b.deadline || null)
    || a.importance !== b.importance
    || !!a.manual_urgent_flag !== !!b.manual_urgent_flag
    || (a.last_touched_at || null) !== (b.last_touched_at || null);
}

// Everything about a task that can move it between quadrants or shift its priority_score,
// captured once at (roughly) the end of each day. quadrant/priorityScore are the derived
// outcome; the rest are the raw inputs the digest compares across snapshots.
function buildDailySnapshot(tasks, settings, today) {
  const snapshot = {};
  tasks.forEach(task => {
    if (task.status !== "active") return;
    const assessment = assessTask(task, settings, today);
    snapshot[task.id] = Object.assign(
      { quadrant: assessment.quadrant.key, priorityScore: assessment.priorityScore },
      snapshotFieldsFor(task)
    );
  });
  return snapshot;
}

function snapshotRecordsEqual(a, b) {
  if (!a || !b) return false;
  return a.quadrant === b.quadrant && a.priorityScore === b.priorityScore && !fieldsDiffer(a, b);
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

// Writes today's snapshot into `history` (mutating it) and drops days older than the
// HISTORY_KEEP_DAYS rolling window. Returns true when anything actually changed, so callers
// can skip a save when the file is already up to date (avoids two synced devices rewriting
// the same file back and forth).
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

// The most recent stored snapshot from a day strictly before `beforeDate`: { date, snapshot,
// daysAgo }, or null when there isn't one. Used twice, rooted at two different dates: at
// "today" to find yesterday's snapshot (the primary tier's baseline), and at "yesterday" to
// find the day before that (the secondary tier's baseline) — same "nearest earlier stored
// day" logic either way.
function findNearestSnapshotBefore(history, beforeDate) {
  const dates = Object.keys(history).filter(date => date < beforeDate).sort();
  if (dates.length === 0) return null;
  const date = dates[dates.length - 1];
  return { date, snapshot: history[date], daysAgo: calendarDaysBetween(date, beforeDate) };
}

// Yesterday's snapshot, relative to today — the primary tier's baseline. Normally that's
// literally yesterday; if the app sat closed for a few days it's the last day it was open,
// and the view says so.
function findDigestBaseline(history, today) {
  return findNearestSnapshotBefore(history, today);
}

// One-line reason for a task's quadrant change, built from what moved: the importance
// bucket (a manual edit) and/or the urgency bucket (the engine, or a deadline/flag edit).
// The urgency reason is the live one ("due in 2 days", "untouched 9 days", "flagged urgent").
// Used for the primary tier and for newly-entered tasks, both of which compare against a
// LIVE assessment of the task right now.
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

// One-line reason for the secondary tier, reconstructed purely from two stored snapshot
// records (yesterday's vs. the day before). There's no "live" task to recompute urgency
// from here — this is a look back at a day that's already over — so the reason is built
// straight from which of the four raw fields differ between the two records.
function describeStoredEdit(fromRecord, toRecord) {
  const parts = [];
  if (fromRecord.importance !== toRecord.importance) {
    parts.push("importance changed to " + toRecord.importance);
  }
  if ((fromRecord.deadline || null) !== (toRecord.deadline || null)) {
    parts.push(toRecord.deadline ? "deadline set to " + toRecord.deadline : "deadline cleared");
  }
  if (!!fromRecord.manual_urgent_flag !== !!toRecord.manual_urgent_flag) {
    parts.push(toRecord.manual_urgent_flag ? "flagged urgent" : "urgent flag cleared");
  }
  if (parts.length === 0) {
    // Only last_touched_at differs: an edit, a bump, or a check/uncheck that didn't change
    // any other field — still worth naming, since resetting the staleness clock is itself
    // what caused the shift.
    parts.push("touched");
  }
  return parts.join(", ");
}

// Diffs live and stored quadrants against two different snapshot pairs. Returns
// { baseline, priorBaseline, primary, secondary, entered, left }; every list is sorted
// most-actionable-first.
//   primary:   today's live values vs. yesterday's snapshot (`baseline`). Quadrant shifted
//              with deadline/importance/flag/last_touched_at all unchanged since yesterday
//              — automatic drift, the digest's core purpose.
//              { task, from, to, reason, sortScore }
//   secondary: yesterday's snapshot (`baseline`) vs. the day-before-yesterday's snapshot
//              (`priorBaseline`). Quadrant differs AND one of those fields differs too —
//              a manual edit made *yesterday* caused or contributed to it. This can only be
//              seen by comparing two stored snapshots to each other: by the time "today"
//              rolls around, yesterday's own snapshot already has the edit baked in, so
//              comparing live-vs-yesterday would never surface it. Empty until there are at
//              least two prior days of history. Same shape as primary.
//   entered:   active tasks with no snapshot in `baseline` (new or reopened since then)
//              { task, to, reason, sortScore }
//   left:      tasks in `baseline` no longer active (done/dropped) { task, from, status }
// A task whose priority_score moved but stayed in the same quadrant isn't surfaced at all —
// that's routine daily creep, not the boundary-crossing signal this digest exists to catch.
// A task edited *today* that also crosses a boundary today shows up in neither tier yet —
// it surfaces tomorrow, as a secondary entry, once today's snapshot has been taken.
// Deleted tasks can't be named (only their id was stored), so they're skipped.
function buildDigest(history, tasks, settings, today) {
  const baseline = findNearestSnapshotBefore(history, today);
  if (!baseline) return { baseline: null, priorBaseline: null, primary: [], secondary: [], entered: [], left: [] };

  const yesterday = baseline.snapshot;
  const primary = [];
  const entered = [];
  const left = [];

  tasks.forEach(task => {
    const fromRecord = yesterday[task.id];
    if (task.status !== "active") {
      if (fromRecord) left.push({ task, from: QUADRANTS[fromRecord.quadrant], status: task.status });
      return;
    }

    const assessment = assessTask(task, settings, today);
    const to = assessment.quadrant;

    if (!fromRecord) {
      entered.push({ task, to, reason: describeQuadrantChange(null, task, assessment), sortScore: assessment.priorityScore });
      return;
    }
    if (fromRecord.quadrant === to.key) return; // still here, whatever the score did
    if (fieldsDiffer(fromRecord, snapshotFieldsFor(task))) return; // edited today: neither tier yet, surfaces tomorrow

    primary.push({
      task, from: QUADRANTS[fromRecord.quadrant], to,
      reason: describeQuadrantChange(fromRecord.quadrant, task, assessment),
      sortScore: assessment.priorityScore,
    });
  });

  const secondary = [];
  const priorBaseline = findNearestSnapshotBefore(history, baseline.date);
  if (priorBaseline) {
    const dayBefore = priorBaseline.snapshot;
    Object.keys(yesterday).forEach(taskId => {
      const toRecord = yesterday[taskId];
      const fromRecord = dayBefore[taskId];
      if (!fromRecord) return; // task arrived that day; not a "shift" to report here
      if (fromRecord.quadrant === toRecord.quadrant) return; // no shift that day
      if (!fieldsDiffer(fromRecord, toRecord)) return; // that would have been shown as primary yesterday
      const task = tasks.find(t => t.id === taskId);
      if (!task) return; // deleted since; nothing left to point at
      secondary.push({
        task, from: QUADRANTS[fromRecord.quadrant], to: QUADRANTS[toRecord.quadrant],
        reason: describeStoredEdit(fromRecord, toRecord),
        sortScore: toRecord.priorityScore,
      });
    });
  }

  const byDestination = (a, b) => QUADRANT_RANK[a.to.key] - QUADRANT_RANK[b.to.key] || b.sortScore - a.sortScore;
  primary.sort(byDestination);
  secondary.sort(byDestination);
  entered.sort(byDestination);
  left.sort((a, b) => QUADRANT_RANK[a.from.key] - QUADRANT_RANK[b.from.key] || a.task.title.localeCompare(b.task.title));

  return { baseline, priorBaseline, primary, secondary, entered, left };
}

// "yesterday", or "Fri 12 Sep (3 days ago)" when the app wasn't opened yesterday.
function describeBaseline(baseline) {
  if (baseline.daysAgo <= 1) return "yesterday";
  const label = parseLocalDate(baseline.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return label + " (" + baseline.daysAgo + " days ago)";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HISTORY_KEEP_DAYS, QUADRANT_RANK, snapshotFieldsFor, fieldsDiffer, buildDailySnapshot,
    snapshotRecordsEqual, sameSnapshot, sanitizeQuadrantHistory, recordQuadrantSnapshot,
    findNearestSnapshotBefore, findDigestBaseline, describeQuadrantChange, describeStoredEdit,
    buildDigest, describeBaseline,
  };
}
