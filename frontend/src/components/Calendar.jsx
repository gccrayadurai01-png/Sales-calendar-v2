import React, { useMemo } from 'react';
import DayCell from './DayCell';
import WeekTotal from './WeekTotal';
import { getCalendarDays, dateKey, parseDealDate } from '../utils/calendarUtils';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Calendar({ year, month, deals, ownerMap }) {
  const weeks = useMemo(() => getCalendarDays(year, month), [year, month]);

  const dealsByDate = useMemo(() => {
    const map = {};
    deals.forEach((deal) => {
      const key = parseDealDate(deal.properties.closedate);
      if (key) {
        if (!map[key]) map[key] = [];
        map[key].push(deal);
      }
    });
    return map;
  }, [deals]);

  return (
    <div className="calendar-wrapper">
      <div className="calendar-grid">
        {/* Header row */}
        {WEEKDAYS.map((day) => (
          <div key={day} className="cal-header-cell">
            {day}
          </div>
        ))}
        <div className="cal-header-cell cal-header-total">Week Total</div>

        {/* Week rows */}
        {weeks.map((week, wi) => {
          const weekDeals = week.flatMap((day) => {
            if (!day) return [];
            return dealsByDate[dateKey(day)] || [];
          });

          return (
            <React.Fragment key={wi}>
              {week.map((day, di) => (
                <DayCell
                  key={day ? dateKey(day) : `pad-${wi}-${di}`}
                  date={day}
                  deals={day ? dealsByDate[dateKey(day)] || [] : []}
                  ownerMap={ownerMap}
                  currentMonth={month}
                />
              ))}
              <WeekTotal deals={weekDeals} />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
