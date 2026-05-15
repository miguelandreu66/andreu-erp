import React, { useState, useEffect, useCallback } from 'react';
import { api, fileUrl } from '../api';
import { useAuth } from '../context/AuthContext';

const TIPOS_DOC = {
  licencia_federal:        { label: 'Licencia federal',           icon: '🪪', critico: true },
  examen_medico:           { label: 'Examen médico',              icon: '🩺', critico: true },
  ine:                     { label: 'INE',                        icon: '🪪' },
  curp:                    { label: 'CURP',                       icon: '📋' },
  rfc:                     { label: 'RFC',                        icon: '🧾' },
  comprobante_domicilio:   { label: 'Comprobante de domicilio',   icon: '🏠' },
  antecedentes_no_penales: { label: 'Antecedentes no penales',    icon: '📜' },
  contrato_laboral:        { label: 'Contrato laboral',           icon: '📄' },
  foto_perfil:             { label: 'Foto de perfil',             icon: '📸' },
  capacitacion:            { label: 'Capacitación',               icon: '🎓' },
  otro:                    { label: 'Otro',                       icon: '📄' },
};

const COLOR_VIGENCIA = {
  vigente:      { bg: '#dcfce7', txt: '#166534', label: '✓ Vigente' },
  por_vencer:   { bg: '#fef3c7', txt: '#92400e', label: '⚠️ Por vencer' },
  vencido:      { bg: '#fee2e2', txt: '#991b1b', label: '❌ VENCIDO' },
  sin_vigencia: { bg: '#f3f4f6', txt: '#6b7280', label: 'Sin vigencia' },
};

export default function Operadores() {
  const { usuario } = useAuth();
  const puedeEditar = ['director','admin','logistica'].includes(usuario?.rol);
  const esDirector = usuario?.rol === 'director';

  const [operadores, setOperadores] = useState([]);
  const [docCounts, setDocCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ nombre: '', telefono: '', licencia: '' });
  const [guardando, setGuardando] = useState(false);
  const [opAbierto, setOpAbierto] = useState(null);
  const [creandoAcceso, setCreandoAcceso] = useState(null); // operador para crear acceso

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const ops = await api.operadores();
      setOperadores(ops || []);
      const counts = {};
      await Promise.all((ops || []).map(async o => {
        try {
          const docs = await api.opDocsListar(o.id);
          counts[o.id] = {
            total: docs.length,
            vencidos: docs.filter(d => d.estado_vigencia === 'vencido').length,
            por_vencer: docs.filter(d => d.estado_vigencia === 'por_vencer').length,
          };
        } catch (_) { counts[o.id] = { total: 0, vencidos: 0, por_vencer: 0 }; }
      }));
      setDocCounts(counts);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarOperador = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setMsg({ tipo: 'red', txt: 'Nombre obligatorio' }); return; }
    setGuardando(true);
    try {
      await api.crearOperador({
        nombre: form.nombre.trim(),
        telefono: form.telefono.trim() || null,
        licencia: form.licencia.trim() || null,
      });
      setMsg({ tipo: 'green', txt: `✓ ${form.nombre} registrado` });
      setForm({ nombre: '', telefono: '', licencia: '' });
      await cargar();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>👤 Operadores — Andreu Logistics</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Da de alta operadores con licencia federal, examen médico y demás documentos
          </p>
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', textAlign: 'right' }}>
          <strong style={{ fontSize: 22, color: '#1B3A6B' }}>{operadores.length}</strong> operador(es)
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}>
          <div className="alert-dot" />
          <div>{msg.txt}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20, alignItems: 'start' }}>

        <div>
          {loading ? (
            <div className="empty">Cargando operadores...</div>
          ) : operadores.length === 0 ? (
            <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
              <h3 style={{ margin: '0 0 8px', color: '#374151' }}>Aún no tienes operadores</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
                Empieza dando de alta tu primer operador con el formulario de la derecha.
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12 }}>
                Después podrás subir su licencia federal, examen médico, INE y demás documentos.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {operadores.map(o => (
                <OperadorCard
                  key={o.id}
                  operador={o}
                  docCount={docCounts[o.id] || { total: 0, vencidos: 0, por_vencer: 0 }}
                  onOpenDocs={() => setOpAbierto(o)}
                  onCrearAcceso={esDirector ? () => setCreandoAcceso(o) : null}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          {puedeEditar ? (
            <FormularioNuevoOperador form={form} setForm={setForm} onSubmit={guardarOperador} guardando={guardando} />
          ) : (
            <div style={{ background: '#fef3c7', border: '1px solid #d97706', borderRadius: 10, padding: 16, fontSize: 13, color: '#78350f' }}>
              ⚠️ Tu rol no permite crear operadores.
            </div>
          )}

          {operadores.length > 0 && (
            <ResumenOperadores operadores={operadores} docCounts={docCounts} />
          )}
        </div>
      </div>

      {opAbierto && (
        <ModalDocumentosOp
          operador={opAbierto}
          puedeEditar={puedeEditar}
          onClose={() => { setOpAbierto(null); cargar(); }}
        />
      )}

      {creandoAcceso && (
        <ModalCrearAcceso
          operador={creandoAcceso}
          onClose={() => setCreandoAcceso(null)}
          onCreado={() => { setCreandoAcceso(null); setMsg({ tipo: 'green', txt: `✓ Acceso creado para ${creandoAcceso.nombre}` }); }}
        />
      )}
    </div>
  );
}

function ModalCrearAcceso({ operador, onClose, onCreado }) {
  const [email, setEmail] = useState(() =>
    `${operador.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@andreu-logistics.com`
  );
  const [password, setPassword] = useState('Andreu2026!');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [exitoso, setExitoso] = useState(null);

  const crear = async () => {
    setError(null);
    setGuardando(true);
    try {
      const r = await api.opCrearAcceso(operador.id, email.trim(), password);
      setExitoso(r);
    } catch (e) {
      setError(e.message);
    } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 480, width: '100%',
        padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>🔑 Crear acceso de usuario</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Para {operador.nombre}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        {!exitoso ? (
          <>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 16 }}>
              Esto crea un usuario con rol <strong>operador</strong> vinculado a este perfil. El operador podrá entrar a <code>/movil</code> con estas credenciales.
            </p>

            <div className="form-group">
              <label className="form-label">Email (login)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Contraseña temporal</label>
              <input type="text" value={password} onChange={e => setPassword(e.target.value)}
                style={{ fontFamily: 'ui-monospace, "SF Mono", monospace' }} />
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                Diéle al operador que la cambie desde Configuración cuando entre.
              </div>
            </div>

            {error && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={crear} disabled={guardando || !email || !password} className="btn btn-primary">
                {guardando ? 'Creando...' : 'Crear acceso'}
              </button>
              <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
            </div>
          </>
        ) : (
          <div>
            <div style={{ background: '#dcfce7', color: '#166534', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              ✅ Usuario <strong>{exitoso.usuario.nombre}</strong> creado.
            </div>
            <div style={{ background: '#f0f9ff', border: '1px solid #1B3A6B', borderRadius: 10, padding: 16, marginBottom: 12, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📋 Cópiale esto al operador por WhatsApp:</div>
              <div style={{ background: '#fff', padding: 12, borderRadius: 6, fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
{`Hola ${operador.nombre}, te paso tu acceso a la app:

🔗 https://perfect-simplicity-production.up.railway.app/movil

📧 ${exitoso.usuario.email}
🔒 ${password}

Cómo instalarla:
1. Abre el link en Chrome
2. Login con email y contraseña arriba
3. Menú → "Agregar a pantalla de inicio"
4. Listo, queda como app

Al subir al camión: abre la app, escoge tu unidad, activa Auto-GPS.`}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(
                  `Hola ${operador.nombre}, te paso tu acceso a la app:\n\n🔗 https://perfect-simplicity-production.up.railway.app/movil\n\n📧 ${exitoso.usuario.email}\n🔒 ${password}\n\nCómo instalarla:\n1. Abre el link en Chrome\n2. Login con email y contraseña arriba\n3. Menú → "Agregar a pantalla de inicio"\n4. Listo, queda como app\n\nAl subir al camión: abre la app, escoge tu unidad, activa Auto-GPS.`
                )}
                className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                📋 Copiar mensaje al portapapeles
              </button>
            </div>
            <button onClick={onCreado} className="btn btn-primary btn-block">Listo</button>
          </div>
        )}
      </div>
    </div>
  );
}

function OperadorCard({ operador, docCount, onOpenDocs, onCrearAcceso }) {
  const tieneVencidos = docCount.vencidos > 0;
  const tienePorVencer = docCount.por_vencer > 0;
  const colorIzq = tieneVencidos ? '#dc2626' : tienePorVencer ? '#d97706' : operador.activo === false ? '#9ca3af' : '#16a34a';

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${colorIzq}`,
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{operador.nombre}</span>
            {operador.activo === false && (
              <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>Inactivo</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
            {operador.telefono && <>📞 {operador.telefono}</>}
            {operador.licencia && operador.telefono && ' · '}
            {operador.licencia && <>🪪 Lic. {operador.licencia}</>}
            {!operador.telefono && !operador.licencia && <em style={{ color: '#9ca3af' }}>Sin teléfono ni licencia capturados</em>}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              onClick={onOpenDocs}
              style={{
                padding: '6px 12px',
                background: tieneVencidos ? '#fee2e2' : tienePorVencer ? '#fef3c7' : '#f3f4f6',
                color: tieneVencidos ? '#991b1b' : tienePorVencer ? '#92400e' : '#374151',
                border: '1px solid', borderColor: tieneVencidos ? '#dc2626' : tienePorVencer ? '#d97706' : '#d1d5db',
                borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              📋 Documentos ({docCount.total})
              {tieneVencidos && <span> · {docCount.vencidos} vencido(s)</span>}
              {tienePorVencer && !tieneVencidos && <span> · {docCount.por_vencer} por vencer</span>}
            </button>
            {onCrearAcceso && (
              <button
                onClick={onCrearAcceso}
                style={{
                  padding: '6px 12px', background: '#1B3A6B', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
                title="Crear cuenta de usuario para que entre al modo móvil"
              >
                🔑 Crear acceso móvil
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormularioNuevoOperador({ form, setForm, onSubmit, guardando }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, position: 'sticky', top: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>➕ Nuevo operador</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>Director / Admin / Coordinador</p>

      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label className="form-label">Nombre completo *</label>
          <input type="text" placeholder="Juan Pérez García" value={form.nombre}
            onChange={e => setForm({ ...form, nombre: e.target.value })} required />
        </div>
        <div className="form-group">
          <label className="form-label">Teléfono</label>
          <input type="tel" placeholder="777-123-4567" value={form.telefono}
            onChange={e => setForm({ ...form, telefono: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label"># Licencia federal</label>
          <input type="text" placeholder="A-12345678" value={form.licencia}
            onChange={e => setForm({ ...form, licencia: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
          {guardando ? 'Guardando...' : '➕ Registrar operador'}
        </button>
      </form>

      <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, fontSize: 12, color: '#075985', lineHeight: 1.5 }}>
        💡 <strong>Tip:</strong> Después de crearlo, click en <strong>📋 Documentos</strong> para subir licencia federal y examen médico (la IA te alerta cuando vencen).
      </div>
    </div>
  );
}

function ResumenOperadores({ operadores, docCounts }) {
  const activos = operadores.filter(o => o.activo !== false).length;
  const totalDocs = Object.values(docCounts).reduce((s, c) => s + c.total, 0);
  const docsVencidos = Object.values(docCounts).reduce((s, c) => s + c.vencidos, 0);
  const docsPorVencer = Object.values(docCounts).reduce((s, c) => s + c.por_vencer, 0);

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Resumen
      </div>
      <Row label="Total registrados" value={operadores.length} />
      <Row label="Activos" value={activos} color="#16a34a" />
      <Row label="Documentos en sistema" value={totalDocs} />
      {docsVencidos > 0 && <Row label="🚨 Documentos vencidos" value={docsVencidos} color="#dc2626" />}
      {docsPorVencer > 0 && <Row label="⚠️ Por vencer (30d)" value={docsPorVencer} color="#d97706" />}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span>{label}</span>
      <strong style={{ color: color || '#111' }}>{value}</strong>
    </div>
  );
}

function ModalDocumentosOp({ operador, puedeEditar, onClose }) {
  const [docs, setDocs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const d = await api.opDocsListar(operador.id);
      setDocs(d || []);
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [operador.id]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 800, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: 20, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>📋 Documentos · {operador.nombre}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
              {operador.telefono && <>📞 {operador.telefono}</>}
              {operador.licencia && operador.telefono && ' · '}
              {operador.licencia && <>🪪 Lic. {operador.licencia}</>}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #dc2626', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              ⚠️ {error}
            </div>
          )}

          {puedeEditar && !mostrarForm && (
            <button onClick={() => setMostrarForm(true)} className="btn btn-primary" style={{ marginBottom: 16 }}>
              ➕ Agregar documento
            </button>
          )}

          {mostrarForm && (
            <FormularioSubirDocOp
              operadorId={operador.id}
              onClose={() => setMostrarForm(false)}
              onSaved={() => { setMostrarForm(false); cargar(); }}
            />
          )}

          {cargando ? (
            <div className="empty">Cargando...</div>
          ) : docs.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#6b7280' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
              <p>Aún no hay documentos para {operador.nombre}.</p>
              {puedeEditar && <p style={{ fontSize: 13 }}>Click en "Agregar documento" para empezar con la licencia federal.</p>}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {docs.map(d => <DocItemOp key={d.id} doc={d} puedeEditar={puedeEditar} onDeleted={cargar} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocItemOp({ doc, puedeEditar, onDeleted }) {
  const tipo = TIPOS_DOC[doc.tipo] || TIPOS_DOC.otro;
  const vig = COLOR_VIGENCIA[doc.estado_vigencia] || COLOR_VIGENCIA.sin_vigencia;

  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar "${doc.nombre}"?`)) return;
    try {
      await api.opDocsEliminar(doc.id);
      onDeleted();
    } catch (e) { alert('Error: ' + e.message); }
  };

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18 }}>{tipo.icon}</span>
            <strong style={{ fontSize: 14 }}>{doc.nombre}</strong>
            <span style={{ background: vig.bg, color: vig.txt, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {vig.label}
            </span>
            {tipo.critico && doc.estado_vigencia === 'vencido' && (
              <span style={{ background: '#991b1b', color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                🚨 NO PUEDE OPERAR
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {tipo.label}
            {doc.vigencia_fin && (
              <span>
                {' · '}Vence: {doc.vigencia_fin}
                {doc.dias_restantes != null && (
                  <span style={{ color: doc.dias_restantes < 0 ? '#dc2626' : doc.dias_restantes < 30 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                    {' '}({doc.dias_restantes < 0 ? `vencido hace ${Math.abs(doc.dias_restantes)}d` : `${doc.dias_restantes}d restantes`})
                  </span>
                )}
              </span>
            )}
          </div>
          {doc.notas && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>"{doc.notas}"</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <a
            href={doc.archivo_url || fileUrl(`/operadores/documentos/${doc.id}/archivo`)}
            target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"
          >Ver</a>
          {puedeEditar && (
            <button onClick={eliminar} className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }}>Eliminar</button>
          )}
        </div>
      </div>
    </div>
  );
}

function FormularioSubirDocOp({ operadorId, onClose, onSaved }) {
  const [tipo, setTipo] = useState('licencia_federal');
  const [nombre, setNombre] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [vigenciaInicio, setVigenciaInicio] = useState('');
  const [vigenciaFin, setVigenciaFin] = useState('');
  const [alertarDiasAntes, setAlertarDiasAntes] = useState(30);
  const [notas, setNotas] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!archivo) { setError('Selecciona un archivo'); return; }
    if (archivo.size > 10 * 1024 * 1024) { setError('Archivo demasiado grande (máx 10MB)'); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('tipo', tipo);
      fd.append('nombre', nombre || archivo.name);
      if (vigenciaInicio) fd.append('vigencia_inicio', vigenciaInicio);
      if (vigenciaFin) fd.append('vigencia_fin', vigenciaFin);
      fd.append('alertar_dias_antes', alertarDiasAntes);
      if (notas) fd.append('notas', notas);
      await api.opDocsSubir(operadorId, fd);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubiendo(false); }
  };

  return (
    <div style={{ background: '#fff', border: '2px solid #1B3A6B', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 12px' }}>➕ Subir documento del operador</h4>
      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{error}</div>}
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tipo *</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} required>
              {Object.entries(TIPOS_DOC).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Nombre</label>
            <input type="text" placeholder="(usa el nombre del archivo)" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Archivo * (PDF, JPG, PNG · máx 10MB)</label>
          <input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files[0])} required />
          {archivo && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{archivo.name} · {(archivo.size / 1024).toFixed(0)} KB</div>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Vigencia inicio</label>
            <input type="date" value={vigenciaInicio} onChange={e => setVigenciaInicio(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Vigencia fin (para alertas)</label>
            <input type="date" value={vigenciaFin} onChange={e => setVigenciaFin(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Avisar X días antes</label>
            <input type="number" value={alertarDiasAntes} onChange={e => setAlertarDiasAntes(e.target.value)} min="1" max="365" />
          </div>
          <div className="form-group">
            <label className="form-label">Notas</label>
            <input type="text" placeholder="Opcional" value={notas} onChange={e => setNotas(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={subiendo}>
            {subiendo ? 'Subiendo...' : '⬆️ Subir documento'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </form>
    </div>
  );
}
