import { useState, useMemo, useEffect, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { useContactsData } from '../hooks/useContactsData';
import { TEAMS, ALLOWED_REP_NAMES, getRepTeam } from '../config/teams';
import { formatShortCurrency } from '../utils/calendarUtils';
import MultiSelectDropdown from './MultiSelectDropdown';
import './ContactsView.css';

/* ── Quarter presets ─────────────────────────────────────── */
const PERIODS = [
  { label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
  { label: 'Q4 2025', start: '2025-10-01', end: '2025-12-31' },
  { label: 'Q3 2025', start: '2025-07-01', end: '2025-09-30' },
  { label: 'Q2 2025', start: '2025-04-01', end: '2025-06-30' },
  { label: 'Q1 2025', start: '2025-01-01', end: '2025-03-31' },
  { label: 'All Time', start: null, end: null },
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

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

const TEAM_COLORS = {
  smb: { bg: '#EEF2FF', text: '#4338CA', border: '#818CF8' },
  am:  { bg: '#F0FDF4', text: '#15803D', border: '#4ADE80' },
  ent: { bg: '#FFF7ED', text: '#C2410C', border: '#FB923C' },
};

/* ── Lifecycle stage config ──────────────────────────────── */
const LIFECYCLE_STAGES = [
  { id: 'lead', label: 'Lead', color: '#6366F1' },
  { id: 'opportunity', label: 'Opportunity', color: '#0891B2' },
  { id: 'customer', label: 'Customer', color: '#10B981' },
  { id: 'other', label: 'Other', color: '#F59E0B' },
  { id: 'subscriber', label: 'Subscriber', color: '#8B5CF6' },
  { id: 'marketingqualifiedlead', label: 'MQL', color: '#D97706' },
  { id: 'salesqualifiedlead', label: 'SQL', color: '#059669' },
  { id: 'evangelist', label: 'Evangelist', color: '#DC2626' },
];

/* ── Lead status config ──────────────────────────────────── */
const LEAD_STATUS_COLORS = {
  NEW: '#6366F1',
  ATTEMPTED_TO_CONTACT: '#0891B2',
  CONNECTED: '#10B981',
  Discovery: '#059669',
  OPEN_DEAL: '#7C3AED',
  UNQUALIFIED: '#EF4444',
  Unresponsive: '#F59E0B',
  Junk: '#DC2626',
  Nurture: '#8B5CF6',
  'Closed-Won Account': '#10B981',
  'Less Priority': '#94A3B8',
  'Dead-Remarket': '#D97706',
  'Dead-Remove': '#991B1B',
  'closed lost deals contact': '#EF4444',
  Transferred: '#0284C7',
  'Other Buyer': '#64748B',
  'Discovery - MSP': '#059669',
};

const LEAD_STATUS_LABELS = {
  NEW: 'New',
  ATTEMPTED_TO_CONTACT: 'Attempting to Contact',
  CONNECTED: 'Connected',
  Discovery: 'Discovery',
  'Discovery - MSP': 'Discovery - MSP',
  OPEN_DEAL: 'Open Deal',
  'Less Priority': 'DNC',
  UNQUALIFIED: 'Unqualified',
  'Other Buyer': 'Other Buyer',
  Transferred: 'Transferred',
  Unresponsive: 'Unresponsive',
  'Dead-Remarket': 'Dead-Remarket',
  'Dead-Remove': 'Dead-Remove',
  'Closed-Won Account': 'Closed-Won',
  Nurture: 'Nurture',
  'closed lost deals contact': 'Closed Lost',
  Junk: 'Junk',
};

/* ── Lead source labels ──────────────────────────────────── */
const LEAD_SOURCE_LABELS = {
  Web_Pricing: 'Web Pricing',
  Chat: 'Chat',
  Email: 'Email',
  Inbound: 'Inbound Call',
  'Cold Call': 'Cold Call',
  'Outbound SDR': 'Outbound SDR',
  Linkedin: 'LinkedIn',
  'Existing Domain': 'Existing Domain',
  'Outbound Email': 'Outbound Email',
  Apollo: 'Apollo & Clay',
  'Multi channel': 'Multi Channel',
  'CF Manage Zoominfo': 'CF Manage ZoomInfo',
  ZoomInfo: 'ZoomInfo',
  'Outbound Source': 'Outbound Source',
  'Mail chimp': 'Mailchimp',
  other: 'Other',
  Contact: 'Contact',
  'Closed Lost/unresponsive (LQTD)': 'Closed Lost (LQTD)',
};

const LEAD_SOURCE_COLORS = {
  Apollo: '#4F46E5',
  Web_Pricing: '#0891B2',
  Chat: '#10B981',
  'Multi channel': '#D97706',
  Email: '#DC2626',
  Inbound: '#7C3AED',
  'Cold Call': '#059669',
  'Outbound SDR': '#0284C7',
  Linkedin: '#0077B5',
  'Outbound Email': '#8B5CF6',
};

/** Days since a date string */
function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

/** Month label from create date */
function getMonth(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/* ── Component ───────────────────────────────────────────── */
export default function ContactsView() {
  const [periodIdx, setPeriodIdx] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [checkedSources, setCheckedSources] = useState(new Set());
  const [selectedLifecycle, setSelectedLifecycle] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('Business MQL');
  const [drillDown, setDrillDown] = useState(null);
  const [sortCol, setSortCol] = useState('created');
  const [sortDir, setSortDir] = useState('desc');
  const [drillFilters, setDrillFilters] = useState({});
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterPos, setFilterPos] = useState(null);

  const period = PERIODS[periodIdx];
  const { contacts, owners, loading, error, refetch } = useContactsData(period.start, period.end);

  /* Owner map — whitelisted reps only */
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

  /* Filter contacts by category + team + source + lifecycle + status */
  const filteredContacts = useMemo(() =>
    contacts.filter((c) => {
      const p = c.properties;
      // MQL Type filter (matches HubSpot's "MQL Type" property)
      if (selectedCategory !== 'all') {
        if ((p.mql_type || '') !== selectedCategory) return false;
      }
      // Team filter: check if contact owner is in selected team
      if (selectedTeam !== 'all') {
        const owner = ownerMap[p.hubspot_owner_id];
        if (!owner || owner.teamId !== selectedTeam) return false;
      }
      // Lead source filter (multi-select)
      if (checkedSources.size > 0) {
        if (!checkedSources.has(p.lead_source || '__none')) return false;
      }
      // Lifecycle stage filter
      if (selectedLifecycle !== 'all') {
        if ((p.lifecyclestage || '') !== selectedLifecycle) return false;
      }
      // Lead status filter
      if (selectedStatus !== 'all') {
        if (selectedStatus === '__none') {
          if (p.hs_lead_status) return false;
        } else {
          if ((p.hs_lead_status || '') !== selectedStatus) return false;
        }
      }
      return true;
    }),
    [contacts, ownerMap, selectedTeam, checkedSources, selectedLifecycle, selectedStatus, selectedCategory]
  );

  /* ── Overall stats ──────────────────────────────────────── */
  const stats = useMemo(() => {
    const byLifecycle = {};
    const byStatus = {};
    const bySource = {};
    const byMonth = {};

    filteredContacts.forEach((c) => {
      const p = c.properties;
      const lc = p.lifecyclestage || 'unknown';
      const ls = p.hs_lead_status || '__none';
      const src = p.lead_source || '__none';
      const mo = getMonth(p.createdate);

      byLifecycle[lc] = (byLifecycle[lc] || 0) + 1;
      byStatus[ls] = (byStatus[ls] || 0) + 1;
      bySource[src] = (bySource[src] || 0) + 1;
      byMonth[mo] = (byMonth[mo] || 0) + 1;
    });

    return { total: filteredContacts.length, byLifecycle, byStatus, bySource, byMonth };
  }, [filteredContacts]);

  /* Per-team stats */
  const teamStats = useMemo(() =>
    TEAMS.map((team) => {
      const tc = contacts.filter((c) => {
        const owner = ownerMap[c.properties.hubspot_owner_id];
        return owner?.teamId === team.id;
      });
      const assigned = tc.length;
      const withDeals = tc.filter((c) => parseInt(c.properties.num_associated_deals || 0) > 0).length;
      const leads = tc.filter((c) => c.properties.lifecyclestage === 'lead').length;
      const opportunities = tc.filter((c) => c.properties.lifecyclestage === 'opportunity').length;
      const customers = tc.filter((c) => c.properties.lifecyclestage === 'customer').length;
      return { ...team, assigned, withDeals, leads, opportunities, customers };
    }),
    [contacts, ownerMap]
  );

  /* Per-rep stats */
  const repStats = useMemo(() => {
    const m = {};
    Object.values(ownerMap).forEach((owner) => {
      if (selectedTeam !== 'all' && owner.teamId !== selectedTeam) return;
      m[owner.id] = { owner, total: 0, leads: 0, opportunities: 0, customers: 0, other: 0, withDeals: 0 };
    });
    filteredContacts.forEach((c) => {
      const ownerId = c.properties.hubspot_owner_id;
      if (!m[ownerId]) return;
      const r = m[ownerId];
      r.total++;
      const lc = c.properties.lifecyclestage;
      if (lc === 'lead') r.leads++;
      else if (lc === 'opportunity') r.opportunities++;
      else if (lc === 'customer') r.customers++;
      else r.other++;
      if (parseInt(c.properties.num_associated_deals || 0) > 0) r.withDeals++;
    });
    return m;
  }, [filteredContacts, ownerMap, selectedTeam]);

  /* Unique lead sources in data (sorted by count) */
  const leadSources = useMemo(() => {
    const m = {};
    contacts.forEach((c) => {
      const src = c.properties.lead_source || '__none';
      m[src] = (m[src] || 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }));
  }, [contacts]);

  const sourceItems = useMemo(() =>
    leadSources.map(({ id, count }) => ({
      id,
      label: `${id === '__none' ? 'No Source' : (LEAD_SOURCE_LABELS[id] || id)} (${count})`,
      color: LEAD_SOURCE_COLORS[id] || null,
    })),
    [leadSources]
  );

  const toggleSource = (id) => {
    setCheckedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* Unique lead statuses in data */
  const leadStatuses = useMemo(() => {
    const m = {};
    contacts.forEach((c) => {
      const s = c.properties.hs_lead_status || '__none';
      m[s] = (m[s] || 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }));
  }, [contacts]);

  /* Unique lifecycle stages in data */
  const lifecycleStages = useMemo(() => {
    const m = {};
    contacts.forEach((c) => {
      const s = c.properties.lifecyclestage || 'unknown';
      m[s] = (m[s] || 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }));
  }, [contacts]);

  /* ── Drill-down helpers ───────────────────────────────── */
  const openDrill = (title, filterFn) => {
    const matching = filteredContacts.filter(filterFn);
    if (matching.length === 0) return;
    setDrillDown({ title, contacts: matching });
  };

  const closeDrill = () => { setDrillDown(null); setSortCol('created'); setSortDir('desc'); setDrillFilters({}); setActiveFilterCol(null); setFilterSearch(''); };

  /* Column value extractor for filter matching */
  const getContactColValue = (contact, colId) => {
    const p = contact.properties;
    switch (colId) {
      case 'name': return `${p.firstname || ''} ${p.lastname || ''}`.trim() || '(no name)';
      case 'contacted': return String(parseInt(p.num_contacted_notes) || 0);
      case 'email': return p.email || '—';
      case 'company': return p.company || '—';
      case 'rep': return ownerMap[p.hubspot_owner_id]?.fullName || '—';
      case 'lifecycle': {
        const ls = LIFECYCLE_STAGES.find(s => s.id === p.lifecyclestage);
        return ls?.label || p.lifecyclestage || '—';
      }
      case 'status': return LEAD_STATUS_LABELS[p.hs_lead_status] || p.hs_lead_status || '—';
      case 'source': return LEAD_SOURCE_LABELS[p.lead_source] || p.lead_source || '—';
      case 'created': return p.createdate ? new Date(p.createdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      case 'age': { const d = daysAgo(p.createdate); return d !== null ? `${d}d` : '—'; }
      default: return '';
    }
  };

  /* Unique values per column from current drill-down (unfiltered) */
  const drillUniqueValues = useMemo(() => {
    if (!drillDown) return {};
    const cols = ['name','contacted','email','company','rep','lifecycle','status','source','created','age'];
    const result = {};
    cols.forEach(colId => {
      const counts = {};
      drillDown.contacts.forEach(c => {
        const v = getContactColValue(c, colId);
        counts[v] = (counts[v] || 0) + 1;
      });
      result[colId] = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }));
    });
    return result;
  }, [drillDown, ownerMap]);

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
    const rows = sortedDrillContacts.map(c => {
      const p = c.properties;
      const owner = ownerMap[p.hubspot_owner_id];
      const lcStage = LIFECYCLE_STAGES.find(ls => ls.id === p.lifecyclestage);
      return {
        'Name': `${p.firstname || ''} ${p.lastname || ''}`.trim() || '(no name)',
        'Times Contacted': parseInt(p.num_contacted_notes) || 0,
        'Email': p.email || '',
        'Company': p.company || '',
        'Owner': owner?.fullName || '',
        'Lifecycle': lcStage?.label || p.lifecyclestage || '',
        'Lead Status': LEAD_STATUS_LABELS[p.hs_lead_status] || p.hs_lead_status || '',
        'Source': LEAD_SOURCE_LABELS[p.lead_source] || p.lead_source || '',
        'Created': p.createdate ? new Date(p.createdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
        'Age (days)': daysAgo(p.createdate) ?? '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key]).length).slice(0, 100)) + 2
    }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const filename = `${drillDown.title.replace(/[^a-zA-Z0-9 ]/g, '').trim()}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  /* Close filter dropdown on outside click */
  useEffect(() => {
    if (!activeFilterCol) return;
    const handler = (e) => {
      if (!e.target.closest('.cv-filter-dd') && !e.target.closest('.cv-filter-btn')) {
        setActiveFilterCol(null);
        setFilterSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeFilterCol]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(['name', 'rep', 'email', 'company', 'lifecycle', 'status', 'source'].includes(col) ? 'asc' : 'desc'); }
  };

  /** Sorted drill-down contacts */
  const sortedDrillContacts = useMemo(() => {
    if (!drillDown) return [];
    let list = [...drillDown.contacts];
    // Apply column filters
    Object.entries(drillFilters).forEach(([colId, allowedValues]) => {
      if (allowedValues.size > 0) {
        list = list.filter(c => allowedValues.has(getContactColValue(c, colId)));
      }
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const pa = a.properties, pb = b.properties;
      switch (sortCol) {
        case 'name': {
          const na = `${pa.firstname || ''} ${pa.lastname || ''}`.trim();
          const nb = `${pb.firstname || ''} ${pb.lastname || ''}`.trim();
          return dir * na.localeCompare(nb);
        }
        case 'email':
          return dir * (pa.email || '').localeCompare(pb.email || '');
        case 'company':
          return dir * (pa.company || '').localeCompare(pb.company || '');
        case 'rep': {
          const ra = ownerMap[pa.hubspot_owner_id]?.fullName || '';
          const rb = ownerMap[pb.hubspot_owner_id]?.fullName || '';
          return dir * ra.localeCompare(rb);
        }
        case 'lifecycle':
          return dir * (pa.lifecyclestage || '').localeCompare(pb.lifecyclestage || '');
        case 'status':
          return dir * (pa.hs_lead_status || '').localeCompare(pb.hs_lead_status || '');
        case 'source':
          return dir * (pa.lead_source || '').localeCompare(pb.lead_source || '');
        case 'created':
          return dir * ((new Date(pa.createdate || 0)).getTime() - (new Date(pb.createdate || 0)).getTime());
        case 'contacted':
          return dir * ((parseInt(pa.num_contacted_notes) || 0) - (parseInt(pb.num_contacted_notes) || 0));
        case 'age':
          return dir * ((daysAgo(pa.createdate) ?? -1) - (daysAgo(pb.createdate) ?? -1));
        default: return 0;
      }
    });
    return list;
  }, [drillDown, drillFilters, sortCol, sortDir, ownerMap]);

  /** Clickable number */
  const Clk = ({ val, onClick, className = '' }) =>
    val > 0
      ? <span className={`cv-click ${className}`} onClick={onClick}>{val}</span>
      : <span className={className}>{val}</span>;

  const maxSourceCount = useMemo(() =>
    Math.max(...Object.values(stats.bySource), 1),
    [stats.bySource]
  );

  const maxStatusCount = useMemo(() =>
    Math.max(...Object.values(stats.byStatus), 1),
    [stats.byStatus]
  );

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="cv">
      {/* Header */}
      <div className="cv-header">
        <div>
          <div className="cv-title">Contacts</div>
          <div className="cv-subtitle">
            {period.label} &middot; {stats.total} contacts
          </div>
        </div>
        <div className="cv-filters">
          <div className="cv-fg">
            <label className="cv-fl">TYPE</label>
            <select className="cv-sel cv-sel--highlight" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="all">All Types</option>
              <option value="Business MQL">Business MQL</option>
              <option value="Personal MQL">Personal MQL</option>
            </select>
          </div>
          <div className="cv-fg">
            <label className="cv-fl">PERIOD</label>
            <select className="cv-sel" value={periodIdx} onChange={(e) => setPeriodIdx(+e.target.value)}>
              {PERIODS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
            </select>
          </div>
          <div className="cv-fg">
            <label className="cv-fl">TEAM</label>
            <select className="cv-sel" value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
              <option value="all">All Teams</option>
              {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="cv-fg">
            <label className="cv-fl">LIFECYCLE</label>
            <select className="cv-sel" value={selectedLifecycle} onChange={(e) => setSelectedLifecycle(e.target.value)}>
              <option value="all">All Stages</option>
              {lifecycleStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {LIFECYCLE_STAGES.find((ls) => ls.id === s.id)?.label || s.id} ({s.count})
                </option>
              ))}
            </select>
          </div>
          <div className="cv-fg">
            <label className="cv-fl">STATUS</label>
            <select className="cv-sel" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              {leadStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === '__none' ? 'No Status' : (LEAD_STATUS_LABELS[s.id] || s.id)} ({s.count})
                </option>
              ))}
            </select>
          </div>
          <div className="cv-fg cv-fg--multiselect">
            <MultiSelectDropdown
              label="Source"
              allLabel="All Sources"
              items={sourceItems}
              checkedIds={checkedSources}
              onToggle={toggleSource}
              onClear={() => setCheckedSources(new Set())}
            />
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
          <span>Loading contacts from HubSpot...</span>
        </div>
      )}

      {!loading && !error && (
        <div className="cv-content">

          {/* ── Stats bar ── */}
          <div className="cv-stats">
            <div className="cv-st cv-click" onClick={() => openDrill('All Contacts', () => true)}>
              <div className="cv-st-val">{stats.total}</div>
              <div className="cv-st-lbl">Total Contacts</div>
            </div>
            <div className="cv-st-sep" />
            {LIFECYCLE_STAGES.filter((ls) => stats.byLifecycle[ls.id]).map((ls) => (
              <div
                key={ls.id}
                className="cv-st cv-click"
                onClick={() => openDrill(`${ls.label} Contacts`, (c) => (c.properties.lifecyclestage || '') === ls.id)}
              >
                <div className="cv-st-val" style={{ color: ls.color }}>{stats.byLifecycle[ls.id]}</div>
                <div className="cv-st-lbl">{ls.label} &middot; {pct(stats.byLifecycle[ls.id], stats.total)}%</div>
              </div>
            ))}
            {stats.byLifecycle.unknown > 0 && (
              <div
                className="cv-st cv-click"
                onClick={() => openDrill('Unknown Stage Contacts', (c) => !c.properties.lifecyclestage)}
              >
                <div className="cv-st-val" style={{ color: '#94A3B8' }}>{stats.byLifecycle.unknown}</div>
                <div className="cv-st-lbl">Unknown &middot; {pct(stats.byLifecycle.unknown, stats.total)}%</div>
              </div>
            )}
          </div>

          {/* ── Middle row: Lead Source + Lead Status ── */}
          <div className="cv-mid">
            {/* Lead Source Distribution */}
            <div className="cv-card cv-bar-card">
              <div className="cv-card-title">Lead Source Distribution</div>
              <div className="cv-card-sub">Where are {period.label} contacts coming from?</div>
              <div className="cv-bars">
                {Object.entries(stats.bySource)
                  .sort((a, b) => b[1] - a[1])
                  .map(([src, count]) => {
                    const barPct = (count / maxSourceCount) * 100;
                    const label = src === '__none' ? 'No Source' : (LEAD_SOURCE_LABELS[src] || src);
                    const color = LEAD_SOURCE_COLORS[src] || '#6366F1';
                    return (
                      <div
                        key={src}
                        className="cv-br cv-click"
                        onClick={() => openDrill(`${label} Contacts`, (c) => (c.properties.lead_source || '__none') === src)}
                      >
                        <span className="cv-br-name">{label}</span>
                        <div className="cv-br-track">
                          <div className="cv-br-bar" style={{ width: `${Math.max(barPct, 2)}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />
                        </div>
                        <span className="cv-br-cnt" style={{ color }}>{count}</span>
                        <span className="cv-br-pct">{pct(count, stats.total)}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Lead Status Distribution */}
            <div className="cv-card cv-bar-card">
              <div className="cv-card-title">Lead Status Distribution</div>
              <div className="cv-card-sub">Current status of {period.label} contacts</div>
              <div className="cv-bars">
                {Object.entries(stats.byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const barPct = (count / maxStatusCount) * 100;
                    const label = status === '__none' ? 'No Status' : (LEAD_STATUS_LABELS[status] || status);
                    const color = LEAD_STATUS_COLORS[status] || '#94A3B8';
                    return (
                      <div
                        key={status}
                        className="cv-br cv-click"
                        onClick={() => openDrill(`${label} Contacts`, (c) => {
                          const s = c.properties.hs_lead_status || '__none';
                          return s === status;
                        })}
                      >
                        <span className="cv-br-name">{label}</span>
                        <div className="cv-br-track">
                          <div className="cv-br-bar" style={{ width: `${Math.max(barPct, 2)}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />
                        </div>
                        <span className="cv-br-cnt" style={{ color }}>{count}</span>
                        <span className="cv-br-pct">{pct(count, stats.total)}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* ── Team Cards ── */}
          <div className="cv-teams-row">
            {teamStats.map((team) => {
              const tc = TEAM_COLORS[team.id] || TEAM_COLORS.smb;
              return (
                <div key={team.id} className="cv-tc" style={{ borderTopColor: tc.border }}>
                  <div className="cv-tc-top">
                    <span className="cv-tc-badge" style={{ color: tc.text, background: tc.bg }}>{team.name}</span>
                    <span
                      className="cv-tc-total cv-click"
                      onClick={() => openDrill(`${team.name} — All Contacts`, (c) => ownerMap[c.properties.hubspot_owner_id]?.teamId === team.id)}
                    >
                      {team.assigned} contacts
                    </span>
                  </div>
                  <div className="cv-tc-grid">
                    <div className="cv-tc-m cv-click" onClick={() => team.leads > 0 && openDrill(
                      `${team.name} — Leads`, (c) => ownerMap[c.properties.hubspot_owner_id]?.teamId === team.id && c.properties.lifecyclestage === 'lead'
                    )}>
                      <span className="cv-tc-mv" style={{ color: '#6366F1' }}>{team.leads}</span>
                      <span className="cv-tc-ml">Leads</span>
                    </div>
                    <div className="cv-tc-m cv-click" onClick={() => team.opportunities > 0 && openDrill(
                      `${team.name} — Opportunities`, (c) => ownerMap[c.properties.hubspot_owner_id]?.teamId === team.id && c.properties.lifecyclestage === 'opportunity'
                    )}>
                      <span className="cv-tc-mv" style={{ color: '#0891B2' }}>{team.opportunities}</span>
                      <span className="cv-tc-ml">Opps</span>
                    </div>
                    <div className="cv-tc-m cv-click" onClick={() => team.customers > 0 && openDrill(
                      `${team.name} — Customers`, (c) => ownerMap[c.properties.hubspot_owner_id]?.teamId === team.id && c.properties.lifecyclestage === 'customer'
                    )}>
                      <span className="cv-tc-mv" style={{ color: '#10B981' }}>{team.customers}</span>
                      <span className="cv-tc-ml">Customers</span>
                    </div>
                    <div className="cv-tc-m cv-click" onClick={() => team.withDeals > 0 && openDrill(
                      `${team.name} — With Deals`, (c) => ownerMap[c.properties.hubspot_owner_id]?.teamId === team.id && parseInt(c.properties.num_associated_deals || 0) > 0
                    )}>
                      <span className="cv-tc-mv" style={{ color: '#7C3AED' }}>{team.withDeals}</span>
                      <span className="cv-tc-ml">With Deals</span>
                    </div>
                  </div>
                  <div className="cv-tc-foot">
                    <span className="cv-tc-conv" style={{ color: tc.text }}>{pct(team.customers, team.assigned)}% conversion</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Rep Breakdown Table ── */}
          <div className="cv-card">
            <div className="cv-card-title">Rep Breakdown</div>
            <div className="cv-card-sub">Click any number to see the contacts</div>
            <div className="cv-tbl-wrap">
              <table className="cv-tbl">
                <thead>
                  <tr>
                    <th className="cv-th cv-th--rep">Rep</th>
                    <th className="cv-th cv-th--num">Total</th>
                    <th className="cv-th cv-th--num cv-th--lead">Leads</th>
                    <th className="cv-th cv-th--num cv-th--opp">Opps</th>
                    <th className="cv-th cv-th--num cv-th--cust">Customers</th>
                    <th className="cv-th cv-th--num">Other</th>
                    <th className="cv-th cv-th--num cv-th--deals">With Deals</th>
                    <th className="cv-th cv-th--num cv-th--conv">Conv%</th>
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
                        <tr className="cv-tr-team">
                          <td colSpan={8} className="cv-td-team">
                            <span className="cv-tc-badge" style={{ color: tc.text, background: tc.bg }}>{team.name}</span>
                          </td>
                        </tr>
                        {reps.map((r) => (
                          <tr key={r.owner.id} className="cv-tr">
                            <td className="cv-td cv-td--rep">
                              <span className="cv-dot" style={{ backgroundColor: r.owner.color }} />
                              {r.owner.fullName}
                            </td>
                            <td className="cv-td cv-td--num cv-td--total">
                              <Clk val={r.total} onClick={() => openDrill(
                                `${r.owner.fullName} — All`, (c) => c.properties.hubspot_owner_id === r.owner.id
                              )} />
                            </td>
                            <td className="cv-td cv-td--num cv-td--lead">
                              {r.leads ? <Clk val={r.leads} className="cv-td--lead-txt" onClick={() => openDrill(
                                `${r.owner.fullName} — Leads`, (c) => c.properties.hubspot_owner_id === r.owner.id && c.properties.lifecyclestage === 'lead'
                              )} /> : <span className="cv-dash">&mdash;</span>}
                            </td>
                            <td className="cv-td cv-td--num cv-td--opp">
                              {r.opportunities ? <Clk val={r.opportunities} className="cv-td--opp-txt" onClick={() => openDrill(
                                `${r.owner.fullName} — Opportunities`, (c) => c.properties.hubspot_owner_id === r.owner.id && c.properties.lifecyclestage === 'opportunity'
                              )} /> : <span className="cv-dash">&mdash;</span>}
                            </td>
                            <td className="cv-td cv-td--num cv-td--cust">
                              {r.customers ? <Clk val={r.customers} className="cv-td--cust-txt" onClick={() => openDrill(
                                `${r.owner.fullName} — Customers`, (c) => c.properties.hubspot_owner_id === r.owner.id && c.properties.lifecyclestage === 'customer'
                              )} /> : <span className="cv-dash">&mdash;</span>}
                            </td>
                            <td className="cv-td cv-td--num">
                              {r.other ? <Clk val={r.other} onClick={() => openDrill(
                                `${r.owner.fullName} — Other`, (c) => c.properties.hubspot_owner_id === r.owner.id && !['lead','opportunity','customer'].includes(c.properties.lifecyclestage)
                              )} /> : <span className="cv-dash">&mdash;</span>}
                            </td>
                            <td className="cv-td cv-td--num cv-td--deals">
                              {r.withDeals ? <Clk val={r.withDeals} className="cv-td--deals-txt" onClick={() => openDrill(
                                `${r.owner.fullName} — With Deals`, (c) => c.properties.hubspot_owner_id === r.owner.id && parseInt(c.properties.num_associated_deals || 0) > 0
                              )} /> : <span className="cv-dash">&mdash;</span>}
                            </td>
                            <td className="cv-td cv-td--num">
                              <span className={`cv-conv ${pct(r.customers, r.total) >= 15 ? 'cv-conv--hi' : pct(r.customers, r.total) >= 5 ? 'cv-conv--mid' : 'cv-conv--lo'}`}>
                                {pct(r.customers, r.total)}%
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
        <div className="cv-overlay" onClick={closeDrill}>
          <div className="cv-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cv-drawer-hdr">
              <div>
                <div className="cv-drawer-title">{drillDown.title}</div>
                <div className="cv-drawer-meta">
                  {sortedDrillContacts.length === drillDown.contacts.length
                    ? <>{drillDown.contacts.length} contact{drillDown.contacts.length !== 1 && 's'}</>
                    : <>{sortedDrillContacts.length} of {drillDown.contacts.length} contacts (filtered)</>
                  }
                  {activeFilterCount > 0 && (
                    <button className="cv-filter-clear-all" onClick={() => setDrillFilters({})}>
                      Clear all filters
                    </button>
                  )}
                </div>
              </div>
              <div className="cv-drawer-actions">
                <button className="cv-export-btn" onClick={exportToExcel} title="Export to Excel">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1v9m0 0L5 7m3 3l3-3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Export
                </button>
                <button className="cv-drawer-x" onClick={closeDrill}>&#10005;</button>
              </div>
            </div>
            <div className="cv-drawer-body">
              <table className="cv-dtbl">
                <thead>
                  <tr>
                    {[
                      { id: 'name',      label: 'Name',           cls: 'cv-dth--name' },
                      { id: 'contacted', label: 'Times Contacted', cls: 'cv-dth--contacted' },
                      { id: 'email',     label: 'Email',          cls: 'cv-dth--email' },
                      { id: 'company',   label: 'Company',        cls: 'cv-dth--company' },
                      { id: 'rep',       label: 'Owner',          cls: 'cv-dth--rep' },
                      { id: 'lifecycle', label: 'Lifecycle',      cls: 'cv-dth--lc' },
                      { id: 'status',    label: 'Lead Status',    cls: 'cv-dth--status' },
                      { id: 'source',    label: 'Source',         cls: 'cv-dth--source' },
                      { id: 'created',   label: 'Created',        cls: 'cv-dth--created' },
                      { id: 'age',       label: 'Age',            cls: 'cv-dth--age' },
                    ].map((col) => (
                      <th key={col.id} className={`cv-dth ${col.cls}`}>
                        <div className="cv-dth-wrap">
                          <span className="cv-dth-sort" onClick={() => toggleSort(col.id)}>
                            {col.label}
                            <span className="cv-sort-icon">
                              {sortCol === col.id ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ' \u21C5'}
                            </span>
                          </span>
                          <button
                            className={`cv-filter-btn${drillFilters[col.id] ? ' cv-filter-btn--active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleFilter(col.id, e); }}
                            title={`Filter ${col.label}`}
                          >&#9662;</button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedDrillContacts.map((c) => {
                    const p = c.properties;
                    const fullName = `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.email || '(no name)';
                    const owner = ownerMap[p.hubspot_owner_id];
                    const age = daysAgo(p.createdate);
                    const lcStage = LIFECYCLE_STAGES.find((ls) => ls.id === p.lifecyclestage);
                    const created = p.createdate ? new Date(p.createdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
                    return (
                      <tr key={c.id} className="cv-dtr">
                        <td className="cv-dtd cv-dtd--name" title={fullName}>{fullName}</td>
                        <td className="cv-dtd cv-dtd--contacted">{parseInt(p.num_contacted_notes) || 0}</td>
                        <td className="cv-dtd cv-dtd--email" title={p.email}>{p.email || '—'}</td>
                        <td className="cv-dtd cv-dtd--company" title={p.company}>{p.company || '—'}</td>
                        <td className="cv-dtd cv-dtd--rep">
                          {owner && <span className="cv-dot" style={{ backgroundColor: owner.color }} />}
                          {owner?.fullName || '—'}
                        </td>
                        <td className="cv-dtd cv-dtd--lc">
                          <span className="cv-lc-pill" style={{
                            background: lcStage ? `${lcStage.color}18` : '#F1F5F9',
                            color: lcStage?.color || '#64748B',
                          }}>
                            {lcStage?.label || p.lifecyclestage || '—'}
                          </span>
                        </td>
                        <td className="cv-dtd cv-dtd--status">
                          <span className="cv-status-pill" style={{
                            color: LEAD_STATUS_COLORS[p.hs_lead_status] || '#64748B',
                          }}>
                            {LEAD_STATUS_LABELS[p.hs_lead_status] || p.hs_lead_status || '—'}
                          </span>
                        </td>
                        <td className="cv-dtd cv-dtd--source">{LEAD_SOURCE_LABELS[p.lead_source] || p.lead_source || '—'}</td>
                        <td className="cv-dtd cv-dtd--created">{created}</td>
                        <td className="cv-dtd cv-dtd--age">{age !== null ? `${age}d` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Column filter dropdown — rendered outside table to avoid overflow clipping */}
            {activeFilterCol && filterPos && (
              <div
                className="cv-filter-dd"
                style={{ position: 'fixed', top: filterPos.top, left: filterPos.left, zIndex: 1000 }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  className="cv-filter-search"
                  type="text"
                  placeholder="Search values..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  autoFocus
                />
                <div className="cv-filter-acts">
                  <button onClick={() => clearColumnFilter(activeFilterCol)}>Clear filter</button>
                  <span className="cv-filter-count">
                    {(drillUniqueValues[activeFilterCol] || [])
                      .filter(v => !filterSearch || v.value.toLowerCase().includes(filterSearch.toLowerCase()))
                      .length} values
                  </span>
                </div>
                <div className="cv-filter-list">
                  {(drillUniqueValues[activeFilterCol] || [])
                    .filter(v => !filterSearch || v.value.toLowerCase().includes(filterSearch.toLowerCase()))
                    .slice(0, 100)
                    .map(({ value, count }) => (
                      <label key={value} className="cv-filter-item">
                        <input
                          type="checkbox"
                          checked={isFilterChecked(activeFilterCol, value)}
                          onChange={() => toggleFilterValue(activeFilterCol, value)}
                        />
                        <span className="cv-filter-val" title={value}>{value}</span>
                        <span className="cv-filter-cnt">{count}</span>
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
