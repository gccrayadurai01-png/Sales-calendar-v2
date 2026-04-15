import DealCard from './DealCard';
import { dateKey } from '../utils/calendarUtils';

export default function DayCell({ date, deals, ownerMap, currentMonth }) {
  if (!date) {
    return <div className="day-cell day-cell--empty" />;
  }

  const today = new Date();
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const isCurrentMonth = date.getMonth() === currentMonth;

  return (
    <div
      className={[
        'day-cell',
        isToday ? 'day-cell--today' : '',
        !isCurrentMonth ? 'day-cell--other-month' : '',
        deals.length > 0 ? 'day-cell--has-deals' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="day-number">
        <span className={isToday ? 'day-number--today' : ''}>{date.getDate()}</span>
        {deals.length > 0 && (
          <span className="day-deal-count">{deals.length}</span>
        )}
      </div>

      <div className="deals-list">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            owner={ownerMap[deal.properties.hubspot_owner_id]}
          />
        ))}
      </div>
    </div>
  );
}
