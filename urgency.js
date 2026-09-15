// Urgency engine: pure functions shared by the List view (heat-map rows) and, later, the
// Matrix/Digest view and top banner. Nothing here touches the DOM or storage.
// Every threshold is read from the settings object passed in (see DEFAULT_SETTINGS for
// the keys); urgency, priority score and quadrant are always derived, never stored.
//
// Only regular Tasks go through this engine. RecurringTasks live outside the matrix and
// are never scored.

const DEFAULT_SETTINGS = Object.freeze({
  deadline_low_days: 14,
  deadline_medium_days: 7,
  deadline_high_days: 3,
  staleness_low_days: 3,
  staleness_medium_days: 7,
  staleness_high_days: 8,
  priority_importance_weight: 0.5, // 0 = urgency only, 1 = importance only
  quadrant_split_score: 62.5,     // 0-100 boundary between the low and high bucket on BOTH axes
  overview_top_n: 3,              // priority panel: always show at least this many
  overview_flag_threshold: 80,    // priority panel: and anything scoring at or above this
  overview_display_mode: "scatter", // "scatter" | "list"
});

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

// Settings that are a 0-1 fraction rather than a day count / percentage.
const FRACTION_SETTINGS = new Set(["priority_importance_weight"]);

// Settings on a 0-100 score scale (clamped at 100).
const SCORE_SETTINGS = new Set(["quadrant_split_score", "overview_flag_threshold"]);

// Settings that are a choice between fixed strings rather than a number.
const CHOICE_SETTINGS = Object.freeze({ overview_display_mode: ["scatter", "list"] });

// Fill gaps with defaults and coerce to sane numbers, so an older data file or a
// hand-edited one can't break the engine.
function normalizeSettings(raw) {
  const out = {};
  SETTINGS_KEYS.forEach(key => {
    if (CHOICE_SETTINGS[key]) {
      const choice = raw ? raw[key] : undefined;
      out[key] = CHOICE_SETTINGS[key].includes(choice) ? choice : DEFAULT_SETTINGS[key];
      return;
    }
    const value = raw && raw[key] !== undefined && raw[key] !== null ? Number(raw[key]) : NaN;
    if (!Number.isFinite(value) || value < 0) {
      out[key] = DEFAULT_SETTINGS[key];
    } else if (FRACTION_SETTINGS.has(key)) {
      out[key] = Math.min(1, value);
    } else if (SCORE_SETTINGS.has(key)) {
      out[key] = Math.min(100, value);
    } else if (key === "overview_top_n") {
      out[key] = Math.round(value);
    } else {
      out[key] = value;
    }
  });
  return out;
}

const IMPORTANCE_SCORES = Object.freeze({ Low: 25, Medium: 50, High: 75, Critical: 100 });

// Score reached exactly at each configured day threshold. Between thresholds the score is
// interpolated so it creeps a little every day instead of jumping in steps.
const URGENCY_LEVEL_SCORES = Object.freeze({ Low: 10, Medium: 40, High: 75, Critical: 100 });

// Hue is fixed per quadrant ("why is this a priority"); intensity comes from priority_score.
const QUADRANTS = Object.freeze({
  q1: Object.freeze({ key: "q1", label: "Do", importance: "high", urgency: "high" }),
  q2: Object.freeze({ key: "q2", label: "Remember", importance: "high", urgency: "low" }),
  q3: Object.freeze({ key: "q3", label: "Clear", importance: "low", urgency: "high" }),
  q4: Object.freeze({ key: "q4", label: "Backlog", importance: "low", urgency: "low" }),
});

const MS_PER_DAY = 86400000;

// ---------- Calendar-day helpers (local time, whole days) ----------

function localDateString(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

// Accepts "YYYY-MM-DD" or any ISO timestamp and returns the local calendar date string.
function toLocalDateString(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return localDateString(new Date(value));
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Whole calendar days from `from` to `to` (negative when `to` is earlier). Compares local
// dates, so a task touched at 23:59 yesterday counts as untouched for 1 day today.
function calendarDaysBetween(from, to) {
  const a = parseLocalDate(toLocalDateString(from));
  const b = parseLocalDate(toLocalDateString(to));
  return Math.round((b - a) / MS_PER_DAY);
}

// ---------- Scoring ----------

// Piecewise-linear interpolation through [x, y] anchor points, clamped at both ends.
// Points may be given in any order; ties on x resolve to the higher y (safe if a user
// sets two thresholds to the same number of days).
function interpolate(x, points) {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) {
      if (x1 === x0) return y1;
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

// Deadline path: ~10 at deadline_low_days out, ~40 at medium, ~75 at high, 100 on the
// day or overdue. Rises linearly between those anchors, stays at 10 further out.
function deadlineUrgencyScore(daysUntil, settings) {
  if (daysUntil <= 0) return URGENCY_LEVEL_SCORES.Critical;
  return interpolate(daysUntil, [
    [0, URGENCY_LEVEL_SCORES.Critical],
    [settings.deadline_high_days, URGENCY_LEVEL_SCORES.High],
    [settings.deadline_medium_days, URGENCY_LEVEL_SCORES.Medium],
    [settings.deadline_low_days, URGENCY_LEVEL_SCORES.Low],
  ]);
}

// Staleness path (no deadline): ~10 when touched today, ~40 at staleness_low_days
// untouched, ~75 at medium ("going stale"), and tops out at 100 at staleness_high_days
// so a neglected task keeps climbing instead of parking at High forever.
function stalenessUrgencyScore(daysSinceTouched, settings) {
  return interpolate(daysSinceTouched, [
    [0, URGENCY_LEVEL_SCORES.Low],
    [settings.staleness_low_days, URGENCY_LEVEL_SCORES.Medium],
    [settings.staleness_medium_days, URGENCY_LEVEL_SCORES.High],
    [settings.staleness_high_days, URGENCY_LEVEL_SCORES.Critical],
  ]);
}

function urgencyLevel(score) {
  if (score >= URGENCY_LEVEL_SCORES.Critical) return "Critical";
  if (score >= URGENCY_LEVEL_SCORES.High) return "High";
  if (score >= URGENCY_LEVEL_SCORES.Medium) return "Medium";
  return "Low";
}

function pluralDays(n) {
  return n + (n === 1 ? " day" : " days");
}

// Returns { score (0-100 integer), level, basis, days, reason }.
// `today` is a "YYYY-MM-DD" string so callers (and tests) can pin the date.
function computeUrgency(task, settings, today) {
  if (task.manual_urgent_flag) {
    return { score: 100, level: "Critical", basis: "manual", days: null, reason: "flagged urgent" };
  }

  if (task.deadline) {
    const days = calendarDaysBetween(today, task.deadline);
    const raw = deadlineUrgencyScore(days, settings);
    let reason;
    if (days < 0) reason = "overdue by " + pluralDays(-days);
    else if (days === 0) reason = "due today";
    else reason = "due in " + pluralDays(days);
    return { score: Math.round(raw), level: urgencyLevel(raw), basis: "deadline", days, reason };
  }

  const touched = task.last_touched_at || task.created_at || today;
  const days = Math.max(0, calendarDaysBetween(touched, today));
  const raw = stalenessUrgencyScore(days, settings);
  const reason = days === 0 ? "touched today" : "untouched " + pluralDays(days);
  return { score: Math.round(raw), level: urgencyLevel(raw), basis: "staleness", days, reason };
}

// ---------- Eisenhower quadrant ----------

function importanceScore(importance) {
  return IMPORTANCE_SCORES[importance] !== undefined ? IMPORTANCE_SCORES[importance] : IMPORTANCE_SCORES.Low;
}

// Both axes bucket at the same explicit boundary, quadrant_split_score (default 62.5: the
// midpoint between Medium 50 and High 75, so Low/Medium -> "low" and High/Critical -> "high"
// for importance). The scatter plot draws its quadrant backgrounds at this exact number,
// so a dot's hue always matches the region it sits in.
function splitScore(settings) {
  const s = settings && Number(settings.quadrant_split_score);
  return Number.isFinite(s) ? s : DEFAULT_SETTINGS.quadrant_split_score;
}

function importanceBucket(importance, settings) {
  return importanceScore(importance) >= splitScore(settings) ? "high" : "low";
}

function urgencyBucket(urgencyScore, settings) {
  return urgencyScore >= splitScore(settings) ? "high" : "low";
}

function quadrantFor(impBucket, urgBucket) {
  if (impBucket === "high") return urgBucket === "high" ? QUADRANTS.q1 : QUADRANTS.q2;
  return urgBucket === "high" ? QUADRANTS.q3 : QUADRANTS.q4;
}

// ---------- Priority score ----------

// priority_score = w × importance + (1 − w) × urgency, both on 0-100 scales. Continuous, so
// two tasks that sit near each other in importance/urgency get near-identical scores even
// when the bucketing drops them into different quadrants.
function priorityScore(impScore, urgencyScore, settings) {
  const w = settings.priority_importance_weight;
  return w * impScore + (1 - w) * urgencyScore;
}

// The lowest and highest priority_score a task can have while sitting in this quadrant,
// given the current weight. Importance is the discrete label scores on that side of the
// split; urgency is the continuous range on that side (low: 10 up to the split, high:
// split to 100).
function priorityRangeFor(quadrant, settings) {
  const split = splitScore(settings);
  const labelScores = Object.values(IMPORTANCE_SCORES);
  const side = labelScores.filter(s => (quadrant.importance === "high" ? s >= split : s < split));
  const imp = side.length
    ? [Math.min(...side), Math.max(...side)]
    : (quadrant.importance === "high" ? [IMPORTANCE_SCORES.Critical, IMPORTANCE_SCORES.Critical] : [IMPORTANCE_SCORES.Low, IMPORTANCE_SCORES.Low]);
  const urg = quadrant.urgency === "high"
    ? [Math.min(split, URGENCY_LEVEL_SCORES.Critical), URGENCY_LEVEL_SCORES.Critical]
    : [Math.min(URGENCY_LEVEL_SCORES.Low, split), split];
  return {
    min: priorityScore(imp[0], urg[0], settings),
    max: priorityScore(imp[1], urg[1], settings),
  };
}

// Where this task's priority_score falls inside its quadrant's attainable range, 0-1.
// Drives the heat-map intensity: a task that barely qualifies for "Do" is pale, a
// 100/100 task is vivid, and a Backlog task visibly darkens as it climbs toward the edge.
function priorityIntensity(score, quadrant, settings) {
  const { min, max } = priorityRangeFor(quadrant, settings);
  if (max <= min) return 1;
  return Math.min(1, Math.max(0, (score - min) / (max - min)));
}

// Everything the views need for one task, computed together:
// { urgency, importanceScore, priorityScore (0-100 integer), intensity (0-1), quadrant }
function assessTask(task, settings, today) {
  const day = today || localDateString(new Date());
  const urgency = computeUrgency(task, settings, day);
  const impScore = importanceScore(task.importance);
  const quadrant = quadrantFor(importanceBucket(task.importance, settings), urgencyBucket(urgency.score, settings));
  const priority = priorityScore(impScore, urgency.score, settings);
  return {
    urgency,
    importanceScore: impScore,
    priorityScore: Math.round(priority),
    intensity: priorityIntensity(priority, quadrant, settings),
    quadrant,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_SETTINGS, SETTINGS_KEYS, normalizeSettings, IMPORTANCE_SCORES, URGENCY_LEVEL_SCORES,
    QUADRANTS, localDateString, toLocalDateString, parseLocalDate, calendarDaysBetween, interpolate,
    deadlineUrgencyScore, stalenessUrgencyScore, urgencyLevel, computeUrgency,
    importanceScore, splitScore, importanceBucket, urgencyBucket, quadrantFor,
    priorityScore, priorityRangeFor, priorityIntensity, assessTask,
  };
}
