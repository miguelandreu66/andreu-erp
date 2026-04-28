import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1B3A6B', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: '#1B3A6B', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>🏗️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3A6B' }}>Grupo Andreu</h1>
          <p style={{ fontSize: 14, color: '#888', marginTop: 4 }}>Sistema ERP · Acceso Corporativo</p>
        </div>

        {error && (
          <div className="alert red" style={{ marginBottom: 16 }}>
            <div className="alert-dot" />
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@grupoandreu.mx"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={loading}>
            {loading ? 'Iniciando sesión...' : 'Entrar al sistema'}
          </button>
        </form>

        <p style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 24 }}>
          Grupo Andreu · Sistema interno · Uso exclusivo del personal autorizado
        </p>
      </div>
    </div>
  );
}
