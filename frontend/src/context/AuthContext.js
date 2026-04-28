import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('andreu_token');
    const user = localStorage.getItem('andreu_usuario');
    if (token && user) {
      setUsuario(JSON.parse(user));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    localStorage.setItem('andreu_token', data.token);
    localStorage.setItem('andreu_usuario', JSON.stringify(data.usuario));
    setUsuario(data.usuario);
    return data.usuario;
  };

  const logout = () => {
    localStorage.removeItem('andreu_token');
    localStorage.removeItem('andreu_usuario');
    setUsuario(null);
  };

  const puede = (...roles) => usuario && roles.includes(usuario.rol);

  return (
    <AuthContext.Provider value={{ usuario, login, logout, loading, puede }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
