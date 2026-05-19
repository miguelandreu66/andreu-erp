import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Sistema de notificaciones toast
// ════════════════════════════════════════════════════════════════

const ToastContext = createContext();

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const showToast = useCallback((message, opts = {}) => {
    const id = Date.now() + Math.random();
    const toast = {
      id,
      message,
      tipo: opts.tipo || 'info',  // info | success | warn | error
      duracion: opts.duracion ?? 4000,
      titulo: opts.titulo,
    };
    setToasts(t => [...t, toast]);
    if (toast.duracion > 0) {
      setTimeout(() => dismissToast(id), toast.duracion);
    }
    return id;
  }, [dismissToast]);

  const toast = {
    info:    (msg, opts) => showToast(msg, { ...opts, tipo: 'info' }),
    success: (msg, opts) => showToast(msg, { ...opts, tipo: 'success' }),
    warn:    (msg, opts) => showToast(msg, { ...opts, tipo: 'warn' }),
    error:   (msg, opts) => showToast(msg, { ...opts, tipo: 'error', duracion: opts?.duracion ?? 7000 }),
    dismiss: dismissToast,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

function ToastViewport({ toasts, onDismiss }) {
  return (
    <div style={{
      position: 'fixed',
      top: 16,
      right: 16,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      maxWidth: 380,
      width: 'calc(100% - 32px)',
    }}>
      {toasts.map(t => <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />)}
    </div>
  );
}

function ToastCard({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const config = {
    info:    { bg: '#fff', color: '#111827', border: '#3B82F6', icon: 'ℹ️' },
    success: { bg: '#fff', color: '#111827', border: '#16A34A', icon: '✅' },
    warn:    { bg: '#fff', color: '#111827', border: '#F59E0B', icon: '⚠️' },
    error:   { bg: '#fff', color: '#111827', border: '#DC2626', icon: '🚨' },
  }[toast.tipo] || {};

  return (
    <div style={{
      background: config.bg,
      color: config.color,
      borderLeft: `4px solid ${config.border}`,
      borderRadius: 8,
      padding: '12px 14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      transform: visible ? 'translateX(0)' : 'translateX(120%)',
      opacity: visible ? 1 : 0,
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      fontSize: 14,
    }}>
      <div style={{ fontSize: 18, lineHeight: 1 }}>{config.icon}</div>
      <div style={{ flex: 1 }}>
        {toast.titulo && <div style={{ fontWeight: 700, marginBottom: 2 }}>{toast.titulo}</div>}
        <div style={{ lineHeight: 1.4 }}>{toast.message}</div>
      </div>
      <button onClick={onDismiss} style={{
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        cursor: 'pointer',
        opacity: 0.5,
        fontSize: 18,
        padding: 0,
        marginLeft: 4,
      }}>×</button>
    </div>
  );
}
