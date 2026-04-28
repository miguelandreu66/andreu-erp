import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Caja from './pages/Caja';
import Flota from './pages/Flota';
import Gastos from './pages/Gastos';
import Inventario from './pages/Inventario';
import Nomina from './pages/Nomina';
import Reportes from './pages/Reportes';
import Configuracion from './pages/Configuracion';
import Clientes from './pages/Clientes';
import Historicos from './pages/Historicos';
import Mantenimiento from './pages/Mantenimiento';
import CXC from './pages/CXC';
import Compras from './pages/Compras';
import Logistica from './pages/Logistica';
import Layout from './components/Layout';
import './App.css';

const PrivateRoute = ({ children, roles }) => {
  const { usuario, loading } = useAuth();
  if (loading) return <div className="loading">Cargando...</div>;
  if (!usuario) return <Navigate to="/login" />;
  if (roles && !roles.includes(usuario.rol)) return <Navigate to="/" />;
  return children;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="caja" element={<PrivateRoute roles={['director','admin','caja']}><Caja /></PrivateRoute>} />
            <Route path="flota" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Flota /></PrivateRoute>} />
            <Route path="gastos" element={<PrivateRoute roles={['director','admin','caja','logistica']}><Gastos /></PrivateRoute>} />
            <Route path="inventario" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Inventario /></PrivateRoute>} />
            <Route path="nomina" element={<PrivateRoute roles={['director','admin']}><Nomina /></PrivateRoute>} />
            <Route path="clientes" element={<PrivateRoute roles={['director','admin','caja']}><Clientes /></PrivateRoute>} />
            <Route path="cxc"      element={<PrivateRoute roles={['director','admin','caja']}><CXC /></PrivateRoute>} />
            <Route path="compras"   element={<PrivateRoute roles={['director','admin']}><Compras /></PrivateRoute>} />
            <Route path="logistica" element={<PrivateRoute roles={['director','admin','logistica','monitoreo']}><Logistica /></PrivateRoute>} />
            <Route path="historicos" element={<PrivateRoute roles={['director','admin','monitoreo']}><Historicos /></PrivateRoute>} />
            <Route path="mantenimiento" element={<PrivateRoute roles={['director','admin','logistica']}><Mantenimiento /></PrivateRoute>} />
            <Route path="reportes" element={<Reportes />} />
            <Route path="configuracion" element={<PrivateRoute roles={['director','admin']}><Configuracion /></PrivateRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
