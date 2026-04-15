// Sales goals per rep — parsed from "Calculation for Claude-Apr14.pptx"
// PPT gives explicit weekly targets: deals to win, deals to create (opps), MQLs
// Derived: revenue = deals × avgDealValue, pipeline = opps × avgDealValue

const REP_GOALS = {
  // ── SMB Team (avgDealValue: $8K) ──
  'Vicky':   {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 2, opps: 5, mqls: 12 },
  },
  'Royston': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 2, opps: 5, mqls: 12 },
  },
  'Lawrence': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 2, opps: 5, mqls: 12 },
  },
  'Kritika': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 1, opps: 3, mqls: 8 },
  },
  'Yogi': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 1, opps: 3, mqls: 8 },
  },
  'Deepak': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 1, opps: 3, mqls: 8 },
  },
  'Rutuja': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 1, opps: 3, mqls: 8 },
  },
  'Kartik': {
    team: 'smb', avgDealValue: 8000,
    weekly: { deals: 0, opps: 0, mqls: 0 },
  },

  // ── AM Team (avgDealValue: $4K) ──
  'Joy': {
    team: 'am', avgDealValue: 4000,
    weekly: { deals: 3, opps: 6, mqls: 0 },
  },
  'Vivin': {
    team: 'am', avgDealValue: 4000,
    weekly: { deals: 3, opps: 6, mqls: 0 },
  },
  'Arundhati': {
    team: 'am', avgDealValue: 4000,
    weekly: { deals: 3, opps: 6, mqls: 0 },
  },

  // ── Ent Team (kept from previous config, not in PPT) ──
  'Anthony': {
    team: 'ent', avgDealValue: 75000,
    weekly: { deals: 1, opps: 2, mqls: 0 },
  },
  'Lennis': {
    team: 'ent', avgDealValue: 25000,
    weekly: { deals: 1, opps: 2, mqls: 0 },
  },
};

/**
 * Derive full weekly goals from the explicit weekly targets.
 * revenue = deals × avgDealValue
 * pipeline = opps × avgDealValue
 */
function deriveWeeklyGoals(repConfig) {
  const { avgDealValue, weekly } = repConfig;
  return {
    revenue: weekly.deals * avgDealValue,
    deals: weekly.deals,
    pipeline: weekly.opps * avgDealValue,
    opps: weekly.opps,
    mqls: weekly.mqls,
  };
}

/**
 * Derive monthly goals (weekly × 4).
 */
function deriveMonthlyGoals(repConfig) {
  const w = deriveWeeklyGoals(repConfig);
  return {
    revenue: w.revenue * 4,
    deals: w.deals * 4,
    pipeline: w.pipeline * 4,
    opps: w.opps * 4,
    mqls: w.mqls * 4,
  };
}

/**
 * Get the month key (YYYY-MM) for a given date string (YYYY-MM-DD).
 */
function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

// Team definitions for the goals tracker
const GOALS_TEAMS = [
  { id: 'smb', name: 'SMB Team' },
  { id: 'am', name: 'AM Team' },
  { id: 'ent', name: 'Ent Team' },
];

// Week 1 starts Monday Apr 6, 2026. Each week = Mon-Fri (5 weekdays).
const PROGRAM_START = '2026-04-06';

function getWeekRanges(numWeeks) {
  const ranges = [];
  const start = new Date(PROGRAM_START + 'T00:00:00Z');
  for (let i = 0; i < numWeeks; i++) {
    const weekStart = new Date(start);
    weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 4); // Mon-Fri
    const monthKey = getMonthKey(weekStart.toISOString().slice(0, 10));
    ranges.push({
      week: i + 1,
      label: `Week ${i + 1}`,
      start: weekStart.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10),
      startDisplay: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      endDisplay: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      monthKey,
    });
  }
  return ranges;
}

function getMonthRanges(numMonths) {
  const ranges = [];
  for (let i = 0; i < numMonths; i++) {
    const monthStart = new Date(Date.UTC(2026, 3 + i, 1));
    const monthEnd = new Date(Date.UTC(2026, 3 + i + 1, 0));
    ranges.push({
      month: i + 1,
      label: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      start: monthStart.toISOString().slice(0, 10),
      end: monthEnd.toISOString().slice(0, 10),
      monthKey: getMonthKey(monthStart.toISOString().slice(0, 10)),
    });
  }
  return ranges;
}

module.exports = {
  REP_GOALS, GOALS_TEAMS, PROGRAM_START,
  getWeekRanges, getMonthRanges,
  deriveWeeklyGoals, deriveMonthlyGoals, getMonthKey,
};
