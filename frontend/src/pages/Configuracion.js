import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const ROLES = { director:'Director', admin:'Administrador', caja:'Caja / Ventas', logistica:'Logística', monitoreo:'Monitoreo (solo lectura)' };
const ROLES_BADGE = { director:'badge-red', admin:'badge-blue', caja:'badge-green', logistica:'badge-amber', monitoreo:'badge-gray' };

export default function Configuracion() {
  const { usuario } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [tab, setTab] = useState('usuarios');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [formUser, setFormUser] = useState({ nombre: '', email: '', password: '', rol: 'caja' });
  const [formOp, setFormOp] = useState({ nombre: '', telefono: '', licencia: '' });
  const [formPw, setFormPw] = useState({ password_actual: '', password_nueva: '', confirmar: '' });

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    const [u, o] = await Promise.all([api.usuarios(), api.operadores()]);
    setUsuarios(u);
    setOperadores(o);
  };

  const showMsg = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const crearUsuario = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.registro(formUser);
      setFormUser({ nombre: '', email: '', password: '', rol: 'caja' });
      showMsg('✓ Usuario creado');
      cargar();
    } catch (err) { showMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const toggleUsuario = async (id) => {
    await api.toggleUsuario(id);
    cargar();
  };

  const crearOperador = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearOperador(formOp);
      setFormOp({ nombre: '', telefono: '', licencia: '' });
      showMsg('✓ Operador agregado');
      cargar();
    } catch (err) { showMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const cambiarPassword = async (e) => {
    e.preventDefault();
    if (formPw.password_nueva !== formPw.confirmar) { showMsg('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      await api.cambiarPassword({ password_actual: formPw.password_actual, password_nueva: formPw.password_nueva });
      setFormPw({ password_actual: '', password_nueva: '', confirmar: '' });
      showMsg('✓ Contraseña actualizada');
    } catch (err) { showMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div className="page-header"><h2>Configuración</h2><p>Usuarios, operadores y accesos del sistema</p></div>

      {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      <div className="tabs">
        {['usuarios','operadores','password'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'usuarios' ? 'Usuarios del sistema' : t === 'operadores' ? 'Operadores' : 'Mi contraseña'}
          </button>
        ))}
      </div>

      {tab === 'usuarios' && (
        <div>
          <div className="card">
            <div className="card-title">Usuarios activos</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th>{usuario?.rol === 'director' && <th></th>}</tr></thead>
                <tbody>
                  {usuarios.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.nombre}</td>
                      <td className="text-muted">{u.email}</td>
                      <td><span className={`badge ${ROLES_BADGE[u.rol]}`}>{ROLES[u.rol]}</span></td>
                      <td><span className={`badge ${u.activo?'badge-green':'badge-red'}`}>{u.activo?'Activo':'Inactivo'}</span></td>
                      {usuario?.rol === 'director' && (
                        <td>{u.id !== usuario.id && <button className="btn btn-ghost btn-sm" onClick={() => toggleUsuario(u.id)}>{u.activo?'Desactivar':'Activar'}</button>}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Agregar usuario</div>
            <form onSubmit={crearUsuario}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Nombre completo</label>
                  <input type="text" placeholder="Nombre" value={formUser.nombre} onChange={e => setFormUser({...formUser, nombre: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" placeholder="usuario@grupoandreu.mx" value={formUser.email} onChange={e => setFormUser({...formUser, email: e.target.value})} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Contraseña inicial</label>
                  <input type="password" placeholder="••••••••" value={formUser.password} onChange={e => setFormUser({...formUser, password: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Rol</label>
                  <select value={formUser.rol} onChange={e => setFormUser({...formUser, rol: e.target.value})}>
                    {Object.entries(ROLES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ background: '#F4F4F2', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
                <strong>Accesos por rol:</strong>
                <div className="text-muted" style={{ marginTop: 4 }}>
                  Director: todo · Admin: todo excepto eliminar usuarios · Caja: ventas y gastos · Logística: flota e inventario · Monitoreo: solo lectura
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Crear usuario</button>
            </form>
          </div>
        </div>
      )}

      {tab === 'operadores' && (
        <div>
          <div className="card">
            <div className="card-title">Operadores de flota</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nombre</th><th>Teléfono</th><th>Licencia</th><th>Estado</th></tr></thead>
                <tbody>
                  {operadores.map(o => (
                    <tr key={o.id}>
                      <td style={{ fontWeight: 500 }}>{o.nombre}</td>
                      <td>{o.telefono || '—'}</td>
                      <td>{o.licencia || '—'}</td>
                      <td><span className={`badge ${o.activo?'badge-green':'badge-gray'}`}>{o.activo?'Activo':'Inactivo'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-title">Agregar operador</div>
            <form onSubmit={crearOperador}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Nombre</label>
                  <input type="text" placeholder="Nombre del operador" value={formOp.nombre} onChange={e => setFormOp({...formOp, nombre: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input type="text" placeholder="747 000 0000" value={formOp.telefono} onChange={e => setFormOp({...formOp, telefono: e.target.value})} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">No. de licencia</label>
                <input type="text" placeholder="Número de licencia de conducir" value={formOp.licencia} onChange={e => setFormOp({...formOp, licencia: e.target.value})} />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Agregar operador</button>
            </form>
          </div>
        </div>
      )}

      {tab === 'password' && (
        <div className="card">
          <div className="card-title">Cambiar mi contraseña</div>
          <form onSubmit={cambiarPassword}>
            <div className="form-group">
              <label className="form-label">Contraseña actual</label>
              <input type="password" placeholder="••••••••" value={formPw.password_actual} onChange={e => setFormPw({...formPw, password_actual: e.target.value})} required />
            </div>
            <div className="form-group">
              <label className="form-label">Nueva contraseña</label>
              <input type="password" placeholder="••••••••" value={formPw.password_nueva} onChange={e => setFormPw({...formPw, password_nueva: e.target.value})} required />
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar nueva contraseña</label>
              <input type="password" placeholder="••••••••" value={formPw.confirmar} onChange={e => setFormPw({...formPw, confirmar: e.target.value})} required />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Actualizar contraseña</button>
          </form>
        </div>
      )}
    </div>
  );
}
