import { useState, useMemo, useCallback, Fragment } from 'react';
import { usePipelineVelocityData } from '../hooks/usePipelineVelocityData';
import { TEAMS } from '../config/teams';
import './PipelineVelocity.css';

const TEAM_COLORS = { smb: '#6366F1', am: '#0891B2', ent: '#D97706' };

function fmt(n) { return n == null ? '—' : `${n}d`; }
function fmtK(n) {
  if (n == null || n === 0) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

// ── Insight generation by scope ──
function generateInsights(data, scope, scopeId) {
  if (!data) return [];
  const items = [];
  const { funnel, timeInStage, wonVsLost, repVelocity, companyAvg } = data;

  // Helper: get reps in scope
  const scopeReps = scope === 'all'
    ? repVelocity
    : scope === 'team'
      ? repVelocity.filter(r => r.teamId === scopeId)
      : repVelocity.filter(r => r.ownerId === scopeId);

  const scopeLabel = scope === 'all'
    ? 'Organization'
    : scope === 'team'
      ? TEAMS.find(t => t.id === scopeId)?.name || 'Team'
      : scopeReps[0]?.name || 'Rep';

  if (scopeReps.length === 0) {
    items.push({ type: 'warning', icon: '⚠️', text: `No pipeline data available for ${scopeLabel}.` });
    return items;
  }

  // ── ORG-LEVEL insights ──
  if (scope === 'all') {
    // Low data warning
    if (data.meta.dealsWithStageData < 5) {
      items.push({ type: 'warning', icon: '⚠️', text: `Limited data (${data.meta.dealsWithStageData} deals with stage transitions). Insights may not be statistically meaningful.` });
    }

    // Bottleneck stages
    if (timeInStage.length >= 2) {
      for (const s of timeInStage) {
        if (s.avgDays > companyAvg.avgStageDays * 2 && s.transitionCount >= 5) {
          items.push({ type: 'danger', icon: '!', text: `"${s.label}" is a bottleneck — deals spend ${s.avgDays}d here vs ${companyAvg.avgStageDays}d avg across stages`, metric: `${s.transitionCount} transitions` });
        }
      }
    }

    // Funnel leaks
    for (const f of funnel) {
      if (f.dropOffPct !== null && f.dropOffPct > 50 && f.dealCount >= 10) {
        const nextStage = funnel.find(s => s.displayOrder > f.displayOrder);
        if (nextStage) {
          items.push({ type: 'warning', icon: '🚨', text: `Only ${f.conversionToNext}% of deals advance from "${f.label}" to "${nextStage.label}" — biggest funnel leak`, metric: `${f.dealCount} → ${nextStage.dealCount} deals` });
        }
      }
    }

    // Won vs Lost speed gap
    for (const ws of wonVsLost.won || []) {
      const ls = (wonVsLost.lost || []).find(l => l.stageId === ws.stageId);
      if (ls && ws.count >= 3 && ls.count >= 3) {
        const gap = ((ls.avgDays - ws.avgDays) / ls.avgDays) * 100;
        if (gap > 30) {
          items.push({ type: 'info', icon: '📈', text: `Won deals move through "${ws.label}" ${Math.round(gap)}% faster than lost deals (${ws.avgDays}d vs ${ls.avgDays}d) — stalling here signals risk` });
        }
      }
    }

    // Slowest / fastest reps across org
    for (const r of repVelocity) {
      if (r.avgStageDays > companyAvg.avgStageDays * 1.5 && r.transitionCount >= 10) {
        const pctSlower = Math.round(((r.avgStageDays - companyAvg.avgStageDays) / companyAvg.avgStageDays) * 100);
        items.push({ type: 'warning', icon: '🐢', text: `${r.name} moves deals ${pctSlower}% slower than company avg (${r.avgStageDays}d vs ${companyAvg.avgStageDays}d)`, metric: `${r.transitionCount} transitions` });
      }
    }
    for (const r of repVelocity) {
      if (r.avgStageDays < companyAvg.avgStageDays * 0.5 && r.transitionCount >= 10) {
        items.push({ type: 'success', icon: '⚡', text: `${r.name} is the fastest — ${r.avgStageDays}d avg vs ${companyAvg.avgStageDays}d company avg`, metric: `${r.wonCount} won` });
      }
    }
  }

  // ── TEAM-LEVEL insights ──
  if (scope === 'team') {
    const teamReps = scopeReps;
    const teamAvgDays = teamReps.reduce((s, r) => s + r.avgStageDays * r.transitionCount, 0) / Math.max(teamReps.reduce((s, r) => s + r.transitionCount, 0), 1);
    const teamAvgRounded = Math.round(teamAvgDays * 10) / 10;
    const teamTotalWon = teamReps.reduce((s, r) => s + r.wonCount, 0);
    const teamTotalDeals = teamReps.reduce((s, r) => s + r.totalDeals, 0);

    // Team vs company avg
    if (companyAvg.avgStageDays > 0) {
      const diff = Math.round(((teamAvgRounded - companyAvg.avgStageDays) / companyAvg.avgStageDays) * 100);
      if (diff > 20) {
        items.push({ type: 'warning', icon: '📊', text: `${scopeLabel} averages ${teamAvgRounded}d per stage — ${diff}% slower than company avg (${companyAvg.avgStageDays}d). Focus on stage advancement discipline.`, metric: `${teamTotalDeals} deals` });
      } else if (diff < -20) {
        items.push({ type: 'success', icon: '🏆', text: `${scopeLabel} averages ${teamAvgRounded}d per stage — ${Math.abs(diff)}% faster than company avg (${companyAvg.avgStageDays}d)!`, metric: `${teamTotalDeals} deals` });
      } else {
        items.push({ type: 'info', icon: '📊', text: `${scopeLabel} tracks close to company avg: ${teamAvgRounded}d vs ${companyAvg.avgStageDays}d per stage.`, metric: `${teamTotalDeals} deals` });
      }
    }

    // Identify bottleneck stage for this team
    const teamStageMap = {};
    for (const r of teamReps) {
      for (const sb of r.stageBreakdown) {
        if (!teamStageMap[sb.stageId]) teamStageMap[sb.stageId] = { label: sb.label, totalDays: 0, count: 0 };
        teamStageMap[sb.stageId].totalDays += sb.avgDays * sb.transitionCount;
        teamStageMap[sb.stageId].count += sb.transitionCount;
      }
    }
    const teamStages = Object.entries(teamStageMap).map(([id, s]) => ({ stageId: id, label: s.label, avgDays: Math.round((s.totalDays / s.count) * 10) / 10, count: s.count }));
    const teamBottleneck = teamStages.length > 0 ? teamStages.reduce((max, s) => s.avgDays > max.avgDays ? s : max, teamStages[0]) : null;
    if (teamBottleneck && teamBottleneck.avgDays > teamAvgRounded * 1.5 && teamBottleneck.count >= 3) {
      items.push({ type: 'danger', icon: '!', text: `Team bottleneck: "${teamBottleneck.label}" takes ${teamBottleneck.avgDays}d avg — coach reps on advancing deals through this stage faster.`, metric: `${teamBottleneck.count} transitions` });
    }

    // Slowest rep on team (coaching target)
    const sorted = [...teamReps].sort((a, b) => b.avgStageDays - a.avgStageDays);
    if (sorted.length >= 2) {
      const slowest = sorted[0];
      const fastest = sorted[sorted.length - 1];
      if (slowest.avgStageDays > fastest.avgStageDays * 1.5 && slowest.transitionCount >= 5) {
        items.push({ type: 'warning', icon: '🎯', text: `Coaching opportunity: ${slowest.name} (${slowest.avgStageDays}d avg) is significantly slower than ${fastest.name} (${fastest.avgDays || fastest.avgStageDays}d). Pair them for deal reviews.`, metric: `Gap: ${Math.round(slowest.avgStageDays - fastest.avgStageDays)}d` });
      }
      if (fastest.transitionCount >= 5) {
        items.push({ type: 'success', icon: '⭐', text: `${fastest.name} leads the team at ${fastest.avgStageDays}d per stage — have them share their process with the team.`, metric: `${fastest.wonCount} won` });
      }
    }

    // Win efficiency
    if (teamTotalDeals > 0) {
      const winPct = Math.round((teamTotalWon / teamTotalDeals) * 100);
      if (winPct < 20) {
        items.push({ type: 'danger', icon: '📉', text: `${scopeLabel} has only ${winPct}% win rate (${teamTotalWon}/${teamTotalDeals} deals). Review deal qualification criteria and ensure reps disqualify bad-fit deals early.` });
      }
    }
  }

  // ── REP-LEVEL insights ──
  if (scope === 'rep') {
    const rep = scopeReps[0];
    if (!rep) return items;

    // Rep vs company avg
    if (companyAvg.avgStageDays > 0) {
      const diff = Math.round(((rep.avgStageDays - companyAvg.avgStageDays) / companyAvg.avgStageDays) * 100);
      if (diff > 30) {
        items.push({ type: 'warning', icon: '🐢', text: `${rep.name} averages ${rep.avgStageDays}d per stage — ${diff}% slower than company avg (${companyAvg.avgStageDays}d). Needs deal advancement coaching.`, metric: `${rep.transitionCount} transitions` });
      } else if (diff < -30) {
        items.push({ type: 'success', icon: '⚡', text: `${rep.name} averages ${rep.avgStageDays}d per stage — ${Math.abs(diff)}% faster than company avg!`, metric: `${rep.wonCount} won` });
      } else {
        items.push({ type: 'info', icon: '📊', text: `${rep.name} is tracking at company avg: ${rep.avgStageDays}d vs ${companyAvg.avgStageDays}d per stage.` });
      }
    }

    // Rep vs team avg
    const teamReps = repVelocity.filter(r => r.teamId === rep.teamId);
    if (teamReps.length >= 2) {
      const teamAvgDays = teamReps.reduce((s, r) => s + r.avgStageDays * r.transitionCount, 0) / Math.max(teamReps.reduce((s, r) => s + r.transitionCount, 0), 1);
      const teamAvgRounded = Math.round(teamAvgDays * 10) / 10;
      const diff = Math.round(((rep.avgStageDays - teamAvgRounded) / teamAvgRounded) * 100);
      if (Math.abs(diff) > 20) {
        items.push({ type: diff > 0 ? 'warning' : 'success', icon: diff > 0 ? '📊' : '🏆', text: `${Math.abs(diff)}% ${diff > 0 ? 'slower' : 'faster'} than ${rep.teamName} avg (${teamAvgRounded}d). ${diff > 0 ? 'Below team pace.' : 'Setting the pace for the team!'}` });
      }
    }

    // Rep's personal bottleneck stage
    if (rep.stageBreakdown.length >= 2) {
      const bottleneck = rep.stageBreakdown.reduce((max, s) => s.avgDays > max.avgDays ? s : max, rep.stageBreakdown[0]);
      const secondWorst = rep.stageBreakdown.filter(s => s.stageId !== bottleneck.stageId).reduce((max, s) => s.avgDays > max.avgDays ? s : max, rep.stageBreakdown.find(s => s.stageId !== bottleneck.stageId));
      if (bottleneck.avgDays > (secondWorst?.avgDays || 0) * 1.5 && bottleneck.transitionCount >= 3) {
        items.push({ type: 'danger', icon: '!', text: `Personal bottleneck: "${bottleneck.label}" — ${bottleneck.avgDays}d avg. Focus coaching here to improve overall velocity.`, metric: `${bottleneck.transitionCount} transitions` });
      }

      // Fastest stage — reinforce
      const fastest = rep.stageBreakdown.reduce((min, s) => s.avgDays < min.avgDays ? s : min, rep.stageBreakdown[0]);
      if (fastest.avgDays < bottleneck.avgDays * 0.5 && fastest.transitionCount >= 3) {
        items.push({ type: 'success', icon: '💪', text: `Strongest at "${fastest.label}" (${fastest.avgDays}d). Apply similar rigor to "${bottleneck.label}" to improve cycle time.` });
      }
    }

    // Cycle time
    if (rep.avgCycleDays && companyAvg.avgCycleDays > 0) {
      const cycleDiff = Math.round(((rep.avgCycleDays - companyAvg.avgCycleDays) / companyAvg.avgCycleDays) * 100);
      if (cycleDiff > 30) {
        items.push({ type: 'warning', icon: '⏱️', text: `Create-to-close cycle is ${rep.avgCycleDays}d — ${cycleDiff}% longer than company avg (${companyAvg.avgCycleDays}d). Deals may be stalling or poorly qualified.` });
      } else if (cycleDiff < -20) {
        items.push({ type: 'success', icon: '🎯', text: `Create-to-close cycle is ${rep.avgCycleDays}d — ${Math.abs(cycleDiff)}% faster than company avg. Strong deal execution!` });
      }
    }

    // Low deal volume warning
    if (rep.totalDeals < 5) {
      items.push({ type: 'info', icon: 'ℹ️', text: `Only ${rep.totalDeals} deals with stage data — insights will improve with more pipeline activity.` });
    }
  }

  return items.slice(0, 10);
}

export default function PipelineVelocity() {
  const { data, loading, error, refetch } = usePipelineVelocityData();
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [insightScope, setInsightScope] = useState('all'); // 'all', 'team:<id>', 'rep:<ownerId>'
  const [sortCol, setSortCol] = useState('avgStageDays');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedRep, setExpandedRep] = useState(null);

  const handleSort = useCallback((col) => {
    setSortCol(prev => prev === col ? col : col);
    setSortDir(prev => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
  }, [sortCol]);

  const filteredReps = useMemo(() => {
    if (!data) return [];
    let reps = data.repVelocity;
    if (selectedTeam !== 'all') reps = reps.filter(r => r.teamId === selectedTeam);
    return reps;
  }, [data, selectedTeam]);

  const sortedReps = useMemo(() => {
    const list = [...filteredReps];
    list.sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [filteredReps, sortCol, sortDir]);

  // Parse insight scope
  const parsedScope = useMemo(() => {
    if (insightScope === 'all') return { scope: 'all', id: null };
    if (insightScope.startsWith('team:')) return { scope: 'team', id: insightScope.slice(5) };
    if (insightScope.startsWith('rep:')) return { scope: 'rep', id: insightScope.slice(4) };
    return { scope: 'all', id: null };
  }, [insightScope]);

  // Generate dynamic insights based on scope
  const insights = useMemo(() => {
    if (!data) return [];
    return generateInsights(data, parsedScope.scope, parsedScope.id);
  }, [data, parsedScope]);

  // Build insight scope dropdown options
  const insightScopeOptions = useMemo(() => {
    if (!data) return [];
    const opts = [{ value: 'all', label: 'All Teams (Org-wide)' }];
    for (const team of TEAMS) {
      const teamReps = data.repVelocity.filter(r => r.teamId === team.id);
      if (teamReps.length > 0) {
        opts.push({ value: `team:${team.id}`, label: `📋 ${team.name}`, isTeam: true });
        for (const r of teamReps.sort((a, b) => a.name.localeCompare(b.name))) {
          opts.push({ value: `rep:${r.ownerId}`, label: `    ${r.name}`, isRep: true });
        }
      }
    }
    return opts;
  }, [data]);

  const handleExport = useCallback(async () => {
    if (!data) return;
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const wb = XLSX.utils.book_new();

    // Funnel sheet
    const funnelData = data.funnel.map(f => ({
      Stage: f.label, Deals: f.dealCount, Amount: f.totalAmount,
      'Conversion %': f.conversionToNext != null ? f.conversionToNext : '',
      'Drop-off %': f.dropOffPct != null ? f.dropOffPct : '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(funnelData), 'Funnel');

    // Time in stage sheet
    const tisData = data.timeInStage.map(s => ({
      Stage: s.label, 'Avg Days': s.avgDays, 'Min Days': s.minDays,
      'Max Days': s.maxDays, 'Median Days': s.medianDays, Transitions: s.transitionCount,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tisData), 'Time in Stage');

    // Rep velocity sheet
    const repData = data.repVelocity.map(r => ({
      Rep: r.name, Team: r.teamName, 'Avg Stage Days': r.avgStageDays,
      'Avg Cycle Days': r.avgCycleDays, Deals: r.totalDeals, Won: r.wonCount,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(repData), 'Rep Velocity');

    XLSX.writeFile(wb, `pipeline-velocity-${data.meta.year}.xlsx`);
  }, [data]);

  if (loading) return <div className="pv-container"><div className="pv-loading"><span className="sync-spinner" /> Loading pipeline data...</div></div>;
  if (error) return <div className="pv-container"><div className="pv-error">Error: {error} <button onClick={refetch}>Retry</button></div></div>;
  if (!data) return null;

  const maxFunnelCount = Math.max(...data.funnel.map(f => f.dealCount), 1);
  const maxBarDays = Math.max(...data.timeInStage.map(s => s.avgDays), 1);
  const bottleneckId = data.timeInStage.length > 0
    ? data.timeInStage.reduce((max, s) => s.avgDays > max.avgDays ? s : max, data.timeInStage[0]).stageId
    : null;

  // Won vs lost max for comparison bars
  const allWonLostDays = [...(data.wonVsLost.won || []), ...(data.wonVsLost.lost || [])].map(s => s.avgDays);
  const maxCompDays = Math.max(...allWonLostDays, 1);

  // Get all stages that appear in won OR lost for comparison
  const compStageIds = new Set([
    ...(data.wonVsLost.won || []).map(s => s.stageId),
    ...(data.wonVsLost.lost || []).map(s => s.stageId),
  ]);
  const compStages = [...compStageIds].map(id => {
    const w = (data.wonVsLost.won || []).find(s => s.stageId === id);
    const l = (data.wonVsLost.lost || []).find(s => s.stageId === id);
    return { stageId: id, label: (w || l).label, won: w, lost: l };
  });

  const arrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="pv-container">
      {/* Header */}
      <div className="pv-header">
        <div>
          <h2 className="pv-title">Pipeline Velocity</h2>
          <span className="pv-subtitle">
            {data.meta.dealsWithStageData} deals with stage data &middot; {data.meta.year}
          </span>
        </div>
        <div className="pv-header-right">
          <select className="pv-team-select" value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}>
            <option value="all">All Teams</option>
            {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="pv-export-btn" onClick={handleExport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export
          </button>
        </div>
      </div>

      {/* Insights with scope filter */}
      <div className="pv-insights">
        <div className="pv-insights-header">
          <div className="pv-insights-title">Actionable Insights</div>
          <select
            className="pv-scope-select"
            value={insightScope}
            onChange={e => setInsightScope(e.target.value)}
          >
            {insightScopeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {insights.length > 0 ? (
          <div className="pv-insights-list">
            {insights.map((ins, i) => (
              <div key={i} className={`pv-insight pv-insight--${ins.type}`}>
                <span className="pv-insight-icon">{ins.icon}</span>
                <span className="pv-insight-text">{ins.text}</span>
                {ins.metric && <span className="pv-insight-metric">{ins.metric}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="pv-insights-empty">No insights for this selection — data may be insufficient.</div>
        )}
      </div>


      {/* Time in Stage */}
      {data.timeInStage.length > 0 && (
        <div className="pv-section">
          <div className="pv-section-title">Time in Stage (Bottleneck Finder)</div>
          <div className="pv-bars">
            {data.timeInStage.map(s => {
              const isBottleneck = s.stageId === bottleneckId;
              const pct = Math.max((s.avgDays / maxBarDays) * 100, 4);
              return (
                <div key={s.stageId} className="pv-bar-row">
                  <div className="pv-bar-label">{s.label}</div>
                  <div className="pv-bar-track">
                    <div
                      className={`pv-bar-fill ${isBottleneck ? 'pv-bar-fill--bottleneck' : 'pv-bar-fill--normal'}`}
                      style={{ width: `${pct}%` }}
                    >
                      {pct > 15 && <span className="pv-bar-val">{s.avgDays}d</span>}
                    </div>
                    {pct <= 15 && <span className="pv-bar-val-outside" style={{ position: 'absolute', left: `${pct + 1}%`, top: '50%', transform: 'translateY(-50%)' }}>{s.avgDays}d</span>}
                  </div>
                  <div className="pv-bar-detail">
                    {s.minDays}d – {s.maxDays}d ({s.transitionCount})
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Won vs Lost */}
      {compStages.length > 0 && (
        <div className="pv-section">
          <div className="pv-section-title">Won vs Lost Speed</div>
          <div className="pv-compare">
            {compStages.map(cs => (
              <div key={cs.stageId} className="pv-compare-row">
                <div className="pv-compare-label">{cs.label}</div>
                <div className="pv-compare-bars">
                  <div className="pv-compare-bar-row">
                    <span className="pv-compare-tag pv-compare-tag--won">Won</span>
                    <div className="pv-compare-track">
                      <div className="pv-compare-fill--won" style={{ width: cs.won ? `${(cs.won.avgDays / maxCompDays) * 100}%` : '0%' }} />
                    </div>
                    <span className="pv-compare-val">{cs.won ? `${cs.won.avgDays}d` : '—'}</span>
                  </div>
                  <div className="pv-compare-bar-row">
                    <span className="pv-compare-tag pv-compare-tag--lost">Lost</span>
                    <div className="pv-compare-track">
                      <div className="pv-compare-fill--lost" style={{ width: cs.lost ? `${(cs.lost.avgDays / maxCompDays) * 100}%` : '0%' }} />
                    </div>
                    <span className="pv-compare-val">{cs.lost ? `${cs.lost.avgDays}d` : '—'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Rep Velocity Table */}
      {sortedReps.length > 0 && (
        <div className="pv-section">
          <div className="pv-section-title">Rep Velocity</div>
          <table className="pv-rep-table">
            <thead>
              <tr>
                <th className="pv-rth-left" onClick={() => handleSort('name')}>Rep{arrow('name')}</th>
                <th onClick={() => handleSort('avgStageDays')}>Avg Stage Days{arrow('avgStageDays')}</th>
                <th onClick={() => handleSort('avgCycleDays')}>Avg Cycle{arrow('avgCycleDays')}</th>
                <th onClick={() => handleSort('totalDeals')}>Deals{arrow('totalDeals')}</th>
                <th onClick={() => handleSort('wonCount')}>Won{arrow('wonCount')}</th>
                <th onClick={() => handleSort('transitionCount')}>Transitions{arrow('transitionCount')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedReps.map(r => {
                const isSlow = data.companyAvg.avgStageDays > 0 && r.avgStageDays > data.companyAvg.avgStageDays * 1.5;
                const isFast = data.companyAvg.avgStageDays > 0 && r.avgStageDays < data.companyAvg.avgStageDays * 0.5;
                return (
                  <Fragment key={r.ownerId}>
                    <tr className="pv-rep-row" onClick={() => setExpandedRep(expandedRep === r.ownerId ? null : r.ownerId)}>
                      <td className="pv-rtd-name">
                        <span className="pv-expand-icon">{expandedRep === r.ownerId ? '\u25BC' : '\u25B6'}</span>
                        <span className="pv-team-dot" style={{ background: TEAM_COLORS[r.teamId] || '#94A3B8' }} />
                        {r.name}
                      </td>
                      <td className={isSlow ? 'pv-td-slow' : isFast ? 'pv-td-fast' : ''}>
                        {fmt(r.avgStageDays)}
                      </td>
                      <td>{fmt(r.avgCycleDays)}</td>
                      <td>{r.totalDeals}</td>
                      <td>{r.wonCount}</td>
                      <td>{r.transitionCount}</td>
                    </tr>
                    {expandedRep === r.ownerId && (
                      <tr className="pv-detail-row">
                        <td colSpan={6}>
                          <div className="pv-detail-stages">
                            {r.stageBreakdown.map(sb => (
                              <div key={sb.stageId} className="pv-detail-stage">
                                <div className="pv-ds-label">{sb.label}</div>
                                <div className="pv-ds-val">{sb.avgDays}d</div>
                                <div className="pv-ds-count">{sb.transitionCount} transitions</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="pv-meta">
            Company avg: {data.companyAvg.avgStageDays}d per stage &middot; {data.companyAvg.avgCycleDays}d create-to-close
          </div>
        </div>
      )}

      {/* Stage Funnel */}
      {data.funnel.length > 0 && (
        <div className="pv-section">
          <div className="pv-section-title">Stage Funnel</div>
          <table className="pv-funnel-table">
            <thead>
              <tr>
                <th className="pv-fth-left">Stage</th>
                <th>Deals</th>
                <th style={{ width: '30%' }}></th>
                <th>Amount</th>
                <th>Conversion</th>
                <th>Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {data.funnel.map(f => (
                <tr key={f.stageId}>
                  <td className="pv-ftd-left" style={{ fontWeight: 500 }}>{f.label}</td>
                  <td>{f.dealCount}</td>
                  <td>
                    <div className="pv-funnel-bar-cell">
                      <div className="pv-funnel-bar" style={{ width: `${(f.dealCount / maxFunnelCount) * 100}%` }} />
                    </div>
                  </td>
                  <td>{fmtK(f.totalAmount)}</td>
                  <td>
                    {f.conversionToNext != null && (
                      <span className={f.conversionToNext >= 70 ? 'pv-conv-good' : ''}>{f.conversionToNext}%</span>
                    )}
                  </td>
                  <td>
                    {f.dropOffPct != null && (
                      <span className={f.dropOffPct > 50 ? 'pv-drop-high' : f.dropOffPct > 30 ? 'pv-drop-med' : ''}>
                        {f.dropOffPct}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
