import { useState, useEffect } from 'react';
import { formatShortCurrency } from '../utils/calendarUtils';
import './PipelineDrawer.css';

const STAGE_COLORS = {
  SQL: '#6366F1',
  Demo: '#0891B2',
  Trial: '#8B5CF6',
  'Quote Sent': '#F59E0B',
  Signature: '#10B981',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function PipelineDrawer({ repName, ownerId, dateRange, onClose }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerId) return;
    setLoading(true);
    const params = new URLSearchParams({ ownerId });
    if (dateRange) {
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
    }
    fetch(`/api/goals-tracker/pipeline-deals?${params}`)
      .then((r) => r.json())
      .then((data) => { setDeals(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ownerId, dateRange]);

  const totalAmount = deals.reduce((sum, d) => sum + (d.amount || 0), 0);

  // Group by stage
  const byStage = {};
  for (const d of deals) {
    if (!byStage[d.stage]) byStage[d.stage] = [];
    byStage[d.stage].push(d);
  }
  const stageOrder = ['SQL', 'Demo', 'Trial', 'Quote Sent', 'Signature'];
  const sortedStages = stageOrder.filter((s) => byStage[s]);

  return (
    <>
      <div className="pd-overlay" onClick={onClose} />
      <div className="pd-drawer">
        <div className="pd-header">
          <div>
            <div className="pd-title">{repName} — Pipeline</div>
            <div className="pd-subtitle">
              {deals.length} deals &middot; {formatShortCurrency(totalAmount)} total
              {dateRange && <span> &middot; Created {dateRange.label}</span>}
            </div>
          </div>
          <button className="pd-close" onClick={onClose}>&times;</button>
        </div>

        <div className="pd-body">
          {loading && <div className="pd-loading">Loading deals...</div>}
          {!loading && deals.length === 0 && (
            <div className="pd-empty">No pipeline deals found.</div>
          )}
          {!loading && sortedStages.map((stage) => (
            <div key={stage} className="pd-stage-group">
              <div className="pd-stage-header">
                <span
                  className="pd-stage-dot"
                  style={{ background: STAGE_COLORS[stage] || '#94A3B8' }}
                />
                <span className="pd-stage-name">{stage}</span>
                <span className="pd-stage-count">{byStage[stage].length}</span>
                <span className="pd-stage-amount">
                  {formatShortCurrency(byStage[stage].reduce((s, d) => s + (d.amount || 0), 0))}
                </span>
              </div>
              {byStage[stage].map((deal) => (
                <a
                  key={deal.id}
                  className="pd-deal"
                  href={`https://app.hubspot.com/contacts/22689012/record/0-3/${deal.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="pd-deal-name">{deal.dealname || 'Untitled'}</div>
                  <div className="pd-deal-meta">
                    <span className="pd-deal-amount">
                      {deal.amount ? formatShortCurrency(deal.amount) : '$0'}
                    </span>
                    <span className="pd-deal-date">
                      Created {formatDate(deal.createdate)}
                    </span>
                    {deal.closedate && (
                      <span className="pd-deal-date">
                        Close {formatDate(deal.closedate)}
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
