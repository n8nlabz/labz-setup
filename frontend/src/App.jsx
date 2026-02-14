import { useState, useEffect, useCallback, useRef } from 'react';
import { api, apiUpload, getToken, setToken, clearToken } from './hooks/api.js';

// ─── Styles ───
const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', sans-serif";
const colors = {
  bg: '#07080a', surface: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.06)',
  brand: '#ff6d5a', brandDark: '#ff4444', green: '#22c55e', red: '#ef4444',
  blue: '#0db7ed', purple: '#a78bfa', yellow: '#eab308',
  text: '#fff', textMuted: 'rgba(255,255,255,0.45)', textDim: 'rgba(255,255,255,0.25)',
};

const TOOLS = [
  {
    id: 'portainer_traefik', name: 'Portainer + Traefik', icon: '🐳', color: colors.blue,
    desc: 'Gerenciamento de containers + proxy reverso com SSL automático',
    category: 'Infraestrutura', required: true, time: '~2 min',
    fields: [
      { key: 'domain_portainer', label: 'Domínio Portainer', placeholder: 'portainer.seudominio.com' },
      { key: 'admin_password', label: 'Senha Admin', placeholder: 'Senha forte', type: 'password' },
      { key: 'email_ssl', label: 'Email SSL', placeholder: 'seu@email.com' },
    ],
  },
  {
    id: 'n8n', name: 'n8n + Postgres', icon: '⚡', color: colors.brand,
    desc: 'Automação de workflows com banco PostgreSQL dedicado',
    category: 'Automação', required: false, time: '~3 min',
    fields: [
      { key: 'domain_n8n', label: 'Domínio n8n', placeholder: 'n8n.seudominio.com' },
      { key: 'n8n_user', label: 'Email Admin', placeholder: 'admin@email.com' },
      { key: 'n8n_password', label: 'Senha Admin', placeholder: 'Senha forte', type: 'password' },
    ],
  },
  {
    id: 'evolution', name: 'Evolution API', icon: '📱', color: colors.green,
    desc: 'API para integração com WhatsApp multi-dispositivo',
    category: 'Comunicação', required: false, time: '~2 min',
    fields: [
      { key: 'domain_evolution', label: 'Domínio Evolution', placeholder: 'evolution.seudominio.com' },
      { key: 'evolution_key', label: 'API Key', placeholder: 'Chave de autenticação' },
    ],
  },
];

// ─── Components ───
function StatusBadge({ status }) {
  const ok = status === 'running';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20,
      background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
      fontSize: 11, fontWeight: 600, fontFamily: mono, color: ok ? colors.green : colors.red,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? colors.green : colors.red, animation: ok ? 'pulse 2s infinite' : 'none' }} />
      {ok ? 'Running' : 'Stopped'}
    </span>
  );
}

function Spinner({ size = 14, color = colors.brand }) {
  return <span style={{ display: 'inline-block', width: size, height: size, border: `2px solid ${color}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />;
}

function Btn({ children, onClick, variant = 'primary', disabled, loading, style: s }) {
  const styles = {
    primary: { bg: `linear-gradient(135deg, ${colors.brand}, ${colors.brandDark})`, color: '#fff', border: 'none', shadow: '0 4px 20px rgba(255,68,68,0.2)' },
    ghost: { bg: 'rgba(255,255,255,0.03)', color: colors.textMuted, border: `1px solid ${colors.border}`, shadow: 'none' },
    danger: { bg: 'rgba(239,68,68,0.1)', color: colors.red, border: `1px solid rgba(239,68,68,0.2)`, shadow: 'none' },
    success: { bg: 'rgba(34,197,94,0.1)', color: colors.green, border: `1px solid rgba(34,197,94,0.2)`, shadow: 'none' },
  };
  const v = styles[variant];
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      padding: '8px 18px', borderRadius: 10, background: v.bg, color: v.color,
      border: v.border, fontSize: 12, fontWeight: 600, fontFamily: mono, cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s', opacity: disabled ? 0.5 : 1, boxShadow: v.shadow,
      display: 'inline-flex', alignItems: 'center', gap: 8, ...s,
    }}>
      {loading && <Spinner size={12} color={v.color} />}
      {children}
    </button>
  );
}

function Card({ children, style: s }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.surface, ...s }}>
      {children}
    </div>
  );
}

function Terminal({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  const typeColor = { error: colors.red, success: colors.green, info: colors.brand, default: 'rgba(255,255,255,0.5)' };
  return (
    <Card style={{ padding: 16, maxHeight: 220, overflowY: 'auto', fontFamily: mono, fontSize: 12 }} ref={ref}>
      <div ref={ref} style={{ maxHeight: 190, overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ffbd2e' }} />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#28c840' }} />
        </div>
        {logs.map((l, i) => (
          <div key={i} style={{ color: typeColor[l.type] || typeColor.default, marginBottom: 3, lineHeight: 1.7 }}>
            <span style={{ color: 'rgba(255,255,255,0.15)', marginRight: 8 }}>{l.time}</span>{l.text}
          </div>
        ))}
        <span style={{ color: 'rgba(255,255,255,0.2)', animation: 'pulse 1s infinite' }}>█</span>
      </div>
    </Card>
  );
}

// ─── Login Page ───
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    api('/auth/check').then((d) => {
      if (d.valid) onLogin();
      else { clearToken(); setLoading(false); }
    }).catch(() => { clearToken(); setLoading(false); });
  }, []);

  const handleLogin = async () => {
    if (!email || !password) { setError('Preencha email e senha'); return; }
    setError('');
    setSubmitting(true);
    try {
      const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (d.token) { setToken(d.token); onLogin(); }
      else setError('Credenciais inválidas');
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={32} /></div>;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg }}>
      <div style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: mono, background: `linear-gradient(135deg, ${colors.brand}, ${colors.brandDark})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            N8N LABZ
          </div>
          <div style={{ fontSize: 11, color: colors.textDim, fontFamily: mono, letterSpacing: '0.15em', marginTop: 6 }}>
            SETUP PANEL v1.0
          </div>
        </div>

        <Card style={{ padding: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Acesso ao Painel</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
            Entre com seu email e senha de administrador.
          </p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@email.com" type="email"
            style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 14, fontFamily: mono, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" type="password"
            style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 14, fontFamily: mono, outline: 'none', marginBottom: 16, boxSizing: 'border-box' }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
          <Btn onClick={handleLogin} loading={submitting} disabled={submitting} style={{ width: '100%', padding: '14px', justifyContent: 'center' }}>
            Entrar
          </Btn>
          {error && <p style={{ color: colors.red, fontSize: 12, marginTop: 12, textAlign: 'center' }}>{error}</p>}
        </Card>
      </div>
    </div>
  );
}

// ─── Install Page ───
function InstallPage() {
  const [selected, setSelected] = useState(['portainer_traefik']);
  const [formData, setFormData] = useState({});
  const [installing, setInstalling] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [logs, setLogs] = useState([{ time: '--:--:--', text: 'N8N LABZ Setup pronto.', type: 'info' }]);
  const [domainBase, setDomainBase] = useState(null);

  useEffect(() => {
    api('/install/status').then((d) => setInstalled(d.installed || [])).catch(() => {});
    api('/install/suggestions').then((suggestions) => {
      if (suggestions && suggestions.domain_portainer) {
        setDomainBase(true);
        setFormData((prev) => {
          const merged = { ...prev };
          Object.keys(suggestions).forEach((key) => {
            if (!merged[key]) merged[key] = suggestions[key];
          });
          return merged;
        });
      }
    }).catch(() => {});
  }, []);

  const toggle = (id) => {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  };

  const addLog = (text, type = 'default') => {
    setLogs((p) => [...p, { text, type, time: new Date().toLocaleTimeString('pt-BR', { hour12: false }).slice(0, 8) }]);
  };

  const install = async () => {
    const toInstall = selected.filter((id) => !installed.includes(id));
    if (!toInstall.length) { addLog('Todas as ferramentas já estão instaladas.', 'info'); return; }

    for (const toolId of toInstall) {
      const tool = TOOLS.find((t) => t.id === toolId);
      setInstalling(toolId);
      addLog(`📦 Instalando ${tool.name}...`, 'info');

      try {
        const config = {};
        tool.fields.forEach((f) => { config[f.key] = formData[f.key] || ''; });
        const result = await api(`/install/${toolId}`, { method: 'POST', body: JSON.stringify(config) });

        if (result.logs) result.logs.forEach((l) => addLog(l.text, l.type));
        if (result.success) {
          setInstalled((p) => [...p, toolId]);
          addLog(`✅ ${tool.name} instalado!`, 'success');
        } else {
          addLog(`❌ Falha: ${result.error}`, 'error');
        }
      } catch (e) {
        addLog(`❌ Erro: ${e.message}`, 'error');
      }
    }
    setInstalling(null);
  };

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>Instalar Ferramentas</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>
        Selecione, configure e instale com 1 clique.
        {domainBase && <span style={{ display: 'block', fontSize: 11, color: colors.green, marginTop: 6, fontFamily: mono }}>Subdomínios pré-preenchidos com base no seu domínio.</span>}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        {TOOLS.map((tool) => {
          const active = selected.includes(tool.id) || tool.required;
          const isInstalled = installed.includes(tool.id);
          return (
            <Card key={tool.id} style={{ opacity: isInstalled ? 0.6 : 1, position: 'relative', overflow: 'hidden', border: `1px solid ${active ? tool.color + '30' : colors.border}`, background: active ? tool.color + '05' : colors.surface }}>
              {isInstalled && <div style={{ position: 'absolute', top: 12, right: 16, fontSize: 11, fontFamily: mono, color: colors.green, fontWeight: 600 }}>✅ Instalado</div>}
              <div onClick={() => !tool.required && !isInstalled && toggle(tool.id)} style={{ padding: '18px 22px 14px', display: 'flex', alignItems: 'center', gap: 14, cursor: tool.required || isInstalled ? 'default' : 'pointer' }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: tool.color + '12', border: `1px solid ${tool.color}25` }}>
                  {tool.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: active ? '#fff' : colors.textMuted, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {tool.name}
                    {tool.required && <span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 8, background: tool.color + '18', color: tool.color, fontWeight: 700, letterSpacing: '0.1em' }}>OBRIGATÓRIO</span>}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textDim, marginTop: 3 }}>{tool.desc}</div>
                </div>
                {!isInstalled && (
                  <div style={{ width: 40, height: 22, borderRadius: 11, background: active ? tool.color : 'rgba(255,255,255,0.08)', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: active ? 21 : 3, transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                  </div>
                )}
              </div>
              {active && !isInstalled && (
                <div style={{ padding: '0 22px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {tool.fields.map((f) => (
                    <div key={f.key}>
                      <label style={{ fontSize: 9, fontWeight: 600, color: colors.textDim, fontFamily: mono, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{f.label}</label>
                      <input type={f.type || 'text'} placeholder={f.placeholder} value={formData[f.key] || ''} onChange={(e) => setFormData((p) => ({ ...p, [f.key]: e.target.value }))}
                        style={{ width: '100%', padding: '9px 13px', borderRadius: 9, border: `1px solid rgba(255,255,255,0.07)`, background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 13, fontFamily: mono, outline: 'none' }}
                        onFocus={(e) => e.target.style.borderColor = tool.color + '50'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.07)'} />
                    </div>
                  ))}
                </div>
              )}
              {installing === tool.id && (
                <div style={{ padding: '0 22px 16px' }}>
                  <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: tool.color, borderRadius: 2, animation: 'progressBar 3s ease-in-out infinite' }} />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Btn onClick={install} disabled={!!installing} loading={!!installing} style={{ width: '100%', padding: '15px', justifyContent: 'center', fontSize: 14, letterSpacing: '0.05em' }}>
        {installing ? 'Instalando...' : '🚀 Iniciar Instalação'}
      </Btn>

      <div style={{ marginTop: 20 }}><Terminal logs={logs} /></div>
    </div>
  );
}

// ─── Monitor Page ───
function MonitorPage() {
  const [containers, setContainers] = useState([]);
  const [sysInfo, setSysInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [cData, sData] = await Promise.all([api('/containers'), api('/system/info')]);
      setContainers(cData.containers || []);
      setSysInfo(sData);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 15000); return () => clearInterval(i); }, [refresh]);

  const action = async (id, act) => {
    setActionLoading(`${id}_${act}`);
    try { await api(`/containers/${id}/${act}`, { method: 'POST' }); await refresh(); } catch {}
    setActionLoading(null);
  };

  const running = containers.filter((c) => c.state === 'running').length;
  const toolColors = { n8n: colors.brand, evolution: colors.green, traefik: colors.blue, portainer: colors.blue, postgres: colors.purple, redis: colors.red, other: colors.textMuted };

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={28} /></div>;

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Monitoramento</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>Status em tempo real dos containers.</p>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'Containers', value: containers.length, color: colors.blue },
          { label: 'Running', value: running, color: colors.green },
          { label: 'RAM VPS', value: sysInfo ? `${sysInfo.ram_used_mb}/${sysInfo.ram_total_mb} MB` : '—', color: colors.brand },
          { label: 'Disco', value: sysInfo?.disk_percentage || '—', color: colors.purple },
        ].map((s, i) => (
          <Card key={i} style={{ padding: 18 }}>
            <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: mono, color: s.color }}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 1fr 1fr', padding: '11px 18px', borderBottom: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.02)' }}>
          {['Container', 'Status', 'CPU', 'RAM', 'Ações'].map((h) => (
            <span key={h} style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, textAlign: h === 'Ações' ? 'right' : 'left' }}>{h}</span>
          ))}
        </div>
        {containers.map((c, i) => (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 1fr 1fr', padding: '12px 18px', alignItems: 'center', borderBottom: `1px solid rgba(255,255,255,0.03)`, background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 3, height: 26, borderRadius: 2, background: toolColors[c.tool] || colors.textMuted }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: '#fff' }}>{c.name.slice(0, 35)}</div>
                <div style={{ fontSize: 10, color: colors.textDim, fontFamily: mono }}>{c.image.slice(0, 40)}</div>
              </div>
            </div>
            <StatusBadge status={c.state} />
            <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: mono }}>{c.cpu}</span>
            <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: mono }}>{c.ram?.split('/')[0] || '—'}</span>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {c.state === 'running' ? (
                <Btn variant="danger" onClick={() => action(c.id, 'stop')} loading={actionLoading === `${c.id}_stop`} style={{ padding: '5px 12px', fontSize: 10 }}>Stop</Btn>
              ) : (
                <Btn variant="success" onClick={() => action(c.id, 'start')} loading={actionLoading === `${c.id}_start`} style={{ padding: '5px 12px', fontSize: 10 }}>Start</Btn>
              )}
              <Btn variant="ghost" onClick={() => action(c.id, 'restart')} loading={actionLoading === `${c.id}_restart`} style={{ padding: '5px 12px', fontSize: 10 }}>Restart</Btn>
            </div>
          </div>
        ))}
        {containers.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: colors.textDim, fontSize: 14 }}>Nenhum container encontrado</div>}
      </Card>
    </div>
  );
}

// ─── Backup Page ───
function BackupPage() {
  const [backups, setBackups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    try { const d = await api('/backup'); setBackups(d.backups || []); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setCreating(true); setMsg(null);
    try {
      const d = await api('/backup/create', { method: 'POST' });
      setMsg({ type: 'success', text: `Backup criado: ${d.filename} (${d.sizeFormatted})` });
      refresh();
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setCreating(false);
  };

  const restore = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRestoring(true); setMsg(null);
    try {
      const d = await apiUpload('/backup/restore', file);
      setMsg({ type: 'success', text: `Restaurado! ${d.workflows} workflows importados.` });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setRestoring(false);
    e.target.value = '';
  };

  const download = (filename) => {
    const token = getToken();
    window.open(`/api/backup/download/${filename}?token=${token}`, '_blank');
  };

  const del = async (filename) => {
    try { await api(`/backup/${filename}`, { method: 'DELETE' }); refresh(); } catch {}
  };

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Backup & Restore</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>Gerencie backups dos workflows e credenciais do n8n.</p>

      {msg && (
        <div style={{ padding: '12px 18px', borderRadius: 10, marginBottom: 20, background: msg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, color: msg.type === 'success' ? colors.green : colors.red, fontSize: 13, fontFamily: mono }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 28 }}>
        <Card style={{ padding: 26 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>📦</div>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Criar Backup</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18, lineHeight: 1.6 }}>Exporta workflows e credenciais do n8n</p>
          <Btn onClick={create} loading={creating} disabled={creating}>🔽 Gerar Backup</Btn>
        </Card>

        <Card style={{ padding: 26 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🔄</div>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Restaurar Backup</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18, lineHeight: 1.6 }}>Importa de um arquivo .tar.gz</p>
          <input type="file" ref={fileRef} accept=".tar.gz,.tgz" onChange={restore} style={{ display: 'none' }} />
          <Btn variant="success" onClick={() => fileRef.current?.click()} loading={restoring} disabled={restoring}>🔼 Enviar Backup</Btn>
        </Card>
      </div>

      <Card>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: mono, color: colors.textMuted }}>Histórico</span>
        </div>
        {backups.map((b, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
            <div>
              <div style={{ fontSize: 13, fontFamily: mono, color: '#fff' }}>{b.filename}</div>
              <div style={{ fontSize: 11, color: colors.textDim }}>{b.sizeFormatted} · {new Date(b.date).toLocaleString('pt-BR')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" onClick={() => download(b.filename)} style={{ padding: '5px 12px', fontSize: 10 }}>Download</Btn>
              <Btn variant="danger" onClick={() => del(b.filename)} style={{ padding: '5px 12px', fontSize: 10 }}>Deletar</Btn>
            </div>
          </div>
        ))}
        {backups.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: colors.textDim, fontSize: 13 }}>Nenhum backup encontrado</div>}
      </Card>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [view, setView] = useState('install');
  const [sysInfo, setSysInfo] = useState(null);

  useEffect(() => {
    if (authed) {
      api('/system/info').then(setSysInfo).catch(() => {});
      const i = setInterval(() => { api('/system/info').then(setSysInfo).catch(() => {}); }, 30000);
      return () => clearInterval(i);
    }
  }, [authed]);

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const nav = [
    { id: 'install', label: 'Instalar', icon: '⚙️' },
    { id: 'monitor', label: 'Monitorar', icon: '📊' },
    { id: 'backup', label: 'Backup', icon: '💾' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: colors.bg }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes progressBar { 0% { width:5%; } 50% { width:70%; } 100% { width:95%; } }
      `}</style>

      {/* Sidebar */}
      <aside style={{ width: 240, padding: '26px 18px', borderRight: `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 36, padding: '0 8px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: mono, background: `linear-gradient(135deg, ${colors.brand}, ${colors.brandDark})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>N8N LABZ</div>
          <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.15em', marginTop: 4 }}>SETUP PANEL v1.0</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {nav.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 10,
              border: 'none', background: view === n.id ? 'rgba(255,109,90,0.08)' : 'transparent',
              color: view === n.id ? colors.brand : colors.textMuted, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: sans, textAlign: 'left',
              borderLeft: view === n.id ? `2px solid ${colors.brand}` : '2px solid transparent',
              transition: 'all 0.2s',
            }}>
              <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>

        {/* Server info */}
        <div style={{ marginTop: 'auto' }}>
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', marginBottom: 8 }}>SERVIDOR</div>
            {sysInfo ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>IP</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: colors.brand }}>{sysInfo.ip}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>RAM</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: colors.brand }}>{sysInfo.ram_used_mb}/{sysInfo.ram_total_mb} MB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>Disco</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: colors.purple }}>{sysInfo.disk_used}/{sysInfo.disk_total}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>Containers</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: colors.green }}>{sysInfo.containers_running}/{sysInfo.containers_total}</span>
                </div>
              </>
            ) : <Spinner size={14} />}
          </Card>

          <button onClick={() => { clearToken(); setAuthed(false); }} style={{
            width: '100%', marginTop: 12, padding: '10px', borderRadius: 8, border: `1px solid ${colors.border}`,
            background: 'transparent', color: colors.textDim, fontSize: 11, fontFamily: mono, cursor: 'pointer',
          }}>
            🚪 Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '30px 36px', overflowY: 'auto' }}>
        {view === 'install' && <InstallPage />}
        {view === 'monitor' && <MonitorPage />}
        {view === 'backup' && <BackupPage />}
      </main>
    </div>
  );
}
