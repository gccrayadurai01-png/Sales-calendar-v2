import { useState, useMemo, useEffect, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { useLeadFlowData } from '../hooks/useLeadFlowData';
import { TEAMS, ALLOWED_REP_NAMES, getRepTeam } from '../config/teams';
import { formatShortCurrency, formatCurrency } from '../utils/calendarUtils';
import './LeadFlow.css';

/* ── Quarter presets ─────────────────────────────────────── */
const PERIODS = [
  { label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
  { label: 'Q4 2025', start: '2025-10-01', end: '2025-12-31' },
  { label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
  { label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
  { label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' },
];

/* ── Shared helpers ──────────────────────────────────────── */
const REP_COLORS = [
  '#4F46E5', '#0891B2', '#059669', '#D97706', '#DC2626',
  '#7C3AED', '#0284C7', '#16A34A', '#CA8A04', '#E11D48',
  '#6366F1', '#06B6D4', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#38BDF8', '#34D399', '#FBBF24', '#F87171',
];

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function classifyStage(stage) {
  if (!stage) return 'active';
  const prob = parseFloat(stage.probability);
  const l = stage.label.toLowerCase();
  if (prob === 1) return 'won';
  if (l.includes('lost')) return 'lost';
  if (isFinite(prob) && prob > 0) return 'active';
  return 'stalled';
}

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

const TEAM_COLORS = {
  smb: { bg: '#EEF2FF', text: '#4338CA', border: '#818CF8' },
  am:  { bg: '#F0FDF4', text: '#15803D', border: '#4ADE80' },
  ent: { bg: '#FFF7ED', text: '#C2410C', border: '#FB923C' },
};

const CAT_LABELS = { active: 'Active', won: 'Won', lost: 'Lost', stalled: 'Stalled' };

/** Days between a date string and today (0 if same day) */
function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/* ── Component ───────────────────────────────────────────── */
export default function LeadFlow() {
  const [periodIdx, setPeriodIdx] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [drillDown, setDrillDown] = useState(null);   // { title, deals }
  const [sortCol, setSortCol] = useState('value');     // drawer sort column
  const [sortDir, setSortDir] = useState('desc');      // 'asc' | 'desc'
  const [drillFilters, setDrillFilters] = useState({});
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterPos, setFilterPos] = useState(null);

  const period = PERIODS[periodIdx];
  const { deals, owners, stages, loading, error, refetch } = useLeadFlowData(period.start, period.end);

  /* Owner map — same logic as App.jsx */
  const ownerMap = useMemo(() => {
    const whitelisted = owners.filter((o) => {
      const name = `${o.firstName || ''} ${o.lastName || ''}`.trim();
      return ALLOWED_REP_NAMES.includes(name.toLowerCase());
    });
    whitelisted.sort((a, b) => {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim();
      const ta = getRepTeam(nameA), tb = getRepTeam(nameB);
      const ia = TEAMS.findIndex((t) => t.id === ta?.id);
      const ib = TEAMS.findIndex((t) => t.id === tb?.id);
      if (ia !== ib) return ia - ib;
      return nameA.localeCompare(nameB);
    });
    return whitelisted.reduce((acc, o, idx) => {
      const fullName = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || `Owner ${o.id}`;
      const team = getRepTeam(fullName);
      acc[o.id] = { ...o, fullName, initials: getInitials(fullName), color: REP_COLORS[idx % REP_COLORS.length], teamId: team?.id || null };
      return acc;
    }, {});
  }, [owners]);

  /* Stage map (id → enriched stage with category) */
  const stageMap = useMemo(() => {
    const m = {};
    stages.forEach((s) => { m[s.id] = { ...s, category: classifyStage(s) }; });
    return m;
  }, [stages]);

  /* Active funnel stages in pipeline order — only stages that appear in current deals */
  const funnelStages = useMemo(() => {
    const usedIds = new Set(deals.map((d) => d.properties.dealstage).filter(Boolean));
    return stages
      .filter((s) => {
        if (!usedIds.has(s.id)) return false;
        const p = parseFloat(s.probability);
        return isFinite(p) && p > 0 && p < 1;
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [stages, deals]);

  /* Filter deals to whitelisted reps, then by team */
  const filteredDeals = useMemo(() =>
    deals.filter((d) => {
      const owner = ownerMap[d.properties.hubspot_owner_id];
      if (!owner) return false;
      if (selectedTeam !== 'all' && owner.teamId !== selectedTeam) return false;
      return true;
    }),
    [deals, ownerMap, selectedTeam]
  );

  /* Overall stats */
  const stats = useMemo(() => {
    let won = 0, lost = 0, stalled = 0, active = 0, wonAmt = 0, totalAmt = 0;
    filteredDeals.forEach((d) => {
      const cat = stageMap[d.properties.dealstage]?.category || 'active';
      const amt = parseFloat(d.properties.amount || 0);
      totalAmt += amt;
      if (cat === 'won') { won++; wonAmt += amt; }
      else if (cat === 'lost') lost++;
      else if (cat === 'stalled') stalled++;
      else active++;
    });
    return { total: filteredDeals.length, won, lost, stalled, active, wonAmt, totalAmt };
  }, [filteredDeals, stageMap]);

  /* Stage distribution for funnel bars */
  const stageDist = useMemo(() => {
    const d = {};
    filteredDeals.forEach((deal) => {
      const id = deal.properties.dealstage;
      d[id] = (d[id] || 0) + 1;
    });
    return d;
  }, [filteredDeals]);

  const sortedStages = useMemo(() =>
    [...stages].filter((s) => (stageDist[s.id] || 0) > 0).sort((a, b) => a.displayOrder - b.displayOrder),
    [stages, stageDist]
  );

  const maxStageCount = useMemo(() => Math.max(...Object.values(stageDist), 1), [stageDist]);

  /* Per-team stats */
  const teamStats = useMemo(() =>
    TEAMS.map((team) => {
      const td = filteredDeals.filter((d) => ownerMap[d.properties.hubspot_owner_id]?.teamId === team.id);
      let won = 0, lost = 0, stalled = 0, active = 0, wonAmt = 0;
      td.forEach((d) => {
        const cat = stageMap[d.properties.dealstage]?.category || 'active';
        const amt = parseFloat(d.properties.amount || 0);
        if (cat === 'won') { won++; wonAmt += amt; }
        else if (cat === 'lost') lost++;
        else if (cat === 'stalled') stalled++;
        else active++;
      });
      return { ...team, total: td.length, won, lost, stalled, active, wonAmt };
    }),
    [filteredDeals, ownerMap, stageMap]
  );

  /* Per-rep stats (include all whitelisted reps even with 0 deals) */
  const repStats = useMemo(() => {
    const m = {};
    Object.values(ownerMap).forEach((owner) => {
      if (selectedTeam !== 'all' && owner.teamId !== selectedTeam) return;
      m[owner.id] = { owner, total: 0, won: 0, lost: 0, stalled: 0, active: 0, wonAmt: 0, byStage: {} };
    });
    filteredDeals.forEach((d) => {
      const ownerId = d.properties.hubspot_owner_id;
      if (!m[ownerId]) return;
      const r = m[ownerId];
      r.total++;
      const stageId = d.properties.dealstage;
      r.byStage[stageId] = (r.byStage[stageId] || 0) + 1;
      const cat = stageMap[stageId]?.category || 'active';
      const amt = parseFloat(d.properties.amount || 0);
      if (cat === 'won') { r.won++; r.wonAmt += amt; }
      else if (cat === 'lost') r.lost++;
      else if (cat === 'stalled') r.stalled++;
      else r.active++;
    });
    return m;
  }, [filteredDeals, ownerMap, stageMap, selectedTeam]);

  /* ── Drill-down helpers ───────────────────────────────── */
  const openDrill = (title, filterFn) => {
    const matching = filteredDeals
      .filter(filterFn)
      .sort((a, b) => (parseFloat(b.properties.amount) || 0) - (parseFloat(a.properties.amount) || 0));
    if (matching.length === 0) return;          // don't open for 0 deals
    const totalAmt = matching.reduce((s, d) => s + (parseFloat(d.properties.amount) || 0), 0);
    setDrillDown({ title, deals: matching, totalAmt });
  };

  const closeDrill = () => { setDrillDown(null); setSortCol('value'); setSortDir('desc'); setDrillFilters({}); setActiveFilterCol(null); setFilterSearch(''); };

  /* Column value extractor for filter matching */
  const getDealColValue = (deal, colId) => {
    const p = deal.properties;
    switch (colId) {
      case 'name': return p.dealname || '';
      case 'rep': return ownerMap[p.hubspot_owner_id]?.fullName || '—';
      case 'value': return formatCurrency(parseFloat(p.amount || 0));
      case 'age': { const d = daysAgo(p.createdate); return d !== null ? `${d}d` : '—'; }
      case 'stage': return stageMap[p.dealstage]?.label || p.dealstage || '—';
      case 'dis': {
        const d = daysAgo(p[`hs_v2_date_entered_${p.dealstage}`]);
        return d !== null ? `${d}d` : '—';
      }
      default: return '';
    }
  };

  /* Unique values per column from current drill-down (unfiltered) */
  const drillUniqueValues = useMemo(() => {
    if (!drillDown) return {};
    const cols = ['name','rep','value','age','stage','dis'];
    const result = {};
    cols.forEach(colId => {
      const counts = {};
      drillDown.deals.forEach(d => {
        const v = getDealColValue(d, colId);
        counts[v] = (counts[v] || 0) + 1;
      });
      result[colId] = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }));
    });
    return result;
  }, [drillDown, ownerMap, stageMap]);

  const toggleFilter = (colId, e) => {
    if (activeFilterCol === colId) {
      setActiveFilterCol(null);
      setFilterSearch('');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterPos({ top: rect.bottom + 2, left: Math.min(rect.left, window.innerWidth - 240) });
    setActiveFilterCol(colId);
    setFilterSearch('');
  };

  const isFilterChecked = (colId, value) => {
    if (!drillFilters[colId]) return true;
    return drillFilters[colId].has(value);
  };

  const toggleFilterValue = (colId, value) => {
    setDrillFilters(prev => {
      const next = { ...prev };
      const allValues = drillUniqueValues[colId]?.map(v => v.value) || [];
      if (!next[colId]) {
        next[colId] = new Set(allValues.filter(v => v !== value));
      } else {
        const s = new Set(next[colId]);
        if (s.has(value)) s.delete(value); else s.add(value);
        if (s.size >= allValues.length) delete next[colId];
        else next[colId] = s;
      }
      return next;
    });
  };

  const clearColumnFilter = (colId) => {
    setDrillFilters(prev => { const next = { ...prev }; delete next[colId]; return next; });
    setActiveFilterCol(null);
    setFilterSearch('');
  };

  const activeFilterCount = Object.keys(drillFilters).length;

  const exportToExcel = () => {
    if (!drillDown) return;
    const rows = sortedDrillDeals.map(d => {
      const p = d.properties;
      const owner = ownerMap[p.hubspot_owner_id];
      const stage = stageMap[p.dealstage];
      const stageEnteredProp = `hs_v2_date_entered_${p.dealstage}`;
      const dis = daysAgo(p[stageEnteredProp]);
      return {
        'Deal Name': p.dealname || '',
        'Rep': owner?.fullName || '',
        'Value': parseFloat(p.amount || 0),
        'Deal Age (days)': daysAgo(p.createdate) ?? '',
        'Stage': stage?.label || p.dealstage || '',
        'Days in Stage': dis ?? '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key]).length).slice(0, 100)) + 2
    }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deals');
    const filename = `${drillDown.title.replace(/[^a-zA-Z0-9 ]/g, '').trim()}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  /* Close filter dropdown on outside click */
  useEffect(() => {
    if (!activeFilterCol) return;
    const handler = (e) => {
      if (!e.target.closest('.lf-filter-dd') && !e.target.closest('.lf-filter-btn')) {
        setActiveFilterCol(null);
        setFilterSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeFilterCol]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(col === 'name' || col === 'rep' || col === 'stage' ? 'asc' : 'desc'); }
  };

  /** Sorted drill-down deals */
  const sortedDrillDeals = useMemo(() => {
    if (!drillDown) return [];
    let list = [...drillDown.deals];
    // Apply column filters
    Object.entries(drillFilters).forEach(([colId, allowedValues]) => {
      if (allowedValues.size > 0) {
        list = list.filter(d => allowedValues.has(getDealColValue(d, colId)));
      }
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const pa = a.properties, pb = b.properties;
      switch (sortCol) {
        case 'name':
          return dir * (pa.dealname || '').localeCompare(pb.dealname || '');
        case 'rep': {
          const ra = ownerMap[pa.hubspot_owner_id]?.fullName || '';
          const rb = ownerMap[pb.hubspot_owner_id]?.fullName || '';
          return dir * ra.localeCompare(rb);
        }
        case 'value':
          return dir * ((parseFloat(pa.amount) || 0) - (parseFloat(pb.amount) || 0));
        case 'age':
          return dir * ((daysAgo(pa.createdate) ?? -1) - (daysAgo(pb.createdate) ?? -1));
        case 'stage': {
          const sa = stageMap[pa.dealstage]?.label || '';
          const sb = stageMap[pb.dealstage]?.label || '';
          return dir * sa.localeCompare(sb);
        }
        case 'dis': {
          const da = daysAgo(pa[`hs_v2_date_entered_${pa.dealstage}`]) ?? -1;
          const db = daysAgo(pb[`hs_v2_date_entered_${pb.dealstage}`]) ?? -1;
          return dir * (da - db);
        }
        default: return 0;
      }
    });
    return list;
  }, [drillDown, drillFilters, sortCol, sortDir, ownerMap, stageMap]);

  /** Clickable number — only fires when count > 0 */
  const Clk = ({ val, onClick, className = '' }) =>
    val > 0
      ? <span className={`lf-click ${className}`} onClick={onClick}>{val}</span>
      : <span className={className}>{val}</span>;

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="lf">
      {/* Header */}
      <div className="lf-header">
        <div>
          <div className="lf-title">Deal Flow</div>
          <div className="lf-subtitle">
            {period.label} &middot; {stats.total} deals created &middot; Tracking {Object.keys(ownerMap).length} reps
          </div>
        </div>
        <div className="lf-filters">
          <div className="lf-fg">
            <label className="lf-fl">PERIOD</label>
            <select className="lf-sel" value={periodIdx} onChange={(e) => setPeriodIdx(+e.target.value)}>
              {PERIODS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
            </select>
          </div>
          <div className="lf-fg">
            <label className="lf-fl">TEAM</label>
            <select className="lf-sel" value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
              <option value="all">All Teams</option>
              {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="error-banner" style={{ margin: '16px 24px' }}>
          <strong>Error:</strong> {error}
          <button className="retry-btn" onClick={refetch}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <span>Loading deal flow data from HubSpot...</span>
        </div>
      )}

      {!loading && !error && (
        <div className="lf-content">

          {/* ── Stats bar ── */}
          <div className="lf-stats">
            <div className="lf-st lf-click" onClick={() => openDrill('All Leads', () => true)}>
              <div className="lf-st-val">{stats.total}</div>
              <div className="lf-st-lbl">Leads Created</div>
            </div>
            <div className="lf-st-sep" />
            <div
              className="lf-st lf-st--active lf-click"
              onClick={() => openDrill('Active Deals', (d) => (stageMap[d.properties.dealstage]?.category || 'active') === 'active')}
            >
              <div className="lf-st-val">{stats.active}</div>
              <div className="lf-st-lbl">Active &middot; {pct(stats.active, stats.total)}%</div>
            </div>
            <div
              className="lf-st lf-st--won lf-click"
              onClick={() => openDrill('Won Deals', (d) => stageMap[d.properties.dealstage]?.category === 'won')}
            >
              <div className="lf-st-val">{stats.won}</div>
              <div className="lf-st-lbl">Won &middot; {pct(stats.won, stats.total)}%</div>
            </div>
            <div
              className="lf-st lf-st--lost lf-click"
              onClick={() => openDrill('Lost Deals', (d) => stageMap[d.properties.dealstage]?.category === 'lost')}
            >
              <div className="lf-st-val">{stats.lost}</div>
              <div className="lf-st-lbl">Lost &middot; {pct(stats.lost, stats.total)}%</div>
            </div>
            <div
              className="lf-st lf-st--stalled lf-click"
              onClick={() => openDrill('Stalled Deals', (d) => stageMap[d.properties.dealstage]?.category === 'stalled')}
            >
              <div className="lf-st-val">{stats.stalled}</div>
              <div className="lf-st-lbl">Stalled &middot; {pct(stats.stalled, stats.total)}%</div>
            </div>
            {stats.wonAmt > 0 && (
              <>
                <div className="lf-st-sep" />
                <div
                  className="lf-st lf-st--rev lf-click"
                  onClick={() => openDrill('Won Deals', (d) => stageMap[d.properties.dealstage]?.category === 'won')}
                >
                  <div className="lf-st-val">{formatShortCurrency(stats.wonAmt)}</div>
                  <div className="lf-st-lbl">Won Revenue</div>
                </div>
              </>
            )}
          </div>

          {/* ── Middle row: Funnel + Team cards ── */}
          <div className="lf-mid">
            {/* Funnel */}
            <div className="lf-card lf-funnel-card">
              <div className="lf-card-title">Pipeline Stage Distribution</div>
              <div className="lf-card-sub">Where are all {period.label} leads right now?</div>
              <div className="lf-funnel">
                {sortedStages.map((stage) => {
                  const count = stageDist[stage.id] || 0;
                  const cat = stageMap[stage.id]?.category || 'active';
                  const barPct = (count / maxStageCount) * 100;
                  return (
                    <div
                      key={stage.id}
                      className="lf-fr lf-click"
                      onClick={() => openDrill(`${stage.label} Deals`, (d) => d.properties.dealstage === stage.id)}
                    >
                      <span className="lf-fr-name">{stage.label}</span>
                      <div className="lf-fr-track">
                        <div className={`lf-fr-bar lf-fr-bar--${cat}`} style={{ width: `${Math.max(barPct, 2)}%` }} />
                      </div>
                      <span className={`lf-fr-cnt lf-fr-cnt--${cat}`}>{count}</span>
                      <span className="lf-fr-pct">{pct(count, stats.total)}%</span>
                    </div>
                  );
                })}
                {sortedStages.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: '#94A3B8' }}>No deals found.</div>
                )}
              </div>
            </div>

            {/* Team Cards */}
            <div className="lf-teams">
              {teamStats.map((team) => {
                const tc = TEAM_COLORS[team.id] || TEAM_COLORS.smb;
                const teamFilter = (cat) => (d) => {
                  const o = ownerMap[d.properties.hubspot_owner_id];
                  if (o?.teamId !== team.id) return false;
                  return (stageMap[d.properties.dealstage]?.category || 'active') === cat;
                };
                return (
                  <div key={team.id} className="lf-tc" style={{ borderTopColor: tc.border }}>
                    <div className="lf-tc-top">
                      <span className="lf-tc-badge" style={{ color: tc.text, background: tc.bg }}>{team.name}</span>
                      <span
                        className="lf-tc-total lf-click"
                        onClick={() => openDrill(`${team.name} — All`, (d) => ownerMap[d.properties.hubspot_owner_id]?.teamId === team.id)}
                      >
                        {team.total} leads
                      </span>
                    </div>
                    <div className="lf-tc-grid">
                      {['active', 'won', 'lost', 'stalled'].map((cat) => (
                        <div
                          key={cat}
                          className="lf-tc-m lf-click"
                          onClick={() => team[cat] > 0 && openDrill(`${team.name} — ${CAT_LABELS[cat]}`, teamFilter(cat))}
                        >
                          <span className={`lf-tc-mv lf-tc-mv--${cat}`}>{team[cat]}</span>
                          <span className="lf-tc-ml">{CAT_LABELS[cat]}</span>
                        </div>
                      ))}
                    </div>
                    <div className="lf-tc-foot">
                      <span className="lf-tc-conv" style={{ color: tc.text }}>{pct(team.won, team.total)}% conversion</span>
                      {team.wonAmt > 0 && <span className="lf-tc-rev">&middot; {formatShortCurrency(team.wonAmt)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Rep Breakdown Table ── */}
          <div className="lf-card">
            <div className="lf-card-title">Rep Breakdown</div>
            <div className="lf-card-sub">Click any number to see the deals</div>
            <div className="lf-tbl-wrap">
              <table className="lf-tbl">
                <thead>
                  <tr>
                    <th className="lf-th lf-th--rep">Rep</th>
                    <th className="lf-th lf-th--num">Total</th>
                    {funnelStages.map((s) => (
                      <th key={s.id} className="lf-th lf-th--num lf-th--stage">{s.label}</th>
                    ))}
                    <th className="lf-th lf-th--num lf-th--won">Won</th>
                    <th className="lf-th lf-th--num lf-th--lost">Lost</th>
                    <th className="lf-th lf-th--num lf-th--stalled">Stalled</th>
                    <th className="lf-th lf-th--num lf-th--conv">Conv%</th>
                  </tr>
                </thead>
                <tbody>
                  {TEAMS.map((team) => {
                    const tc = TEAM_COLORS[team.id] || TEAM_COLORS.smb;
                    const reps = Object.values(repStats)
                      .filter((r) => r.owner.teamId === team.id)
                      .sort((a, b) => b.total - a.total);
                    if (reps.length === 0) return null;
                    return (
                      <Fragment key={team.id}>
                        <tr className="lf-tr-team">
                          <td colSpan={4 + funnelStages.length} className="lf-td-team">
                            <span className="lf-tc-badge" style={{ color: tc.text, background: tc.bg }}>{team.name}</span>
                          </td>
                        </tr>
                        {reps.map((r) => (
                          <tr key={r.owner.id} className="lf-tr">
                            <td className="lf-td lf-td--rep">
                              <span className="lf-dot" style={{ backgroundColor: r.owner.color }} />
                              {r.owner.fullName}
                            </td>
                            <td className="lf-td lf-td--num lf-td--total">
                              <Clk
                                val={r.total}
                                onClick={() => openDrill(`${r.owner.fullName} — All Deals`, (d) => d.properties.hubspot_owner_id === r.owner.id)}
                              />
                            </td>
                            {funnelStages.map((s) => (
                              <td key={s.id} className="lf-td lf-td--num">
                                {r.byStage[s.id]
                                  ? <Clk
                                      val={r.byStage[s.id]}
                                      onClick={() => openDrill(
                                        `${r.owner.fullName} — ${s.label}`,
                                        (d) => d.properties.hubspot_owner_id === r.owner.id && d.properties.dealstage === s.id
                                      )}
                                    />
                                  : <span className="lf-dash">&mdash;</span>
                                }
                              </td>
                            ))}
                            <td className="lf-td lf-td--num lf-td--won">
                              {r.won
                                ? <Clk
                                    val={r.won}
                                    className="lf-td--won-txt"
                                    onClick={() => openDrill(
                                      `${r.owner.fullName} — Won`,
                                      (d) => d.properties.hubspot_owner_id === r.owner.id && stageMap[d.properties.dealstage]?.category === 'won'
                                    )}
                                  />
                                : <span className="lf-dash">&mdash;</span>
                              }
                            </td>
                            <td className="lf-td lf-td--num lf-td--lost">
                              {r.lost
                                ? <Clk
                                    val={r.lost}
                                    className="lf-td--lost-txt"
                                    onClick={() => openDrill(
                                      `${r.owner.fullName} — Lost`,
                                      (d) => d.properties.hubspot_owner_id === r.owner.id && stageMap[d.properties.dealstage]?.category === 'lost'
                                    )}
                                  />
                                : <span className="lf-dash">&mdash;</span>
                              }
                            </td>
                            <td className="lf-td lf-td--num lf-td--stalled">
                              {r.stalled
                                ? <Clk
                                    val={r.stalled}
                                    className="lf-td--stalled-txt"
                                    onClick={() => openDrill(
                                      `${r.owner.fullName} — Stalled`,
                                      (d) => d.properties.hubspot_owner_id === r.owner.id && stageMap[d.properties.dealstage]?.category === 'stalled'
                                    )}
                                  />
                                : <span className="lf-dash">&mdash;</span>
                              }
                            </td>
                            <td className="lf-td lf-td--num">
                              <span className={`lf-conv ${pct(r.won, r.total) >= 30 ? 'lf-conv--hi' : pct(r.won, r.total) >= 15 ? 'lf-conv--mid' : 'lf-conv--lo'}`}>
                                {pct(r.won, r.total)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* ── Drill-down Drawer ────────────────────────────── */}
      {drillDown && (
        <div className="lf-overlay" onClick={closeDrill}>
          <div className="lf-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="lf-drawer-hdr">
              <div>
                <div className="lf-drawer-title">{drillDown.title}</div>
                <div className="lf-drawer-meta">
                  {sortedDrillDeals.length === drillDown.deals.length
                    ? <>{drillDown.deals.length} deal{drillDown.deals.length !== 1 && 's'}</>
                    : <>{sortedDrillDeals.length} of {drillDown.deals.length} deals (filtered)</>
                  }
                  {drillDown.totalAmt > 0 && <> &middot; {formatShortCurrency(drillDown.totalAmt)} total value</>}
                  {activeFilterCount > 0 && (
                    <button className="lf-filter-clear-all" onClick={() => setDrillFilters({})}>
                      Clear all filters
                    </button>
                  )}
                </div>
              </div>
              <div className="lf-drawer-actions">
                <button className="lf-export-btn" onClick={exportToExcel} title="Export to Excel">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1v9m0 0L5 7m3 3l3-3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Export
                </button>
                <button className="lf-drawer-x" onClick={closeDrill}>✕</button>
              </div>
            </div>
            <div className="lf-drawer-body">
              <table className="lf-dtbl">
                <thead>
                  <tr>
                    {[
                      { id: 'name',  label: 'Deal Name',     cls: 'lf-dth--name' },
                      { id: 'rep',   label: 'Rep',            cls: 'lf-dth--rep' },
                      { id: 'value', label: 'Value',          cls: 'lf-dth--val' },
                      { id: 'age',   label: 'Deal Age',       cls: 'lf-dth--age' },
                      { id: 'stage', label: 'Stage',          cls: 'lf-dth--stage' },
                      { id: 'dis',   label: 'Days in Stage',  cls: 'lf-dth--dis' },
                    ].map((col) => (
                      <th key={col.id} className={`lf-dth ${col.cls}`}>
                        <div className="lf-dth-wrap">
                          <span className="lf-dth-sort" onClick={() => toggleSort(col.id)}>
                            {col.label}
                            <span className="lf-sort-icon">
                              {sortCol === col.id ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                            </span>
                          </span>
                          <button
                            className={`lf-filter-btn${drillFilters[col.id] ? ' lf-filter-btn--active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleFilter(col.id, e); }}
                            title={`Filter ${col.label}`}
                          >&#9662;</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedDrillDeals.map((d) => {
                    const p = d.properties;
                    const owner = ownerMap[p.hubspot_owner_id];
                    const stage = stageMap[p.dealstage];
                    const age = daysAgo(p.createdate);
                    const stageEnteredProp = `hs_v2_date_entered_${p.dealstage}`;
                    const dis = daysAgo(p[stageEnteredProp]);
                    const cat = stage?.category || 'active';
                    return (
                      <tr key={d.id} className="lf-dtr">
                        <td className="lf-dtd lf-dtd--name" title={p.dealname}>{p.dealname}</td>
                        <td className="lf-dtd lf-dtd--rep">
                          {owner && <span className="lf-dot" style={{ backgroundColor: owner.color }} />}
                          {owner?.fullName || '—'}
                        </td>
                        <td className="lf-dtd lf-dtd--val">{formatCurrency(parseFloat(p.amount || 0))}</td>
                        <td className="lf-dtd lf-dtd--age">{age !== null ? `${age}d` : '—'}</td>
                        <td className="lf-dtd lf-dtd--stage">
                          <span className={`lf-stage-pill lf-stage-pill--${cat}`}>{stage?.label || p.dealstage}</span>
                        </td>
                        <td className="lf-dtd lf-dtd--dis">{dis !== null ? `${dis}d` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Column filter dropdown — rendered outside table to avoid overflow clipping */}
            {activeFilterCol && filterPos && (
              <div
                className="lf-filter-dd"
                style={{ position: 'fixed', top: filterPos.top, left: filterPos.left, zIndex: 1000 }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  className="lf-filter-search"
                  type="text"
                  placeholder="Search values..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  autoFocus
                />
                <div className="lf-filter-acts">
                  <button onClick={() => clearColumnFilter(activeFilterCol)}>Clear filter</button>
                  <span className="lf-filter-count">
                    {(drillUniqueValues[activeFilterCol] || [])
                      .filter(v => !filterSearch || v.value.toLowerCase().includes(filterSearch.toLowerCase()))
                      .length} values
                  </span>
                </div>
                <div className="lf-filter-list">
                  {(drillUniqueValues[activeFilterCol] || [])
                    .filter(v => !filterSearch || v.value.toLowerCase().includes(filterSearch.toLowerCase()))
                    .slice(0, 100)
                    .map(({ value, count }) => (
                      <label key={value} className="lf-filter-item">
                        <input
                          type="checkbox"
                          checked={isFilterChecked(activeFilterCol, value)}
                          onChange={() => toggleFilterValue(activeFilterCol, value)}
                        />
                        <span className="lf-filter-val" title={value}>{value}</span>
                        <span className="lf-filter-cnt">{count}</span>
                      </label>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
