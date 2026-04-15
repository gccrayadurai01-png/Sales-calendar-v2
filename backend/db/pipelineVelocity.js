// Pipeline Velocity — stage transition analysis

const ALLOWED_REPS = [
  'Vicky Cariappa', 'Royston Aden', 'Lawrence Lewis', 'Yogesh Vig',
  'Kritika Gupta', 'Kartik Kashyap', 'Deepak R J',
  'Joy Prakash', 'Arundhati Sen', 'Vivin Joseph',
  'Anthony Raymond',
];

const TEAMS = [
  { id: 'smb', name: 'SMB Team', reps: ['Vicky Cariappa', 'Royston Aden', 'Lawrence Lewis', 'Yogesh Vig', 'Kritika Gupta', 'Kartik Kashyap', 'Deepak R J'] },
  { id: 'am', name: 'AM Team', reps: ['Joy Prakash', 'Arundhati Sen', 'Vivin Joseph'] },
  { id: 'ent', name: 'Ent Team', reps: ['Anthony Raymond'] },
];

function getRepTeam(fullName) {
  const lower = fullName.toLowerCase();
  return TEAMS.find(t => t.reps.some(r => r.toLowerCase() === lower)) || null;
}

function getPipelineVelocity(db) {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  // Resolve allowed owner IDs
  const owners = db.prepare('SELECT * FROM owners').all();
  const ownerMap = {};
  for (const o of owners) {
    const fullName = `${o.firstName || ''} ${o.lastName || ''}`.trim();
    ownerMap[o.id] = { id: o.id, fullName, email: o.email };
  }
  const allowedOwnerIds = Object.entries(ownerMap)
    .filter(([, o]) => ALLOWED_REPS.some(r => r.toLowerCase() === o.fullName.toLowerCase()))
    .map(([id]) => id);

  if (allowedOwnerIds.length === 0) {
    return { stages: [], funnel: [], timeInStage: [], wonVsLost: { won: [], lost: [] }, repVelocity: [], companyAvg: {}, insights: [], meta: { year, totalDeals: 0, dealsWithStageData: 0 } };
  }

  const placeholders = allowedOwnerIds.map(() => '?').join(',');

  // Get all stages ordered
  const stages = db.prepare('SELECT * FROM stages ORDER BY displayOrder').all();

  // Get all stage transitions for deals in the time window
  const rows = db.prepare(`
    SELECT dsd.deal_id, dsd.stage_id, dsd.date_entered,
           s.label, s.displayOrder, s.pipelineId, s.pipelineLabel, s.probability as stage_prob,
           d.hubspot_owner_id, d.dealstage, d.amount, d.createdate, d.closedate
    FROM deal_stage_dates dsd
    JOIN stages s ON dsd.stage_id = s.id
    JOIN deals d ON d.id = dsd.deal_id
    WHERE d.archived = 0
      AND d.createdate >= ?
      AND d.hubspot_owner_id IN (${placeholders})
    ORDER BY dsd.deal_id, s.displayOrder
  `).all(yearStart, ...allowedOwnerIds);

  // Get current stage probability for each deal (to determine outcome)
  const dealOutcomeRows = db.prepare(`
    SELECT d.id as deal_id, s.probability as current_prob
    FROM deals d
    LEFT JOIN stages s ON d.dealstage = s.id
    WHERE d.archived = 0 AND d.createdate >= ? AND d.hubspot_owner_id IN (${placeholders})
  `).all(yearStart, ...allowedOwnerIds);

  const dealOutcome = {};
  for (const r of dealOutcomeRows) {
    if (r.current_prob === 1.0) dealOutcome[r.deal_id] = 'won';
    else if (r.current_prob === 0) dealOutcome[r.deal_id] = 'lost';
    else dealOutcome[r.deal_id] = 'active';
  }

  // Group rows by deal
  const dealStages = {};
  for (const r of rows) {
    if (!dealStages[r.deal_id]) dealStages[r.deal_id] = [];
    dealStages[r.deal_id].push(r);
  }

  // Compute transitions (consecutive stage pairs within same pipeline)
  const transitions = [];
  for (const [dealId, stageList] of Object.entries(dealStages)) {
    // Already sorted by displayOrder from SQL
    for (let i = 0; i < stageList.length - 1; i++) {
      const from = stageList[i];
      const to = stageList[i + 1];
      if (from.pipelineId !== to.pipelineId) continue;
      if (!from.date_entered || !to.date_entered) continue;
      const days = (new Date(to.date_entered) - new Date(from.date_entered)) / (1000 * 60 * 60 * 24);
      if (days < 0) continue;
      transitions.push({
        dealId,
        fromStageId: from.stage_id,
        fromLabel: from.label,
        fromOrder: from.displayOrder,
        toStageId: to.stage_id,
        toLabel: to.label,
        toOrder: to.displayOrder,
        pipelineId: from.pipelineId,
        days,
        ownerId: from.hubspot_owner_id,
        outcome: dealOutcome[dealId] || 'active',
        amount: from.amount || 0,
      });
    }
  }

  // ── 1. Stage Funnel ──
  // Count distinct deals that entered each stage
  const stageDealSets = {};
  const stageAmounts = {};
  for (const r of rows) {
    if (!stageDealSets[r.stage_id]) { stageDealSets[r.stage_id] = new Set(); stageAmounts[r.stage_id] = 0; }
    stageDealSets[r.stage_id].add(r.deal_id);
    // Only count amount once per deal per stage
    if (!stageDealSets[r.stage_id].has(`${r.deal_id}_amt`)) {
      stageDealSets[r.stage_id].add(`${r.deal_id}_amt`);
      stageAmounts[r.stage_id] += (r.amount || 0);
    }
  }

  // Build funnel using the ordered stages
  const funnel = stages
    .filter(s => stageDealSets[s.id])
    .map(s => ({
      stageId: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
      probability: s.probability,
      dealCount: stageDealSets[s.id] ? [...stageDealSets[s.id]].filter(k => !String(k).endsWith('_amt')).length : 0,
      totalAmount: Math.round(stageAmounts[s.id] || 0),
    }));

  // Compute conversion rates
  for (let i = 0; i < funnel.length - 1; i++) {
    const curr = funnel[i];
    const next = funnel[i + 1];
    curr.conversionToNext = curr.dealCount > 0 ? Math.round((next.dealCount / curr.dealCount) * 100) : 0;
    curr.dropOffPct = 100 - curr.conversionToNext;
  }
  if (funnel.length > 0) {
    funnel[funnel.length - 1].conversionToNext = null;
    funnel[funnel.length - 1].dropOffPct = null;
  }

  // ── 2. Time in Stage ──
  const stageTimeMap = {};
  for (const t of transitions) {
    if (!stageTimeMap[t.fromStageId]) stageTimeMap[t.fromStageId] = { label: t.fromLabel, order: t.fromOrder, days: [] };
    stageTimeMap[t.fromStageId].days.push(t.days);
  }

  const timeInStage = Object.entries(stageTimeMap)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([stageId, data]) => {
      const sorted = [...data.days].sort((a, b) => a - b);
      return {
        stageId,
        label: data.label,
        displayOrder: data.order,
        avgDays: Math.round((sorted.reduce((s, d) => s + d, 0) / sorted.length) * 10) / 10,
        minDays: Math.round(sorted[0] * 10) / 10,
        maxDays: Math.round(sorted[sorted.length - 1] * 10) / 10,
        medianDays: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
        transitionCount: sorted.length,
      };
    });

  // ── 3. Won vs Lost ──
  const wonLostMap = { won: {}, lost: {} };
  for (const t of transitions) {
    if (t.outcome !== 'won' && t.outcome !== 'lost') continue;
    const bucket = wonLostMap[t.outcome];
    if (!bucket[t.fromStageId]) bucket[t.fromStageId] = { label: t.fromLabel, order: t.fromOrder, days: [] };
    bucket[t.fromStageId].days.push(t.days);
  }

  const wonVsLost = {};
  for (const outcome of ['won', 'lost']) {
    wonVsLost[outcome] = Object.entries(wonLostMap[outcome])
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([stageId, data]) => ({
        stageId,
        label: data.label,
        avgDays: Math.round((data.days.reduce((s, d) => s + d, 0) / data.days.length) * 10) / 10,
        count: data.days.length,
      }));
  }

  // ── 4. Per-Rep Velocity ──
  const repTransMap = {};
  for (const t of transitions) {
    if (!repTransMap[t.ownerId]) repTransMap[t.ownerId] = { all: [], byStage: {} };
    repTransMap[t.ownerId].all.push(t.days);
    if (!repTransMap[t.ownerId].byStage[t.fromStageId]) {
      repTransMap[t.ownerId].byStage[t.fromStageId] = { label: t.fromLabel, order: t.fromOrder, days: [] };
    }
    repTransMap[t.ownerId].byStage[t.fromStageId].days.push(t.days);
  }

  // Also get cycle days (create-to-close for won deals)
  const cycleRows = db.prepare(`
    SELECT hubspot_owner_id,
      AVG(julianday(closedate) - julianday(createdate)) as avg_cycle_days,
      COUNT(*) as won_count
    FROM deals d
    JOIN stages s ON d.dealstage = s.id
    WHERE d.archived = 0 AND d.createdate >= ? AND s.probability = 1.0
      AND d.hubspot_owner_id IN (${placeholders})
    GROUP BY hubspot_owner_id
  `).all(yearStart, ...allowedOwnerIds);

  const cycleMap = {};
  for (const r of cycleRows) cycleMap[r.hubspot_owner_id] = r;

  // Total deals per rep (with stage data)
  const repDealCounts = {};
  for (const [dealId, stageList] of Object.entries(dealStages)) {
    const ownerId = stageList[0].hubspot_owner_id;
    if (!repDealCounts[ownerId]) repDealCounts[ownerId] = new Set();
    repDealCounts[ownerId].add(dealId);
  }

  const repVelocity = allowedOwnerIds
    .filter(id => repTransMap[id])
    .map(ownerId => {
      const owner = ownerMap[ownerId];
      const team = getRepTeam(owner.fullName);
      const trans = repTransMap[ownerId];
      const allDays = trans.all;
      const avgStageDays = Math.round((allDays.reduce((s, d) => s + d, 0) / allDays.length) * 10) / 10;
      const cycle = cycleMap[ownerId];

      const stageBreakdown = Object.entries(trans.byStage)
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([stageId, data]) => ({
          stageId,
          label: data.label,
          avgDays: Math.round((data.days.reduce((s, d) => s + d, 0) / data.days.length) * 10) / 10,
          transitionCount: data.days.length,
        }));

      return {
        ownerId,
        name: owner.fullName,
        teamId: team?.id || null,
        teamName: team?.name || 'Unknown',
        avgStageDays,
        avgCycleDays: cycle ? Math.round(cycle.avg_cycle_days) : null,
        wonCount: cycle?.won_count || 0,
        totalDeals: repDealCounts[ownerId]?.size || 0,
        transitionCount: allDays.length,
        stageBreakdown,
      };
    });

  // ── Company Averages ──
  const allTransDays = transitions.map(t => t.days);
  const companyAvgStageDays = allTransDays.length > 0
    ? Math.round((allTransDays.reduce((s, d) => s + d, 0) / allTransDays.length) * 10) / 10
    : 0;
  const allCycles = cycleRows.map(r => r.avg_cycle_days).filter(Boolean);
  const companyAvgCycleDays = allCycles.length > 0
    ? Math.round(allCycles.reduce((s, d) => s + d, 0) / allCycles.length)
    : 0;

  const companyAvg = { avgStageDays: companyAvgStageDays, avgCycleDays: companyAvgCycleDays };

  // ── 5. Rule-Based Insights ──
  const insights = [];
  const totalDeals = Object.keys(dealStages).length;

  // Low data warning
  if (totalDeals < 5) {
    insights.push({ type: 'warning', icon: '\u26a0\ufe0f', text: `Limited data (${totalDeals} deals with stage transitions). Insights may not be statistically meaningful.` });
  }

  // Bottleneck detection
  if (timeInStage.length >= 2) {
    const overallAvg = companyAvgStageDays;
    for (const s of timeInStage) {
      if (s.avgDays > overallAvg * 2 && s.transitionCount >= 5) {
        insights.push({
          type: 'danger',
          icon: '!',
          text: `"${s.label}" is a bottleneck \u2014 deals spend ${s.avgDays}d here vs ${overallAvg}d avg across other stages`,
          metric: `${s.transitionCount} transitions observed`,
        });
      }
    }
  }

  // Funnel leak detection
  for (const f of funnel) {
    if (f.dropOffPct !== null && f.dropOffPct > 50 && f.dealCount >= 10) {
      const nextStage = funnel.find(s => s.displayOrder > f.displayOrder);
      if (nextStage) {
        insights.push({
          type: 'warning',
          icon: '\ud83d\udea8',
          text: `Only ${f.conversionToNext}% of deals advance from "${f.label}" to "${nextStage.label}" \u2014 biggest funnel leak`,
          metric: `${f.dealCount} \u2192 ${nextStage.dealCount} deals`,
        });
      }
    }
  }

  // Won vs Lost speed gap
  for (const ws of wonVsLost.won || []) {
    const ls = (wonVsLost.lost || []).find(l => l.stageId === ws.stageId);
    if (ls && ws.count >= 3 && ls.count >= 3) {
      const gap = ((ls.avgDays - ws.avgDays) / ls.avgDays) * 100;
      if (gap > 30) {
        insights.push({
          type: 'info',
          icon: '\ud83d\udcc8',
          text: `Won deals move through "${ws.label}" ${Math.round(gap)}% faster than lost deals (${ws.avgDays}d vs ${ls.avgDays}d) \u2014 stalling here signals risk`,
        });
      }
    }
  }

  // Slow reps
  if (companyAvgStageDays > 0) {
    for (const r of repVelocity) {
      if (r.avgStageDays > companyAvgStageDays * 1.5 && r.transitionCount >= 10) {
        const pctSlower = Math.round(((r.avgStageDays - companyAvgStageDays) / companyAvgStageDays) * 100);
        insights.push({
          type: 'warning',
          icon: '\ud83d\udc22',
          text: `${r.name} moves deals ${pctSlower}% slower than average (${r.avgStageDays}d vs ${companyAvgStageDays}d avg)`,
          metric: `${r.transitionCount} transitions`,
        });
      }
    }
    // Fast reps
    for (const r of repVelocity) {
      if (r.avgStageDays < companyAvgStageDays * 0.5 && r.transitionCount >= 10) {
        insights.push({
          type: 'success',
          icon: '\u26a1',
          text: `${r.name} is the fastest at advancing deals \u2014 ${r.avgStageDays}d avg vs ${companyAvgStageDays}d company avg`,
          metric: `${r.wonCount} won`,
        });
      }
    }
  }

  return {
    stages: stages.map(s => ({ id: s.id, label: s.label, displayOrder: s.displayOrder, probability: s.probability, pipelineId: s.pipelineId, pipelineLabel: s.pipelineLabel })),
    funnel,
    timeInStage,
    wonVsLost,
    repVelocity,
    companyAvg,
    insights: insights.slice(0, 8),
    meta: { year, totalDeals, dealsWithStageData: Object.keys(dealStages).length },
  };
}

module.exports = { getPipelineVelocity };
