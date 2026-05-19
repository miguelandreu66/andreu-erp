import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Flota from './pages/Flota';
import Gastos from './pages/Gastos';
import Nomina from './pages/Nomina';
import Reportes from './pages/Reportes';
import Configuracion from './pages/Configuracion';
import Clientes from './pages/Clientes';
import Historicos from './pages/Historicos';
import Mantenimiento from './pages/Mantenimiento';
import CXC from './pages/CXC';
import Compras from './pages/Compras';
import Logistica from './pages/Logistica';
import Cotizaciones from './pages/Cotizaciones';
import RegistroMovil from './pages/RegistroMovil';
import CommandAI from './pages/CommandAI';
import Unidades from './pages/Unidades';
import Operadores from './pages/Operadores';
import Movil from './pages/Movil';
import Flotilla from './pages/Flotilla';
import CotizadorPublico from './pages/CotizadorPublico';
import AuditorIA from './pages/AuditorIA';
import Fiscal from './pages/Fiscal';
import AgentesIA from './pages/AgentesIA';
import CostosIA from './pages/CostosIA';
import Layout from './components/Layout';
import './App.css';

// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Sistema de operación de flota propia
// El módulo broker (Vendedor IA, Asignador IA, Retención IA, Atracción IA,
// Broker, Filtro transportistas) se separó al sistema independiente VIVO.
// ════════════════════════════════════════════════════════════════

const PrivateRoute = ({ children, roles, allowOperador = false }) => {
  const { usuario, loading } = useAuth();
  if (loading) return <div className="loading">Cargando...</div>;
  if (!usuario) return <Navigate to="/login" />;
  // Operadores SOLO pueden acceder a rutas marcadas allowOperador
  if (usuario.rol === 'operador' && !allowOperador) return <Navigate to="/movil" />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to="/" />;
  return children;
};

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cotizar" element={<CotizadorPublico />} />
          <Route path="/movil" element={<PrivateRoute allowOperador={true}><Movil /></PrivateRoute>} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="unidades" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Unidades /></PrivateRoute>} />
            <Route path="operadores" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Operadores /></PrivateRoute>} />
            <Route path="flotilla" element={<PrivateRoute roles={['director','admin','logistica','monitoreo','caja']}><Flotilla /></PrivateRoute>} />
            <Route path="flota" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Flota /></PrivateRoute>} />
            <Route path="gastos" element={<PrivateRoute roles={['director','admin','caja','logistica']}><Gastos /></PrivateRoute>} />
            <Route path="nomina" element={<PrivateRoute roles={['director','admin']}><Nomina /></PrivateRoute>} />
            <Route path="clientes" element={<PrivateRoute roles={['director','admin','caja']}><Clientes /></PrivateRoute>} />
            <Route path="cxc"      element={<PrivateRoute roles={['director','admin','caja']}><CXC /></PrivateRoute>} />
            <Route path="compras"   element={<PrivateRoute roles={['director','admin']}><Compras /></PrivateRoute>} />
            <Route path="logistica" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Logistica /></PrivateRoute>} />
            {/* /autopilot es el nuevo path; /command-ai queda como alias por bookmarks legacy */}
            <Route path="autopilot"  element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><CommandAI /></PrivateRoute>} />
            <Route path="command-ai" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><CommandAI /></PrivateRoute>} />
            <Route path="auditor"     element={<PrivateRoute roles={['director']}><AuditorIA /></PrivateRoute>} />
            <Route path="fiscal"      element={<PrivateRoute roles={['director','admin','caja']}><Fiscal /></PrivateRoute>} />
            <Route path="agentes"     element={<PrivateRoute roles={['director','admin','caja','logistica']}><AgentesIA /></PrivateRoute>} />
            <Route path="agentes/:nombre" element={<PrivateRoute roles={['director','admin','caja','logistica']}><AgentesIA /></PrivateRoute>} />
            <Route path="costos-ia" element={<PrivateRoute roles={['director','admin']}><CostosIA /></PrivateRoute>} />
            <Route path="historicos" element={<PrivateRoute roles={['director','admin','monitoreo']}><Historicos /></PrivateRoute>} />
            <Route path="mantenimiento" element={<PrivateRoute roles={['director','admin','logistica']}><Mantenimiento /></PrivateRoute>} />
            <Route path="cotizaciones" element={<PrivateRoute roles={['director','admin','caja']}><Cotizaciones /></PrivateRoute>} />
            <Route path="registro-movil" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><RegistroMovil /></PrivateRoute>} />
            <Route path="reportes" element={<Reportes />} />
            <Route path="configuracion" element={<PrivateRoute roles={['director','admin']}><Configuracion /></PrivateRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
