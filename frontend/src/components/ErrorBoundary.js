import React from 'react';

// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Error Boundary global
// Captura errores de React y muestra pantalla amigable
// ════════════════════════════════════════════════════════════════

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#f9fafb',
          color: '#111827',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: "Inter, sans-serif",
        }}>
          <div style={{ maxWidth: 480, textAlign: 'center', background: '#fff', padding: 32, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 60, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 28, margin: '0 0 12px', color: '#dc2626', fontWeight: 800 }}>
              Algo se rompió
            </h1>
            <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
              Hubo un error inesperado en la interfaz. Tus datos están a salvo.
            </p>
            <details style={{
              textAlign: 'left',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              marginBottom: 20,
              color: '#991b1b',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Detalle técnico</summary>
              <pre style={{ overflow: 'auto', marginTop: 8, color: '#111827', fontFamily: 'monospace' }}>
                {this.state.error?.message || 'Error desconocido'}
              </pre>
            </details>
            <button onClick={() => window.location.href = '/'}
              style={{
                padding: '12px 24px',
                background: '#111827',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: 14,
              }}>
              Recargar Andreu
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
