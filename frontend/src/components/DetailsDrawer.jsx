import { useState, useEffect } from 'react';
import { formatShortCurrency } from '../utils/calendarUtils';
import './DetailsDrawer.css';

const STAGE_COLORS = {
  SQL: '#6366F1',
  Demo: '#0891B2',
  Trial: '#8B5CF6',
  'Quote Sent': '#F59E0B',
  Signature: '#10B981',
};

const METRIC_LABELS = {
  revenue: 'Revenue',
  deals: 'Deals Closed',
  pipeline: 'Pipeline',
  opps: 'Opps',
  mqls: 'MQLs',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function DetailsDrawer({ repName, ownerId, metric, dateRange, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerId || !metric) return;
    setLoading(true);
    const params = new URLSearchParams({ ownerId, metric });
    if (dateRange) {
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
    }
    fetch(`/api/goals-tracker/details?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ownerId, metric, dateRange]);

  const metricLabel = METRIC_LABELS[metric] || metric;
  const items = data?.items || [];

  // Group deals by stage for pipeline/opps
  const grouped = data?.grouped;
  const byStage = {};
  if (grouped) {
    for (const d of items) {
      if (!byStage[d.stage]) byStage[d.stage] = [];
      byStage[d.stage].push(d);
    }
  }
  const stageOrder = ['SQL', 'Demo', 'Trial', 'Quote Sent', 'Signature'];
  const sortedStages = stageOrder.filter((s) => byStage[s]);

  const isDeals = data?.type === 'deals';
  const isContacts = data?.type === 'contacts';
  const totalAmount = isDeals ? items.reduce((sum, d) => sum + (d.amount || 0), 0) : 0;

  return (
    <>
      <div className="dd-overlay" onClick={onClose} />
      <div className="dd-drawer">
        <div className="dd-header">
          <div>
            <div className="dd-title">{repName} — {metricLabel}</div>
            <div className="dd-subtitle">
              {items.length} {isContacts ? 'contacts' : 'deals'}
              {isDeals && <> &middot; {formatShortCurrency(totalAmount)} total</>}
              {dateRange && <span> &middot; {dateRange.label}</span>}
            </div>
          </div>
          <button className="dd-close" onClick={onClose}>&times;</button>
        </div>

        <div className="dd-body">
          {loading && <div className="dd-loading">Loading...</div>}

          {/* Pipeline/Opps: grouped by stage */}
          {!loading && grouped && sortedStages.map((stage) => (
            <div key={stage} className="dd-stage-group">
              <div className="dd-stage-header">
                <span className="dd-stage-dot" style={{ background: STAGE_COLORS[stage] || '#94A3B8' }} />
                <span className="dd-stage-name">{stage}</span>
                <span className="dd-stage-count">{byStage[stage].length}</span>
                <span className="dd-stage-amount">
                  {formatShortCurrency(byStage[stage].reduce((s, d) => s + (d.amount || 0), 0))}
                </span>
              </div>
              {byStage[stage].map((deal) => (
                <a key={deal.id} className="dd-deal" href={`https://app.hubspot.com/contacts/22689012/record/0-3/${deal.id}`} target="_blank" rel="noopener noreferrer">
                  <div className="dd-deal-name">{deal.dealname || 'Untitled'}</div>
                  <div className="dd-deal-meta">
                    <span className="dd-deal-amount">{deal.amount ? formatShortCurrency(deal.amount) : '$0'}</span>
                    <span className="dd-deal-date">Created {formatDate(deal.createdate)}</span>
                    {deal.closedate && <span className="dd-deal-date">Close {formatDate(deal.closedate)}</span>}
                  </div>
                </a>
              ))}
            </div>
          ))}

          {/* Revenue/Deals Closed: flat list */}
          {!loading && isDeals && !grouped && items.map((deal) => (
            <a key={deal.id} className="dd-deal" href={`https://app.hubspot.com/contacts/22689012/record/0-3/${deal.id}`} target="_blank" rel="noopener noreferrer">
              <div className="dd-deal-name">{deal.dealname || 'Untitled'}</div>
              <div className="dd-deal-meta">
                <span className="dd-deal-amount">{deal.amount ? formatShortCurrency(deal.amount) : '$0'}</span>
                <span className="dd-deal-date">Closed {formatDate(deal.closedate)}</span>
              </div>
            </a>
          ))}

          {/* MQLs: contact cards */}
          {!loading && isContacts && items.map((contact) => (
            <a key={contact.id} className="dd-contact" href={`https://app.hubspot.com/contacts/22689012/record/0-1/${contact.id}`} target="_blank" rel="noopener noreferrer">
              <div className="dd-contact-name">{contact.name}</div>
              <div className="dd-contact-meta">
                {contact.email && <span className="dd-contact-email">{contact.email}</span>}
                {contact.mqlType && <span className="dd-contact-tag">{contact.mqlType}</span>}
                {contact.leadSource && <span className="dd-contact-source">{contact.leadSource}</span>}
                <span className="dd-deal-date">Created {formatDate(contact.createdate)}</span>
              </div>
            </a>
          ))}

          {!loading && items.length === 0 && (
            <div className="dd-empty">No data found for this period.</div>
          )}
        </div>
      </div>
    </>
  );
}
