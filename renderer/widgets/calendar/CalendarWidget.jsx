import { useState } from 'react';

export default function CalendarWidget() {
  const [date, setDate] = useState(new Date());
  const month = date.getMonth();
  const year = date.getFullYear();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let index = 0; index < firstDayOfMonth; index++) {
    days.push({ day: daysInPreviousMonth - firstDayOfMonth + index + 1, adjacent: true });
  }
  for (let day = 1; day <= daysInMonth; day++) days.push({ day, adjacent: false });
  let nextMonthDay = 1;
  while (days.length < 42) {
    days.push({ day: nextMonthDay, adjacent: true });
    nextMonthDay += 1;
  }

  const prevMonth = () => setDate(new Date(year, month - 1, 1));
  const nextMonth = () => setDate(new Date(year, month + 1, 1));
  const prevYear = () => setDate(new Date(year - 1, month, 1));
  const nextYear = () => setDate(new Date(year + 1, month, 1));

  const isToday = (cell) => {
    if (!cell || cell.adjacent) return false;
    const today = new Date();
    return cell.day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    color: '#9c27b0',
    title: 'Calendrier',
    content: (
      <div style={{ padding: '12px', color: '#e4e4f4', fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={prevYear} style={calendarButtonStyle}>&lt;&lt;</button>
            <button onClick={prevMonth} style={calendarButtonStyle}>&lt;</button>
          </div>
          <div style={{ fontWeight: 600, textAlign: 'center' }}>
            <div>{monthNames[month]}</div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>{year}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={nextMonth} style={calendarButtonStyle}>&gt;</button>
            <button onClick={nextYear} style={calendarButtonStyle}>&gt;&gt;</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 8 }}>
          {dayNames.map((day) => <div key={day} style={{ textAlign: 'center', fontWeight: 600, fontSize: 9, opacity: 0.7 }}>{day}</div>)}
          {days.map((cell, index) => (
            <div
              key={index}
              style={{
                textAlign: 'center',
                padding: '4px',
                borderRadius: 3,
                background: isToday(cell) ? 'rgba(255,255,255,0.3)' : 'transparent',
                fontWeight: isToday(cell) ? 600 : 400,
                opacity: cell.adjacent ? 0.28 : 1,
                fontSize: 10,
              }}
            >
              {cell.day}
            </div>
          ))}
        </div>
      </div>
    ),
  };
}

const calendarButtonStyle = {
  background: 'rgba(255,255,255,0.2)',
  border: 'none',
  color: 'white',
  padding: '4px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 10,
};
