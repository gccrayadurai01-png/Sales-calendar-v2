// Pipeline Velocity — stage transition analysis (async, @libsql/client)

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

async function getPipelineVelocity(db) {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  const ownersResult = await db.execute('SELECT * FROM owners');
  const ownerMap = {};
  for (const o of ownersResult.rows) {
    const fullName = `${o.firstName || ''} ${o.lastName || ''}`.trim();
    ownerMap[o.id] = { id: o.id, fullName, email: o.email };
  }

  const allowedOwnerIds = Object.entries(ownerMap)
    .filter(([, o]) => ALLOWED_REPS.some(r => r.toLowerCase() === o.fullName.toLowerCase()))
    .map(([id]) => id);

  const emptyResult = {
    stages: [], funnel: [], timeInStage: [], wonVsLost: { won: [], lost: [] },
    repVelocity: [], companyAvg: {}, insights: [],
    meta: { year, totalDeals: 0, dealsWithStageData: 0 },
  };

  if (allowedOwnerIds.length === 0) return emptyResult;

  const placeholders = allowedOwnerIds.map(() => '?').join(',');

  const stagesResult = await db.execute('SELECT * FROM stages ORDER BY displayOrder');
  const stages = stagesResult.rows;

  const rowsResult = await db.execute({
    sql: `SELECT dsd.deal_id, dsd.stage_id, dsd.date_entered,
                 s.label, s.displayOrder, s.pipelineId, s.pipelineLabel, s.probability as stage_prob,
                 d.hubspot_owner_id, d.dealstage, d.amount, d.createdate, d.closedate
          FROM deal_stage_dates dsd
          JOIN stages s ON dsd.stage_id = s.id
          JOIN deals d ON d.id = dsd.deal_id
          WHERE d.archived = 0
            AND d.createdate >= ?
            AND d.hubspot_owner_id IN (${placeholders})
          ORDER BY dsd.deal_id, s.displayOrder`,
    args: [yearStart, ...allowedOwnerIds],
  });
  const rows = rowsResult.rows;

  const dealOutcomeResult = await db.execute({
    sql: `SELECT d.id as deal_id, s.probability as current_prob
          FROM deals d
          LEFT JOIN stages s ON d.dealstage = s.id
          WHERE d.archived = 0 AND d.createdate >= ? AND d.hubspot_owner_id IN (${placeholders})`,
    args: [yearStart, ...allowedOwnerIds],
  });

  const dealOutcome = {};
  for (const r of dealOutcomeResult.rows) {
    const prob = Number(r.current_prob);
    if (prob === 1.0) dealOutcome[r.deal_id] = 'won';
    else if (prob === 0) dealOutcome[r.deal_id] = 'lost';
    else dealOutcome[r.deal_id] = 'active';
  }

  const dealStages = {};
  for (const r of rows) {
    if (!dealStages[r.deal_id]) dealStages[r.deal_id] = [];
    dealStages[r.deal_id].push(r);
  }

  const transitions = [];
  for (const [dealId, stageList] of Object.entries(dealStages)) {
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
        fromOrder: Number(from.displayOrder),
        toStageId: to.stage_id,
        toLabel: to.label,
        toOrder: Number(to.displayOrder),
        pipelineId: from.pipelineId,
        days,
        ownerId: from.hubspot_owner_id,
        outcome: dealOutcome[dealId] || 'active',
        amount: Number(from.amount) || 0,
      });
    }
  }

  // ── 1. Stage Funnel ──
  const stageDealSets = {};
  const stageAmounts = {};
  for (const r of rows) {
    if (!stageDealSets[r.stage_id]) { stageDealSets[r.stage_id] = new Set(); stageAmounts[r.stage_id] = 0; }
    stageDealSets[r.stage_id].add(r.deal_id);
    if (!stageDealSets[r.stage_id].has(`${r.deal_id}_amt`)) {
      stageDealSets[r.stage_id].add(`${r.deal_id}_amt`);
      stageAmounts[r.stage_id] += (Number(r.amount) || 0);
    }
  }

  const funnel = stages
    .filter(s => stageDealSets[s.id])
    .map(s => ({
      stageId: s.id,
      label: s.label,
      displayOrder: Number(s.displayOrder),
      probability: Number(s.probability),
      dealCount: [...stageDealSets[s.id]].filter(k => !String(k).endsWith('_amt')).length,
      totalAmount: Math.round(stageAmounts[s.id] || 0),
    }));

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
        stageId, label: data.label, displayOrder: data.order,
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
        stageId, label: data.label,
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

  const cycleResult = await db.execute({
    sql: `SELECT hubspot_owner_id,
                 AVG(julianday(closedate) - julianday(createdate)) as avg_cycle_days,
                 COUNT(*) as won_count
          FROM deals d
          JOIN stages s ON d.dealstage = s.id
          WHERE d.archived = 0 AND d.createdate >= ? AND s.probability = 1.0
            AND d.hubspot_owner_id IN (${placeholders})
          GROUP BY hubspot_owner_id`,
    args: [yearStart, ...allowedOwnerIds],
  });
  const cycleMap = {};
  for (const r of cycleResult.rows) cycleMap[r.hubspot_owner_id] = r;

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
          stageId, label: data.label,
          avgDays: Math.round((data.days.reduce((s, d) => s + d, 0) / data.days.length) * 10) / 10,
          transitionCount: data.days.length,
        }));
      return {
        ownerId, name: owner.fullName, teamId: team?.id || null, teamName: team?.name || 'Unknown',
        avgStageDays, avgCycleDays: cycle ? Math.round(Number(cycle.avg_cycle_days)) : null,
        wonCount: Number(cycle?.won_count) || 0, totalDeals: repDealCounts[ownerId]?.size || 0,
        transitionCount: allDays.length, stageBreakdown,
      };
    });

  const allTransDays = transitions.map(t => t.days);
  const companyAvgStageDays = allTransDays.length > 0
    ? Math.round((allTransDays.reduce((s, d) => s + d, 0) / allTransDays.length) * 10) / 10 : 0;
  const allCycles = cycleResult.rows.map(r => Number(r.avg_cycle_days)).filter(Boolean);
  const companyAvgCycleDays = allCycles.length > 0
    ? Math.round(allCycles.reduce((s, d) => s + d, 0) / allCycles.length) : 0;
  const companyAvg = { avgStageDays: companyAvgStageDays, avgCycleDays: companyAvgCycleDays };

  // ── 5. Insights ──
  const insights = [];
  const totalDeals = Object.keys(dealStages).length;
  if (totalDeals < 5) {
    insights.push({ type: 'warning', icon: '⚠️', text: `Limited data (${totalDeals} deals with stage transitions). Insights may not be statistically meaningful.` });
  }
  if (timeInStage.length >= 2) {
    for (const s of timeInStage) {
      if (s.avgDays > companyAvgStageDays * 2 && s.transitionCount >= 5) {
        insights.push({ type: 'danger', icon: '!', text: `"${s.label}" is a bottleneck — deals spend ${s.avgDays}d here vs ${companyAvgStageDays}d avg`, metric: `${s.transitionCount} transitions observed` });
      }
    }
  }
  for (const f of funnel) {
    if (f.dropOffPct !== null && f.dropOffPct > 50 && f.dealCount >= 10) {
      const nextStage = funnel.find(s => s.displayOrder > f.displayOrder);
      if (nextStage) {
        insights.push({ type: 'warning', icon: '🚨', text: `Only ${f.conversionToNext}% of deals advance from "${f.label}" to "${nextStage.label}"`, metric: `${f.dealCount} → ${nextStage.dealCount} deals` });
      }
    }
  }
  for (const ws of wonVsLost.won || []) {
    const ls = (wonVsLost.lost || []).find(l => l.stageId === ws.stageId);
    if (ls && ws.count >= 3 && ls.count >= 3) {
      const gap = ((ls.avgDays - ws.avgDays) / ls.avgDays) * 100;
      if (gap > 30) {
        insights.push({ type: 'info', icon: '📈', text: `Won deals move through "${ws.label}" ${Math.round(gap)}% faster than lost deals (${ws.avgDays}d vs ${ls.avgDays}d)` });
      }
    }
  }
  if (companyAvgStageDays > 0) {
    for (const r of repVelocity) {
      if (r.avgStageDays > companyAvgStageDays * 1.5 && r.transitionCount >= 10) {
        const pctSlower = Math.round(((r.avgStageDays - companyAvgStageDays) / companyAvgStageDays) * 100);
        insights.push({ type: 'warning', icon: '🐢', text: `${r.name} moves deals ${pctSlower}% slower than average (${r.avgStageDays}d vs ${companyAvgStageDays}d avg)`, metric: `${r.transitionCount} transitions` });
      }
    }
    for (const r of repVelocity) {
      if (r.avgStageDays < companyAvgStageDays * 0.5 && r.transitionCount >= 10) {
        insights.push({ type: 'success', icon: '⚡', text: `${r.name} is the fastest at advancing deals — ${r.avgStageDays}d avg vs ${companyAvgStageDays}d company avg`, metric: `${r.wonCount} won` });
      }
    }
  }

  return {
    stages: stages.map(s => ({ id: s.id, label: s.label, displayOrder: Number(s.displayOrder), probability: Number(s.probability), pipelineId: s.pipelineId, pipelineLabel: s.pipelineLabel })),
    funnel, timeInStage, wonVsLost, repVelocity, companyAvg,
    insights: insights.slice(0, 8),
    meta: { year, totalDeals, dealsWithStageData: Object.keys(dealStages).length },
  };
}

module.exports = { getPipelineVelocity };
