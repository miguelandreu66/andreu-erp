import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ['director','admin','caja','logistica','monitoreo'] },
  { to: '/caja', label: 'Caja y Ventas', icon: '💵', roles: ['director','admin','caja'] },
  { to: '/clientes', label: 'Clientes',  icon: '👥', roles: ['director','admin','caja'] },
  { to: '/cxc',          label: 'Por Cobrar',   icon: '💳', roles: ['director','admin','caja'] },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: '📄', roles: ['director','admin','caja'] },
  { to: '/compras',      label: 'Compras',      icon: '🛒', roles: ['director','admin'] },
  { to: '/logistica',     label: 'KPIs Flota',     icon: '📡', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/registro-movil',label: '📲 Reg. Viaje', icon: '🚛', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/flota',         label: 'Flota',          icon: '🗂', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/mantenimiento', label: 'Mantenimiento', icon: '🔧', roles: ['director','admin','logistica'] },
  { to: '/gastos', label: 'Gastos', icon: '📋', roles: ['director','admin','caja','logistica'] },
  { to: '/inventario', label: 'Inventario', icon: '📦', roles: ['director','admin','logistica','monitoreo'] },
  { to: '/nomina', label: 'Nómina', icon: '💰', roles: ['director','admin'] },
  { to: '/historicos', label: 'Tendencias', icon: '📈', roles: ['director','admin','monitoreo'] },
  { to: '/reportes', label: 'Reportes', icon: '📑', roles: ['director','admin','monitoreo'] },
  { to: '/configuracion', label: 'Configuración', icon: '⚙️', roles: ['director','admin'] },
];

const ROLES = { director:'Director', admin:'Administrador', caja:'Caja', logistica:'Logística', monitoreo:'Monitoreo' };

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
          <h1>Grupo Andreu</h1>
          <span>Sistema ERP v2</span>
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
          <span style={{ fontWeight:600 }}>Grupo Andreu ERP</span>
          <span style={{ fontSize:12, opacity:.7 }}>{usuario?.nombre}</span>
        </div>
        <div className="main-content"><Outlet /></div>
      </div>
    </div>
  );
}
