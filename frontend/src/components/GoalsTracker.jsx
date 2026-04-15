import { useState, useMemo, Fragment } from 'react';
import { useGoalsData } from '../hooks/useGoalsData';
import { formatShortCurrency } from '../utils/calendarUtils';
import MultiSelectDropdown from './MultiSelectDropdown';
import DetailsDrawer from './DetailsDrawer';
import './GoalsTracker.css';

const METRICS = [
  { key: 'revenue', label: 'Revenue', format: (v) => formatShortCurrency(v) },
  { key: 'deals', label: 'Deals Closed', format: (v) => v },
  { key: 'pipeline', label: 'Pipeline', format: (v) => formatShortCurrency(v) },
  { key: 'opps', label: 'Opps', format: (v) => v },
  { key: 'mqls', label: 'MQLs', format: (v) => v },
];

const MQL_TO_OPP_GOAL = 40; // 40% conversion target

function pct(actual, goal) {
  if (!goal) return 0;
  return Math.round((actual / goal) * 100);
}

function progressClass(percent) {
  if (percent >= 100) return 'gt-green';
  if (percent >= 70) return 'gt-yellow';
  return 'gt-red';
}

// Determine current week number (Week 1 = Apr 6 2026)
function getCurrentWeek() {
  const programStart = new Date('2026-04-06T00:00:00Z');
  const now = new Date();
  const diff = now - programStart;
  if (diff < 0) return 1;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function aggregateActuals(periods) {
  const totals = { revenue: 0, deals: 0, pipeline: 0, opps: 0, mqls: 0 };
  for (const p of periods) {
    totals.revenue += p.actuals.revenue;
    totals.deals += p.actuals.deals;
    totals.pipeline += p.actuals.pipeline;
    totals.opps += p.actuals.opps;
    totals.mqls += p.actuals.mqls;
  }
  return totals;
}

export default function GoalsTracker() {
  const { data, loading, error } = useGoalsData('weekly');
  const [checkedWeekIds, setCheckedWeekIds] = useState(new Set());
  const [selectedTeam, setSelectedTeam] = useState('');
  const [drawerRep, setDrawerRep] = useState(null);

  // Teams from API response
  const teams = useMemo(() => data?.teams || [], [data]);

  // Build week items for the multi-select dropdown
  const weekItems = useMemo(() => {
    if (!data?.results?.[0]?.periods) return [];
    return data.results[0].periods.map((p) => ({
      id: String(p.week),
      label: `${p.label} (${p.startDisplay} - ${p.endDisplay})`,
    }));
  }, [data]);

  const currentWeek = useMemo(() => getCurrentWeek(), []);

  const selectedWeeks = useMemo(() => {
    if (checkedWeekIds.size > 0) return checkedWeekIds;
    return new Set([String(currentWeek)]);
  }, [checkedWeekIds, currentWeek]);

  const numSelectedWeeks = selectedWeeks.size;

  // Compute the date range spanning all selected weeks (for pipeline drawer)
  const pipelineDateRange = useMemo(() => {
    if (!data?.results?.[0]?.periods) return null;
    const periods = data.results[0].periods.filter((p) => selectedWeeks.has(String(p.week)));
    if (periods.length === 0) return null;
    return {
      startDate: periods[0].start,
      endDate: periods[periods.length - 1].end,
      label: periods.length === 1
        ? `${periods[0].label} (${periods[0].startDisplay} - ${periods[0].endDisplay})`
        : `${periods[0].label} - ${periods[periods.length - 1].label}`,
    };
  }, [data, selectedWeeks]);

  // Filter reps by team, then compute aggregated data
  const repRows = useMemo(() => {
    if (!data?.results) return [];
    const filtered = selectedTeam
      ? data.results.filter((r) => r.team === selectedTeam)
      : data.results;
    return filtered.map((rep) => {
      const filteredPeriods = rep.periods.filter((p) => selectedWeeks.has(String(p.week)));
      const actuals = aggregateActuals(filteredPeriods);
      const goals = { revenue: 0, deals: 0, pipeline: 0, opps: 0, mqls: 0 };
      for (const p of filteredPeriods) {
        if (p.goals) {
          for (const key of Object.keys(goals)) {
            goals[key] += p.goals[key] || 0;
          }
        }
      }
      return { ...rep, actuals, aggregatedGoals: goals };
    });
  }, [data, selectedTeam, selectedWeeks, numSelectedWeeks]);

  // Team total row
  const teamRow = useMemo(() => {
    if (repRows.length === 0) return null;
    const actuals = { revenue: 0, deals: 0, pipeline: 0, opps: 0, mqls: 0 };
    const goals = { revenue: 0, deals: 0, pipeline: 0, opps: 0, mqls: 0 };
    for (const rep of repRows) {
      for (const key of Object.keys(actuals)) {
        actuals[key] += rep.actuals[key];
        goals[key] += rep.aggregatedGoals[key];
      }
    }
    return { actuals, goals };
  }, [repRows]);

  const toggleWeek = (weekId) => {
    setCheckedWeekIds((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  const clearWeeks = () => setCheckedWeekIds(new Set());

  if (loading) {
    return (
      <div className="gt-loading">
        <div className="spinner" />
        <span>Loading goals data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gt-error">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  const weekLabel = checkedWeekIds.size === 0
    ? `Week ${currentWeek} (current)`
    : `${checkedWeekIds.size} week${checkedWeekIds.size > 1 ? 's' : ''} selected`;

  const totalLabel = selectedTeam
    ? `${teams.find((t) => t.id === selectedTeam)?.name || 'Team'} Total`
    : 'All Teams Total';

  return (
    <div className="gt-container">
      {/* Controls */}
      <div className="gt-controls">
        <div className="gt-control-group">
          <label className="gt-label">Team</label>
          <select
            className="gt-select"
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
          >
            <option value="">All Teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <MultiSelectDropdown
          label="Weeks"
          allLabel={weekLabel}
          items={weekItems}
          checkedIds={checkedWeekIds}
          onToggle={toggleWeek}
          onClear={clearWeeks}
        />
      </div>

      {/* All Reps Table */}
      {repRows.length > 0 && (
        <div className="gt-table-wrap">
          <table className="gt-table">
            <thead>
              <tr>
                <th className="gt-th gt-th-rep">Rep</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="gt-th gt-th-metric-col" colSpan={2}>
                    {m.label}
                  </th>
                ))}
                <th className="gt-th gt-th-metric-col gt-th-conversion" colSpan={2}>MQL → Opp %</th>
              </tr>
              <tr className="gt-subheader">
                <th className="gt-th-sub"></th>
                {METRICS.map((m) => (
                  <Fragment key={m.key}>
                    <th className="gt-th-sub gt-th-sub-goal">Goal</th>
                    <th className="gt-th-sub gt-th-sub-actual">Actual</th>
                  </Fragment>
                ))}
                <th className="gt-th-sub gt-th-sub-goal">Goal</th>
                <th className="gt-th-sub gt-th-sub-actual">Actual</th>
              </tr>
            </thead>
            <tbody>
              {repRows.map((rep) => (
                <tr key={rep.repName} className="gt-row">
                  <td className="gt-td gt-td-rep">
                    <span className="gt-rep-name">{rep.fullName}</span>
                    {!selectedTeam && (
                      <span className={`gt-team-badge gt-team-badge--${rep.team}`}>
                        {rep.team?.toUpperCase()}
                      </span>
                    )}
                  </td>
                  {METRICS.map((m) => {
                    const goal = rep.aggregatedGoals[m.key];
                    const actual = rep.actuals[m.key];
                    const p = pct(actual, goal);
                    const isClickable = actual > 0;
                    return (
                      <Fragment key={m.key}>
                        <td className="gt-td gt-td-goal">{m.format(goal)}</td>
                        <td
                          className={`gt-td gt-td-actual${isClickable ? ' gt-td-clickable' : ''}`}
                          onClick={isClickable ? () => setDrawerRep({ fullName: rep.fullName, ownerId: rep.ownerId, metric: m.key, dateRange: pipelineDateRange }) : undefined}
                        >
                          <div className="gt-actual-cell">
                            <span className="gt-actual-value">{m.format(actual)}</span>
                            <span className={`gt-actual-pct ${progressClass(p)}`}>{p}%</span>
                          </div>
                          <div className="gt-bar-track">
                            <div
                              className={`gt-bar-fill ${progressClass(p)}`}
                              style={{ width: `${Math.min(p, 100)}%` }}
                            />
                          </div>
                        </td>
                      </Fragment>
                    );
                  })}
                  {/* MQL → Opp conversion column */}
                  {(() => {
                    const mqls = rep.actuals.mqls;
                    const opps = rep.actuals.opps;
                    const convRate = mqls > 0 ? Math.round((opps / mqls) * 100) : 0;
                    const diff = convRate - MQL_TO_OPP_GOAL;
                    const diffClass = diff >= 0 ? 'gt-green' : 'gt-red';
                    return (
                      <Fragment>
                        <td className="gt-td gt-td-goal">{MQL_TO_OPP_GOAL}%</td>
                        <td className="gt-td gt-td-actual">
                          <div className="gt-actual-cell">
                            <span className="gt-actual-value">{mqls > 0 ? `${convRate}%` : '—'}</span>
                            {mqls > 0 && (
                              <span className={`gt-actual-pct ${diffClass}`}>
                                {diff >= 0 ? '+' : ''}{diff}%
                              </span>
                            )}
                          </div>
                          {mqls > 0 && (
                            <div className="gt-bar-track">
                              <div
                                className={`gt-bar-fill ${progressClass(pct(convRate, MQL_TO_OPP_GOAL))}`}
                                style={{ width: `${Math.min(pct(convRate, MQL_TO_OPP_GOAL), 100)}%` }}
                              />
                            </div>
                          )}
                        </td>
                      </Fragment>
                    );
                  })()}
                </tr>
              ))}
              {/* Total Row */}
              {teamRow && (
                <tr className="gt-row gt-row-total">
                  <td className="gt-td gt-td-rep gt-td-total-label">{totalLabel}</td>
                  {METRICS.map((m) => {
                    const goal = teamRow.goals[m.key];
                    const actual = teamRow.actuals[m.key];
                    const p = pct(actual, goal);
                    return (
                      <Fragment key={m.key}>
                        <td className="gt-td gt-td-goal gt-td-total">{m.format(goal)}</td>
                        <td className="gt-td gt-td-actual gt-td-total">
                          <div className="gt-actual-cell">
                            <span className="gt-actual-value">{m.format(actual)}</span>
                            <span className={`gt-actual-pct ${progressClass(p)}`}>{p}%</span>
                          </div>
                          <div className="gt-bar-track">
                            <div
                              className={`gt-bar-fill ${progressClass(p)}`}
                              style={{ width: `${Math.min(p, 100)}%` }}
                            />
                          </div>
                        </td>
                      </Fragment>
                    );
                  })}
                  {/* MQL → Opp conversion for team total */}
                  {(() => {
                    const mqls = teamRow.actuals.mqls;
                    const opps = teamRow.actuals.opps;
                    const convRate = mqls > 0 ? Math.round((opps / mqls) * 100) : 0;
                    const diff = convRate - MQL_TO_OPP_GOAL;
                    const diffClass = diff >= 0 ? 'gt-green' : 'gt-red';
                    return (
                      <Fragment>
                        <td className="gt-td gt-td-goal gt-td-total">{MQL_TO_OPP_GOAL}%</td>
                        <td className="gt-td gt-td-actual gt-td-total">
                          <div className="gt-actual-cell">
                            <span className="gt-actual-value">{mqls > 0 ? `${convRate}%` : '—'}</span>
                            {mqls > 0 && (
                              <span className={`gt-actual-pct ${diffClass}`}>
                                {diff >= 0 ? '+' : ''}{diff}%
                              </span>
                            )}
                          </div>
                          {mqls > 0 && (
                            <div className="gt-bar-track">
                              <div
                                className={`gt-bar-fill ${progressClass(pct(convRate, MQL_TO_OPP_GOAL))}`}
                                style={{ width: `${Math.min(pct(convRate, MQL_TO_OPP_GOAL), 100)}%` }}
                              />
                            </div>
                          )}
                        </td>
                      </Fragment>
                    );
                  })()}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {drawerRep && (
        <DetailsDrawer
          repName={drawerRep.fullName}
          ownerId={drawerRep.ownerId}
          metric={drawerRep.metric}
          dateRange={drawerRep.dateRange}
          onClose={() => setDrawerRep(null)}
        />
      )}
    </div>
  );
}
