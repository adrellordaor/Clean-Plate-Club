// Urgency engine: pure functions shared by the List view (heat-map rows, near-extreme
// flag) and, later, the Matrix/Digest view. Nothing here touches the DOM or storage.
// Every threshold is read from the settings object passed in (see DEFAULT_SETTINGS for
// the keys); urgency, quadrant and the near-extreme flag are always derived, never stored.
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
  near_extreme_threshold: 80,
  productivity_low_pct: 33,
  productivity_high_pct: 66,
});

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

// Fill gaps with defaults and coerce to non-negative numbers, so an older data file or a
// hand-edited one can't break the engine.
function normalizeSettings(raw) {
  const out = {};
  SETTINGS_KEYS.forEach(key => {
    const value = raw && raw[key] !== undefined && raw[key] !== null ? Number(raw[key]) : NaN;
    out[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_SETTINGS[key];
  });
  return out;
}

const IMPORTANCE_SCORES = Object.freeze({ Low: 25, Medium: 50, High: 75, Critical: 100 });

// Score reached exactly at each configured day threshold. Between thresholds the score is
// interpolated so it creeps a little every day instead of jumping in steps.
const URGENCY_LEVEL_SCORES = Object.freeze({ Low: 10, Medium: 40, High: 75, Critical: 100 });

const QUADRANTS = Object.freeze({
  q1: Object.freeze({ key: "q1", label: "Do Now" }),
  q2: Object.freeze({ key: "q2", label: "Plan" }),
  q3: Object.freeze({ key: "q3", label: "Quick Win" }),
  q4: Object.freeze({ key: "q4", label: "Eliminate" }),
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

// Low/Medium -> "low", High/Critical -> "high" — the same bucketing on both axes.
function importanceBucket(importance) {
  return importance === "High" || importance === "Critical" ? "high" : "low";
}

function urgencyBucket(level) {
  return level === "High" || level === "Critical" ? "high" : "low";
}

function quadrantFor(impBucket, urgBucket) {
  if (impBucket === "high") return urgBucket === "high" ? QUADRANTS.q1 : QUADRANTS.q2;
  return urgBucket === "high" ? QUADRANTS.q3 : QUADRANTS.q4;
}

// Everything the views need for one task, computed together:
// { urgency, importanceScore, quadrant, nearExtreme: { urgency, importance, any } }
function assessTask(task, settings, today) {
  const day = today || localDateString(new Date());
  const urgency = computeUrgency(task, settings, day);
  const impScore = importanceScore(task.importance);
  const quadrant = quadrantFor(importanceBucket(task.importance), urgencyBucket(urgency.level));
  const threshold = settings.near_extreme_threshold;
  // Checked per axis on its own, on purpose: this is what catches an urgent-but-unimportant
  // task racing toward critical, and a Critical-importance task that isn't urgent yet.
  const nearExtreme = {
    urgency: urgency.score >= threshold,
    importance: impScore >= threshold,
  };
  nearExtreme.any = nearExtreme.urgency || nearExtreme.importance;
  return { urgency, importanceScore: impScore, quadrant, nearExtreme };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_SETTINGS, SETTINGS_KEYS, normalizeSettings, IMPORTANCE_SCORES, URGENCY_LEVEL_SCORES,
    QUADRANTS, localDateString, toLocalDateString, calendarDaysBetween, interpolate,
    deadlineUrgencyScore, stalenessUrgencyScore, urgencyLevel, computeUrgency,
    importanceScore, importanceBucket, urgencyBucket, quadrantFor, assessTask,
  };
}
