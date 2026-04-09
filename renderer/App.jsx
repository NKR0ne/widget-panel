import { useState } from 'react'

export default function App() {
  return (
    <div style={{
      height:          '100vh',
      background:      '#111114',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      flexDirection:   'column',
      gap:             12,
      fontFamily:      'system-ui, sans-serif',
      color:           '#f0f0f0',
    }}>
      <div style={{ fontSize: 18, fontWeight: 300, letterSpacing: -0.5 }}>
        Widget Panel
      </div>
      <div style={{ fontSize: 11, color: '#333' }}>
        ready — paste full component into App.jsx
      </div>
      <div style={{ fontSize: 10, color: '#222', marginTop: 8, fontFamily: 'monospace' }}>
        {window.electronAPI?.platform || 'browser'}
      </div>
    </div>
  )
}
