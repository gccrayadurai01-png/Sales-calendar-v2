import { formatShortCurrency, formatCurrency } from '../utils/calendarUtils';

export default function DealCard({ deal, owner }) {
  const { dealname, amount } = deal.properties;
  const color = owner?.color || '#6B7280';
  const parsedAmount = parseFloat(amount);

  return (
    <div className="deal-card" style={{ borderLeftColor: color }}>
      {/* Compact row — always visible */}
      <div className="deal-card-row">
        <span className="deal-name">{dealname || 'Untitled Deal'}</span>
        {parsedAmount > 0 && (
          <span className="deal-amount">{formatShortCurrency(parsedAmount)}</span>
        )}
      </div>

      {/* Tooltip — shown on hover */}
      <div className="deal-tooltip">
        <div className="tooltip-rep" style={{ color }}>
          <span className="rep-dot" style={{ backgroundColor: color }} />
          {owner?.fullName || 'Unassigned'}
        </div>
        <div className="tooltip-name">{dealname || 'Untitled Deal'}</div>
        {parsedAmount > 0 && (
          <div className="tooltip-amount">{formatCurrency(parsedAmount)}</div>
        )}
      </div>
    </div>
  );
}
