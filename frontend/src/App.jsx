import { useState, useMemo } from 'react';
import { useAuth } from './auth/AuthContext.jsx';
import Calendar from './components/Calendar';
import Filters from './components/Filters';
import Legend from './components/Legend';
import MultiSelectDropdown from './components/MultiSelectDropdown';
import LeadFlow from './components/LeadFlow';
import ContactsView from './components/ContactsView';
import PipelineVelocity from './components/PipelineVelocity';
import GoalsTracker from './components/GoalsTracker';
import { useHubspotData } from './hooks/useHubspotData';
import { useSyncStatus } from './hooks/useSyncStatus';
import { formatShortCurrency } from './utils/calendarUtils';
import { TEAMS, ALLOWED_REP_NAMES, getRepTeam } from './config/teams';

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

// Colour-code a pipeline stage by close probability
function getStageColor(probability) {
  const p = parseFloat(probability);
  if (p === 1)  return '#10B981'; // green  — Closed Won
  if (p === 0)  return '#EF4444'; // red    — Closed Lost
  if (p >= 0.8) return '#6366F1'; // indigo
  if (p >= 0.6) return '#8B5CF6'; // purple
  if (p >= 0.4) return '#0891B2'; // cyan
  if (p >= 0.2) return '#F59E0B'; // amber
  return '#94A3B8';               // gray   — unknown
}

export default function App() {
  const { logout } = useAuth();
  const today = new Date();
  const [activeView, setActiveView] = useState('calendar');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  // checkedRepIds: empty Set = show all; non-empty = show only those reps
  const [checkedRepIds, setCheckedRepIds] = useState(new Set());
  const [selectedTeam, setSelectedTeam] = useState('');
  // checkedStageIds: empty Set = show all; non-empty = show only those stages
  const [checkedStageIds, setCheckedStageIds] = useState(new Set());

  const { deals, owners, stages, loading, error, refetch } = useHubspotData(year, month);
  const sync = useSyncStatus();

  // Build enriched owner map — whitelisted reps only, ordered by team then name
  const ownerMap = useMemo(() => {
    const whitelisted = owners.filter((owner) => {
      const fullName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
      return ALLOWED_REP_NAMES.includes(fullName.toLowerCase());
    });

    whitelisted.sort((a, b) => {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim();
      const teamA = getRepTeam(nameA);
      const teamB = getRepTeam(nameB);
      const teamIdxA = TEAMS.findIndex((t) => t.id === teamA?.id);
      const teamIdxB = TEAMS.findIndex((t) => t.id === teamB?.id);
      if (teamIdxA !== teamIdxB) return teamIdxA - teamIdxB;
      return nameA.localeCompare(nameB);
    });

    return whitelisted.reduce((acc, owner, idx) => {
      const fullName =
        `${owner.firstName || ''} ${owner.lastName || ''}`.trim() ||
        owner.email ||
        `Owner ${owner.id}`;
      const team = getRepTeam(fullName);
      acc[owner.id] = {
        ...owner,
        fullName,
        initials: getInitials(fullName),
        color: REP_COLORS[idx % REP_COLORS.length],
        teamId: team?.id || null,
      };
      return acc;
    }, {});
  }, [owners]);

  // Build stage items for the dropdown (only stages present in current deals)
  const stageItems = useMemo(() => {
    // Collect stage IDs that appear in the current deals
    const usedStageIds = new Set(deals.map((d) => d.properties.dealstage).filter(Boolean));

    return stages
      .filter((s) => usedStageIds.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: getStageColor(s.probability),
      }));
  }, [stages, deals]);

  // Filter deals: whitelisted reps → rep filter → stage filter
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      const ownerId = deal.properties.hubspot_owner_id;
      const owner = ownerMap[ownerId];
      if (!owner) return false;
      if (checkedRepIds.size > 0 && !checkedRepIds.has(ownerId)) return false;
      if (checkedStageIds.size > 0 && !checkedStageIds.has(deal.properties.dealstage)) return false;
      return true;
    });
  }, [deals, checkedRepIds, checkedStageIds, ownerMap]);

  const toggleRep = (ownerId) => {
    setCheckedRepIds((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
    setSelectedTeam('');
  };

  const clearReps = () => {
    setCheckedRepIds(new Set());
    setSelectedTeam('');
  };

  const toggleStage = (stageId) => {
    setCheckedStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  const clearStages = () => setCheckedStageIds(new Set());

  const handleTeamChange = (teamId) => {
    setSelectedTeam(teamId);
    if (teamId) {
      const teamRepIds = new Set(
        Object.values(ownerMap)
          .filter((o) => o.teamId === teamId)
          .map((o) => o.id)
      );
      setCheckedRepIds(teamRepIds);
    } else {
      setCheckedRepIds(new Set());
    }
  };

  // Month-level summary
  const monthTotal = useMemo(() => {
    const count = filteredDeals.length;
    const amount = filteredDeals.reduce(
      (sum, d) => sum + (parseFloat(d.properties.amount) || 0),
      0
    );
    return { count, amount };
  }, [filteredDeals]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  const isCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const monthName = new Date(year, month, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const ownerList = Object.values(ownerMap);

  const hasAnyFilter = checkedRepIds.size > 0 || checkedStageIds.size > 0;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <span className="header-icon">📅</span>
          <h1 className="header-title">Sales Calendar</h1>
        </div>

        {activeView === 'calendar' && (
          <div className="header-nav">
            <button className="nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
            <h2 className="month-title">{monthName}</h2>
            <button className="nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
            {!isCurrentMonth && (
              <button className="today-btn" onClick={goToToday}>Today</button>
            )}
          </div>
        )}

        {activeView !== 'calendar' && <div className="header-nav" />}

        <div className="header-right">
          {activeView === 'calendar' && (
            <Filters
              teams={TEAMS}
              selectedTeam={selectedTeam}
              onTeamChange={handleTeamChange}
            />
          )}
          <button type="button" className="logout-btn" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </header>

      {/* Sync status bar */}
      <div className="sync-bar">
        <div className="sync-info">
          {sync.status === 'running' && (
            <><span className="sync-spinner" /> Syncing from HubSpot...</>
          )}
          {sync.status === 'success' && sync.timeAgo && (
            <span className="sync-ok">Last synced: {sync.timeAgo} ({sync.counts.deals} deals, {sync.counts.contacts} contacts)</span>
          )}
          {sync.status === 'error' && (
            <span className="sync-err">Sync error: {sync.error}</span>
          )}
          {sync.status === 'never' && (
            <span className="sync-warn">No data synced yet</span>
          )}
        </div>
        <button
          className="sync-btn"
          onClick={() => { sync.triggerSync(); setTimeout(() => refetch(), 500); }}
          disabled={sync.status === 'running'}
        >
          {sync.status === 'running' ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Tab bar */}
      <nav className="app-tabs">
        <button
          className={`app-tab${activeView === 'calendar' ? ' app-tab--active' : ''}`}
          onClick={() => setActiveView('calendar')}
        >
          Calendar
        </button>
        <button
          className={`app-tab${activeView === 'leadflow' ? ' app-tab--active' : ''}`}
          onClick={() => setActiveView('leadflow')}
        >
          Deal Flow
        </button>
        <button
          className={`app-tab${activeView === 'contacts' ? ' app-tab--active' : ''}`}
          onClick={() => setActiveView('contacts')}
        >
          Contacts
        </button>
        <button
          className={`app-tab${activeView === 'velocity' ? ' app-tab--active' : ''}`}
          onClick={() => setActiveView('velocity')}
        >
          Pipeline Velocity
        </button>
        <button
          className={`app-tab${activeView === 'goals' ? ' app-tab--active' : ''}`}
          onClick={() => setActiveView('goals')}
        >
          Goals Tracker
        </button>
      </nav>

      {/* ── Calendar View ── */}
      {activeView === 'calendar' && (
        <>
          {/* Summary bar */}
          {!loading && !error && (
            <div className="summary-bar">
              <div className="summary-filters">
                <Legend
                  owners={ownerList}
                  checkedRepIds={checkedRepIds}
                  onToggle={toggleRep}
                  onClear={clearReps}
                />
                {stageItems.length > 0 && (
                  <MultiSelectDropdown
                    label="Stage"
                    allLabel="All Stages"
                    items={stageItems}
                    checkedIds={checkedStageIds}
                    onToggle={toggleStage}
                    onClear={clearStages}
                  />
                )}
              </div>
              <div className="summary-stats">
                <span className="summary-stat">
                  <strong>{monthTotal.count}</strong> deals closing in {monthName}
                </span>
                {monthTotal.amount > 0 && (
                  <span className="summary-stat summary-stat--amount">
                    <strong>{formatShortCurrency(monthTotal.amount)}</strong> total
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="error-banner">
              <strong>Connection error:</strong> {error}
              <div className="error-hint">
                Make sure the backend is running (<code>npm run dev</code>) and{' '}
                <code>backend/.env</code> contains your <code>HUBSPOT_ACCESS_TOKEN</code>.
              </div>
              <button className="retry-btn" onClick={refetch}>Retry</button>
            </div>
          )}

          {/* Calendar */}
          {loading ? (
            <div className="loading">
              <div className="spinner" />
              <span>Loading deals from HubSpot…</span>
            </div>
          ) : !error ? (
            <main className="calendar-container">
              <Calendar
                year={year}
                month={month}
                deals={filteredDeals}
                ownerMap={ownerMap}
              />
              {filteredDeals.length === 0 && !loading && (
                <div className="no-deals">
                  No deals closing in {monthName}
                  {hasAnyFilter && ' for the selected filters'}.
                </div>
              )}
            </main>
          ) : null}
        </>
      )}

      {/* ── Lead Flow View ── */}
      {activeView === 'leadflow' && <LeadFlow />}

      {/* ── Contacts View ── */}
      {activeView === 'contacts' && <ContactsView />}

      {/* ── Pipeline Velocity View ── */}
      {activeView === 'velocity' && <PipelineVelocity />}

      {/* ── Goals Tracker View ── */}
      {activeView === 'goals' && <GoalsTracker />}
    </div>
  );
}
