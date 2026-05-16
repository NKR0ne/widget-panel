import { C } from './theme.js';

export default function Skel({ n = 3 }) {
  return (
    <div style={{ paddingTop: 8 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <div style={C.skel(52 + (i * 17) % 36)} />
          <div style={{ ...C.skel(26), height: 8, marginBottom: 12 }} />
        </div>
      ))}
    </div>
  );
}
