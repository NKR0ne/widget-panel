import { useEffect, useState } from 'react';

export default function ClockWidget() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();
  const cx = 64;
  const cy = 64;
  const radius = 54;
  const toXY = (angle, length) => [cx + length * Math.cos(angle), cy + length * Math.sin(angle)];
  const hourAngle = (hours * 30 + minutes * 0.5 - 90) * Math.PI / 180;
  const minuteAngle = (minutes * 6 + seconds * 0.1 - 90) * Math.PI / 180;
  const secondAngle = (seconds * 6 - 90) * Math.PI / 180;

  return {
    color: '#e8e8f0',
    title: 'Horloge',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 6, paddingBottom: 2 }}>
        <svg width={128} height={128} viewBox="0 0 128 128" style={{ display: 'block' }}>
          <circle cx={cx} cy={cy} r={radius} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
          {Array.from({ length: 60 }).map((_, index) => {
            const angle = (index * 6 - 90) * Math.PI / 180;
            const major = index % 5 === 0;
            const [x1, y1] = toXY(angle, radius - (major ? 1 : 0.5));
            const [x2, y2] = toXY(angle, radius - (major ? 9 : 5));
            return (
              <line
                key={index}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={major ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)'}
                strokeWidth={major ? 1.5 : 0.75}
                strokeLinecap="round"
              />
            );
          })}
          {renderHand(toXY, hourAngle, 30, 9, 'rgba(255,255,255,0.95)', 3)}
          {renderHand(toXY, minuteAngle, 46, 10, 'rgba(255,255,255,0.75)', 1.75)}
          {renderHand(toXY, secondAngle, 47, 13, '#f74f7e', 1)}
          <circle cx={cx} cy={cy} r={3.5} fill="#f74f7e" />
          <circle cx={cx} cy={cy} r={1.5} fill="rgba(20,20,24,0.8)" />
        </svg>
        <div style={{ fontSize: 11, color: '#d0d0e0', fontFamily: 'DM Mono,monospace', letterSpacing: 2, marginTop: 4 }}>
          {String(time.getHours()).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          <span style={{ fontSize: 9, color: '#c4c4d4', marginLeft: 5 }}>{time.getHours() < 12 ? 'AM' : 'PM'}</span>
        </div>
      </div>
    ),
  };
}

function renderHand(toXY, angle, length, backLength, color, width) {
  const [x, y] = toXY(angle, length);
  const [backX, backY] = toXY(angle + Math.PI, backLength);
  return <line x1={backX} y1={backY} x2={x} y2={y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
}
