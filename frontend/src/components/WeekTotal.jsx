import { formatShortCurrency } from '../utils/calendarUtils';

export default function WeekTotal({ deals }) {
  const count = deals.length;
  const total = deals.reduce((sum, deal) => sum + (parseFloat(deal.properties.amount) || 0), 0);

  return (
    <div className={`week-total-cell ${count === 0 ? 'week-total-empty' : ''}`}>
      {count > 0 ? (
        <>
          <div className="week-total-count">
            {count} {count === 1 ? 'deal' : 'deals'}
          </div>
          {total > 0 && (
            <div className="week-total-amount">{formatShortCurrency(total)}</div>
          )}
        </>
      ) : (
        <span className="week-total-none">—</span>
      )}
    </div>
  );
}
