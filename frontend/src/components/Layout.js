import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// NAV de Andreu Logistics — Sistema Operativo Inteligente para operación de flota propia
// (3 plataformas 48' en Cuernavaca, Morelos). El módulo broker se separó al sistema VIVO.
const NAV = [
  // ── Núcleo operativo ──────────────────────────────
  { to: '/', label: 'Dashboard', icon: '📊', roles: ['director','admin','caja','logistica','monitoreo'] },
  { to: '/autopilot',      label: 'Autopilot',    icon: '🤖', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/agentes',        label: 'Agentes IA',   icon: '🧠', roles: ['director','admin','caja','logistica'] },
  { to: '/auditor',        label: 'Auditor IA',   icon: '🔍', roles: ['director'] },
  { to: '/fiscal',         label: 'Facturación SAT', icon: '📄', roles: ['director','admin','caja'] },
  { to: '/atraccion',      label: 'Atracción IA', icon: '🚀', roles: ['director','admin'] },
  { to: '/registro-movil', label: 'Registrar Viaje', icon: '🚛', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/movil',          label: 'Modo Móvil',      icon: '📱', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/logistica',      label: 'KPIs Flota',   icon: '📡', roles: ['director','admin','logistica','monitoreo'] },

  // ── Flota y operación ─────────────────────────────
  { to: '/unidades',      label: 'Unidades',      icon: '🚛', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/operadores',    label: 'Operadores',    icon: '👤', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/mantenimiento', label: 'Mantenimiento', icon: '🔧', roles: ['director','admin','logistica'] },
  { to: '/gastos',        label: 'Gastos y Diesel', icon: '⛽', roles: ['director','admin','caja','logistica'] },
  { to: '/flotilla',      label: 'Tarjetas y TAGs', icon: '💳', roles: ['director','admin','logistica','monitoreo','caja'] },

  // ── Comercial / Cobranza ──────────────────────────
  { to: '/clientes',     label: 'Clientes',     icon: '👥', roles: ['director','admin','caja'] },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: '📄', roles: ['director','admin','caja'] },
  { to: '/cxc',          label: 'Por Cobrar',   icon: '💳', roles: ['director','admin','caja'] },

  // ── Backoffice ────────────────────────────────────
  { to: '/compras', label: 'Refacciones y Proveedores', icon: '🛒', roles: ['director','admin'] },
  { to: '/nomina',  label: 'Nómina y Bonos', icon: '💰', roles: ['director','admin'] },

  // ── Reportes ──────────────────────────────────────
  { to: '/historicos', label: 'Tendencias', icon: '📈', roles: ['director','admin','monitoreo'] },
  { to: '/reportes',   label: 'Reportes',   icon: '📑', roles: ['director','admin','monitoreo'] },

  { to: '/costos-ia',     label: 'Costos IA',     icon: '💸', roles: ['director','admin'] },
  { to: '/configuracion', label: 'Configuración', icon: '⚙️', roles: ['director','admin'] },
];

const ROLES = {
  director: 'Director',
  admin: 'Administrador General',
  caja: 'Auxiliar Administrativo',
  logistica: 'Coordinador Operativo',
  monitoreo: 'Monitoreo',
};

export default function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="layout">
      <div className={`overlay ${open?'show':''}`} onClick={() => setOpen(false)} />
      <div className={`sidebar ${open?'open':''}`}>
        <div className="sidebar-logo">
          <h1>Andreu Logistics</h1>
          <span>Sistema Operativo Inteligente</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.filter(n => n.roles.includes(usuario?.rol)).map(n => (
            <NavLink key={n.to} to={n.to} end={n.to==='/'} className={({isActive}) => `nav-item ${isActive?'active':''}`} onClick={() => setOpen(false)}>
              <span className="icon">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{usuario?.nombre}</div>
          <div className="sidebar-user-rol">{ROLES[usuario?.rol]}</div>
          <div className="sidebar-user-logout" onClick={handleLogout}>Cerrar sesión →</div>
        </div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
        <div className="mobile-header">
          <button className="hamburger" onClick={() => setOpen(!open)}>☰</button>
          <span style={{ fontWeight:600 }}>Andreu Logistics</span>
          <span style={{ fontSize:12, opacity:.7 }}>{usuario?.nombre}</span>
        </div>
        <div className="main-content"><Outlet /></div>
      </div>
    </div>
  );
}
