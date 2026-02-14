import { useState, useEffect, useCallback, useRef } from 'react';
import { api, apiUpload, getToken, setToken, clearToken, connectWebSocket, fetchCredentials } from './hooks/api.js';

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
    id: 'portainer', name: 'Portainer', icon: '🐳', color: colors.blue,
    desc: 'Gerenciamento visual de containers Docker via navegador',
    tooltip: 'O Portainer permite visualizar, criar e gerenciar seus containers, stacks e volumes Docker de forma visual. Ideal para acompanhar deploys e debugar serviços.',
    category: 'Infraestrutura', time: '~2 min',
    fields: [
      { key: 'domain_portainer', label: 'Domínio Portainer', placeholder: 'portainer.seudominio.com' },
      { key: 'admin_password', label: 'Senha Admin', placeholder: 'Gerada automaticamente', type: 'password', autoGenerate: true },
    ],
  },
  {
    id: 'n8n', name: 'n8n', icon: '⚡', color: colors.brand,
    desc: 'Plataforma de automação com workflows visuais',
    tooltip: 'O n8n permite criar automações conectando APIs, bancos de dados e serviços. No modo Simples, roda em 1 container. No modo Avançado (Queue), separa editor, webhook e worker para maior performance.',
    category: 'Automação', time: '~3 min', hasMode: true,
    modes: {
      simple: {
        label: 'Simples', desc: '1 container (ideal para começar)',
        fields: [
          { key: 'domain_n8n', label: 'Domínio n8n', placeholder: 'n8n.seudominio.com' },
        ],
      },
      queue: {
        label: 'Avançado (Queue)', desc: 'Editor + Webhook + Worker + Redis',
        fields: [
          { key: 'domain_n8n', label: 'Domínio Editor', placeholder: 'n8n.seudominio.com' },
          { key: 'domain_webhook', label: 'Domínio Webhook', placeholder: 'webhook.seudominio.com' },
          { key: 'smtp_host', label: 'SMTP Host (opcional)', placeholder: 'smtp.gmail.com' },
          { key: 'smtp_port', label: 'SMTP Porta', placeholder: '587' },
          { key: 'smtp_email', label: 'SMTP Email', placeholder: 'seu@email.com' },
          { key: 'smtp_user', label: 'SMTP Usuário', placeholder: 'seu@email.com' },
          { key: 'smtp_pass', label: 'SMTP Senha', placeholder: 'app password', type: 'password' },
        ],
      },
    },
  },
  {
    id: 'evolution', name: 'Evolution API', icon: '📱', color: colors.green,
    desc: 'API para integração com WhatsApp multi-dispositivo',
    tooltip: 'A Evolution API conecta seu WhatsApp ao n8n e outros serviços. Suporta envio/recebimento de mensagens, gerenciamento de instâncias e webhooks automáticos.',
    category: 'Comunicação', time: '~2 min',
    fields: [
      { key: 'domain_evolution', label: 'Domínio Evolution', placeholder: 'evolution.seudominio.com' },
      { key: 'evolution_key', label: 'API Key (opcional)', placeholder: 'Gerada automaticamente' },
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

function Card({ children, style: s, onClick }) {
  return (
    <div onClick={onClick} style={{ borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.surface, ...s }}>
      {children}
    </div>
  );
}

function Terminal({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  const typeColor = { error: colors.red, success: colors.green, info: colors.brand, default: 'rgba(255,255,255,0.5)' };
  return (
    <Card style={{ padding: 16, fontFamily: mono, fontSize: 12 }}>
      <div ref={ref} style={{ maxHeight: 220, overflowY: 'auto' }}>
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

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a2e', border: `1px solid ${colors.border}`, borderRadius: 10,
          padding: '10px 14px', fontSize: 11, color: colors.textMuted, lineHeight: 1.6,
          width: 260, zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} style={{
      padding: '3px 8px', borderRadius: 6, border: `1px solid ${colors.border}`,
      background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
      color: copied ? colors.green : colors.textMuted, fontSize: 10, fontFamily: mono,
      cursor: 'pointer', transition: 'all 0.2s',
    }}>
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
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
            SETUP PANEL v2.0
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

// ─── Dashboard Page ───
function DashboardPage() {
  const [sysInfo, setSysInfo] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [sys, status, cData] = await Promise.all([
        api('/system/info'),
        api('/install/status'),
        api('/containers'),
      ]);
      setSysInfo(sys);
      setInstalled(status.installed || []);
      setContainers(cData.containers || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 15000); return () => clearInterval(i); }, [refresh]);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={28} /></div>;

  const running = containers.filter((c) => c.state === 'running').length;
  const ramPerc = sysInfo ? Math.round((sysInfo.ram_used_mb / sysInfo.ram_total_mb) * 100) : 0;

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Dashboard</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>Visão geral do seu servidor.</p>

      {/* Server Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'IP do Servidor', value: sysInfo?.ip || '---', color: colors.brand },
          { label: 'RAM', value: sysInfo ? `${sysInfo.ram_used_mb}/${sysInfo.ram_total_mb} MB` : '---', sub: `${ramPerc}% em uso`, color: colors.purple },
          { label: 'Disco', value: sysInfo ? `${sysInfo.disk_used}/${sysInfo.disk_total}` : '---', sub: sysInfo?.disk_percentage || '', color: colors.yellow },
          { label: 'Containers', value: `${running}/${containers.length}`, sub: 'ativos', color: colors.green },
        ].map((s, i) => (
          <Card key={i} style={{ padding: 18 }}>
            <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color: s.color }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 10, color: colors.textDim, fontFamily: mono, marginTop: 2 }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Installed Tools */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Ferramentas Instaladas</h2>
      {installed.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>👋</div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Bem-vindo ao N8N LABZ!</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
            Nenhuma ferramenta instalada ainda. Vá para a aba <strong>Instalar</strong> para começar.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {installed.map((toolId) => {
            const tool = TOOLS.find((t) => t.id === toolId);
            if (!tool) return null;
            const toolContainers = containers.filter((c) => {
              const n = c.name.toLowerCase();
              if (toolId === 'portainer') return n.includes('portainer_portainer') || n.includes('portainer_agent');
              if (toolId === 'n8n') return n.includes('n8n_') && !n.includes('n8nlabz');
              if (toolId === 'evolution') return n.includes('evolution_');
              return false;
            });
            const allRunning = toolContainers.length > 0 && toolContainers.every((c) => c.state === 'running');
            return (
              <Card key={toolId} style={{ padding: 20, borderColor: tool.color + '20' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: tool.color + '12', border: `1px solid ${tool.color}25` }}>
                    {tool.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: mono }}>{tool.name}</div>
                    <StatusBadge status={allRunning ? 'running' : 'stopped'} />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: colors.textDim, fontFamily: mono }}>
                  {toolContainers.length} container{toolContainers.length !== 1 ? 's' : ''}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Install Page ───
function InstallPage() {
  const [installed, setInstalled] = useState([]);
  const [formData, setFormData] = useState({});
  const [installing, setInstalling] = useState(null);
  const [logs, setLogs] = useState([{ time: '--:--:--', text: 'N8N LABZ Setup pronto.', type: 'info' }]);
  const [domainBase, setDomainBase] = useState(null);
  const [modal, setModal] = useState(null);
  const [n8nMode, setN8nMode] = useState('simple');
  const [resultCreds, setResultCreds] = useState(null);

  useEffect(() => {
    api('/install/status').then((d) => setInstalled(d.installed || [])).catch(() => {});
    api('/install/suggestions').then((suggestions) => {
      if (suggestions && suggestions.domain_n8n) {
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

  useEffect(() => {
    const cleanup = connectWebSocket((msg) => {
      if (msg.type === 'install_log') {
        addLog(msg.text, msg.type);
      }
    });
    return cleanup;
  }, []);

  const addLog = (text, type = 'default') => {
    setLogs((p) => [...p, { text, type, time: new Date().toLocaleTimeString('pt-BR', { hour12: false }).slice(0, 8) }]);
  };

  const openModal = (tool) => {
    if (installed.includes(tool.id)) return;
    setModal(tool);
    setResultCreds(null);
  };

  const install = async () => {
    if (!modal) return;
    const tool = modal;
    setInstalling(tool.id);
    setModal(null);
    addLog(`Instalando ${tool.name}...`, 'info');

    try {
      const config = { ...formData };
      if (tool.hasMode) config.n8n_mode = n8nMode;

      const result = await api(`/install/${tool.id}`, { method: 'POST', body: JSON.stringify(config) });
      if (result.logs) result.logs.forEach((l) => addLog(l.text, l.type));
      if (result.success) {
        setInstalled((p) => [...p, tool.id]);
        addLog(`${tool.name} instalado com sucesso!`, 'success');
        if (result.credentials) setResultCreds({ tool: tool.name, ...result.credentials });
      } else {
        addLog(`Falha: ${result.error}`, 'error');
      }
    } catch (e) {
      addLog(`Erro: ${e.message}`, 'error');
    }
    setInstalling(null);
  };

  const uninstall = async (toolId) => {
    if (!confirm('Tem certeza que deseja desinstalar? Os dados serão perdidos.')) return;
    addLog(`Desinstalando ${toolId}...`, 'info');
    try {
      await api(`/install/${toolId}`, { method: 'DELETE' });
      setInstalled((p) => p.filter((x) => x !== toolId));
      addLog(`${toolId} desinstalado.`, 'success');
    } catch (e) {
      addLog(`Erro: ${e.message}`, 'error');
    }
  };

  const getFields = (tool) => {
    if (tool.hasMode) {
      return tool.modes[n8nMode]?.fields || [];
    }
    return tool.fields || [];
  };

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Instalar Ferramentas</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>
        Clique em uma ferramenta para configurar e instalar.
        {domainBase && <span style={{ display: 'block', fontSize: 11, color: colors.green, marginTop: 6, fontFamily: mono }}>Subdomínios pré-preenchidos com base no seu domínio.</span>}
      </p>

      {/* Tool Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        {TOOLS.map((tool) => {
          const isInstalled = installed.includes(tool.id);
          const isInstalling = installing === tool.id;
          return (
            <Card key={tool.id} onClick={() => !isInstalling && openModal(tool)}
              style={{
                padding: 22, cursor: isInstalling ? 'wait' : 'pointer', position: 'relative',
                opacity: isInstalling ? 0.7 : 1, transition: 'all 0.2s',
                borderColor: isInstalled ? colors.green + '30' : isInstalling ? tool.color + '40' : colors.border,
                background: isInstalled ? 'rgba(34,197,94,0.03)' : colors.surface,
              }}>
              {isInstalled && <div style={{ position: 'absolute', top: 12, right: 14, fontSize: 10, fontFamily: mono, color: colors.green, fontWeight: 600 }}>Instalado</div>}
              {isInstalling && <div style={{ position: 'absolute', top: 12, right: 14 }}><Spinner size={14} color={tool.color} /></div>}
              <div style={{ width: 44, height: 44, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: tool.color + '12', border: `1px solid ${tool.color}25`, marginBottom: 14 }}>
                {tool.icon}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, fontFamily: mono, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {tool.name}
                {tool.tooltip && (
                  <Tooltip text={tool.tooltip}>
                    <span style={{ fontSize: 12, color: colors.textDim, cursor: 'help' }}>?</span>
                  </Tooltip>
                )}
              </div>
              <div style={{ fontSize: 12, color: colors.textDim, lineHeight: 1.5 }}>{tool.desc}</div>
              <div style={{ fontSize: 10, color: colors.textDim, fontFamily: mono, marginTop: 8 }}>{tool.time}</div>
              {isInstalling && (
                <div style={{ marginTop: 12, width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: tool.color, borderRadius: 2, animation: 'progressBar 3s ease-in-out infinite' }} />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Config Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <Card style={{ width: 480, padding: 28, background: '#0d0e12', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: modal.color + '12', border: `1px solid ${modal.color}25` }}>
                {modal.icon}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {installed.includes(modal.id) ? 'Gerenciar' : 'Instalar'} {modal.name}
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>{modal.desc}</div>
              </div>
            </div>

            {installed.includes(modal.id) ? (
              <div>
                <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>Esta ferramenta já está instalada.</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn variant="danger" onClick={() => { uninstall(modal.id); setModal(null); }}>Desinstalar</Btn>
                  <Btn variant="ghost" onClick={() => setModal(null)}>Fechar</Btn>
                </div>
              </div>
            ) : (
              <>
                {/* n8n Mode Selector */}
                {modal.hasMode && (
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 9, fontWeight: 600, color: colors.textDim, fontFamily: mono, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Modo de instalação</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {Object.entries(modal.modes).map(([key, mode]) => (
                        <div key={key} onClick={() => setN8nMode(key)} style={{
                          padding: '12px 14px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                          border: `1px solid ${n8nMode === key ? modal.color + '50' : colors.border}`,
                          background: n8nMode === key ? modal.color + '08' : 'transparent',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: n8nMode === key ? '#fff' : colors.textMuted, fontFamily: mono }}>{mode.label}</div>
                          <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{mode.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
                  {getFields(modal).map((f) => (
                    <div key={f.key} style={{ gridColumn: f.key === 'smtp_host' || f.key === 'smtp_email' ? 'span 1' : undefined }}>
                      <label style={{ fontSize: 9, fontWeight: 600, color: colors.textDim, fontFamily: mono, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{f.label}</label>
                      <input type={f.type || 'text'} placeholder={f.placeholder} value={formData[f.key] || ''}
                        onChange={(e) => setFormData((p) => ({ ...p, [f.key]: e.target.value }))}
                        style={{ width: '100%', padding: '9px 13px', borderRadius: 9, border: `1px solid rgba(255,255,255,0.07)`, background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 13, fontFamily: mono, outline: 'none', boxSizing: 'border-box' }}
                        onFocus={(e) => e.target.style.borderColor = modal.color + '50'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.07)'} />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn onClick={install} style={{ flex: 1, justifyContent: 'center' }}>Instalar {modal.name}</Btn>
                  <Btn variant="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Post-install Credentials */}
      {resultCreds && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={(e) => e.target === e.currentTarget && setResultCreds(null)}>
          <Card style={{ width: 480, padding: 28, background: '#0d0e12' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: colors.green }}>Instalação concluída!</h3>
            <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 20 }}>Credenciais do {resultCreds.tool}:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {Object.entries(resultCreds).filter(([k]) => k !== 'tool').map(([key, val]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}` }}>
                  <div>
                    <span style={{ fontSize: 10, color: colors.textDim, fontFamily: mono, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}</span>
                    <div style={{ fontSize: 13, fontFamily: mono, color: '#fff', wordBreak: 'break-all' }}>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                  </div>
                  <CopyBtn text={typeof val === 'object' ? JSON.stringify(val) : String(val)} />
                </div>
              ))}
            </div>
            <Btn variant="ghost" onClick={() => setResultCreds(null)} style={{ width: '100%', justifyContent: 'center' }}>Fechar</Btn>
          </Card>
        </div>
      )}

      {/* Terminal */}
      <Terminal logs={logs} />
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

  useEffect(() => { refresh(); const i = setInterval(refresh, 10000); return () => clearInterval(i); }, [refresh]);

  const action = async (id, act) => {
    setActionLoading(`${id}_${act}`);
    try { await api(`/containers/${id}/${act}`, { method: 'POST' }); await refresh(); } catch {}
    setActionLoading(null);
  };

  const running = containers.filter((c) => c.state === 'running').length;
  const toolColors = { panel: colors.brand, n8n: colors.brand, evolution: colors.green, traefik: colors.blue, portainer: colors.blue, postgres: colors.purple, redis: colors.red, other: colors.textMuted };

  // Group by stack
  const stacks = {};
  containers.forEach((c) => {
    const parts = c.name.split('_');
    const stack = parts.length > 1 ? parts[0] : 'outros';
    if (!stacks[stack]) stacks[stack] = [];
    stacks[stack].push(c);
  });

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={28} /></div>;

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Monitoramento</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>Status em tempo real dos containers. Atualização a cada 10s.</p>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'Containers', value: containers.length, color: colors.blue },
          { label: 'Running', value: running, color: colors.green },
          { label: 'RAM VPS', value: sysInfo ? `${sysInfo.ram_used_mb}/${sysInfo.ram_total_mb} MB` : '---', color: colors.brand },
          { label: 'Disco', value: sysInfo?.disk_percentage || '---', color: colors.purple },
        ].map((s, i) => (
          <Card key={i} style={{ padding: 18 }}>
            <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: mono, color: s.color }}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Containers by Stack */}
      {Object.entries(stacks).map(([stack, items]) => (
        <div key={stack} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontFamily: mono, color: colors.textDim, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Stack: {stack}
          </div>
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 1fr 1fr', padding: '11px 18px', borderBottom: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.02)' }}>
              {['Container', 'Status', 'CPU', 'RAM', 'Ações'].map((h) => (
                <span key={h} style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, textAlign: h === 'Ações' ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
            {items.map((c, i) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 1fr 1fr', padding: '12px 18px', alignItems: 'center', borderBottom: `1px solid rgba(255,255,255,0.03)`, background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 3, height: 26, borderRadius: 2, background: toolColors[c.tool] || colors.textMuted }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontFamily: mono, color: '#fff' }}>{c.name.slice(0, 35)}</div>
                    <div style={{ fontSize: 10, color: colors.textDim, fontFamily: mono }}>{c.image.slice(0, 40)}</div>
                  </div>
                </div>
                <StatusBadge status={c.state} />
                <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: mono }}>{c.cpu || '---'}</span>
                <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: mono }}>{c.ram?.split('/')[0] || '---'}</span>
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
          </Card>
        </div>
      ))}
      {containers.length === 0 && (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: colors.textDim, fontSize: 14 }}>Nenhum container encontrado</div>
        </Card>
      )}
    </div>
  );
}

// ─── Credentials Page ───
function CredentialsPage() {
  const [creds, setCreds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPass, setShowPass] = useState({});

  useEffect(() => {
    fetchCredentials().then(setCreds).catch(() => setCreds({}));
    setLoading(false);
  }, []);

  const togglePass = (key) => setShowPass((p) => ({ ...p, [key]: !p[key] }));

  const sensitiveKeys = ['password', 'api_key', 'encryption_key', 'db_password', 'smtp_pass'];
  const isSensitive = (key) => sensitiveKeys.some((s) => key.toLowerCase().includes(s));

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spinner size={28} /></div>;

  const toolEntries = creds ? Object.entries(creds) : [];

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Credenciais</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>Senhas, chaves e URLs das ferramentas instaladas.</p>

      {toolEntries.length === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🔐</div>
          <p style={{ fontSize: 13, color: colors.textMuted }}>Nenhuma credencial encontrada. Instale uma ferramenta primeiro.</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {toolEntries.map(([toolId, data]) => {
            const tool = TOOLS.find((t) => t.id === toolId) || { name: toolId, icon: '🔧', color: colors.textMuted };
            const entries = Object.entries(data).filter(([k]) => k !== 'installed_at');
            const openUrl = data.editor_url || data.url || data.base_url || (data.domain ? 'https://' + data.domain : null);

            return (
              <Card key={toolId} style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: tool.color + '05' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{tool.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, fontFamily: mono }}>{tool.name}</span>
                    {data.installed_at && <span style={{ fontSize: 10, color: colors.textDim, fontFamily: mono }}>instalado em {new Date(data.installed_at).toLocaleDateString('pt-BR')}</span>}
                  </div>
                  {openUrl && (
                    <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: colors.brand, fontFamily: mono, textDecoration: 'none' }}>
                      Abrir →
                    </a>
                  )}
                </div>
                <div style={{ padding: '4px 0' }}>
                  {entries.map(([key, val]) => {
                    const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    const sensitive = isSensitive(key);
                    const uid = toolId + '_' + key;
                    return (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: `1px solid rgba(255,255,255,0.02)` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: colors.textDim, fontFamily: mono, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{key.replace(/_/g, ' ')}</div>
                          <div style={{ fontSize: 13, fontFamily: mono, color: '#fff', wordBreak: 'break-all', marginTop: 2 }}>
                            {sensitive && !showPass[uid] ? '••••••••••••' : valStr}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
                          {sensitive && (
                            <button onClick={() => togglePass(uid)} style={{
                              padding: '3px 8px', borderRadius: 6, border: `1px solid ${colors.border}`,
                              background: 'rgba(255,255,255,0.03)', color: colors.textMuted, fontSize: 10,
                              fontFamily: mono, cursor: 'pointer',
                            }}>
                              {showPass[uid] ? 'Ocultar' : 'Mostrar'}
                            </button>
                          )}
                          <CopyBtn text={valStr} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Backup Page ───
function BackupPage() {
  const [backups, setBackups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState(null);
  const [wsStatus, setWsStatus] = useState(null);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    try { const d = await api('/backup'); setBackups(d.backups || []); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const cleanup = connectWebSocket((msg) => {
      if (msg.type === 'backup' || msg.type === 'restore') {
        setWsStatus(msg);
        if (msg.status === 'completed') {
          refresh();
          setCreating(false);
          setRestoring(false);
        }
        if (msg.status === 'error') {
          setCreating(false);
          setRestoring(false);
        }
      }
    });
    return cleanup;
  }, [refresh]);

  const create = async () => {
    setCreating(true); setMsg(null); setWsStatus(null);
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
    if (!confirm('Tem certeza? Isso irá substituir os dados atuais pelo backup.')) { e.target.value = ''; return; }
    setRestoring(true); setMsg(null); setWsStatus(null);
    try {
      const d = await apiUpload('/backup/restore', file);
      setMsg({ type: 'success', text: d.message || 'Backup restaurado!' });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    setRestoring(false);
    e.target.value = '';
  };

  const download = (filename) => {
    const token = getToken();
    window.open(`/api/backup/download/${filename}?token=${token}`, '_blank');
  };

  const del = async (filename) => {
    if (!confirm('Deletar este backup?')) return;
    try { await api(`/backup/${filename}`, { method: 'DELETE' }); refresh(); } catch {}
  };

  return (
    <div style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Backup & Restore</h1>
      <p style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}>
        Backup inteligente: bancos PostgreSQL, instances Evolution, configurações e credenciais.
      </p>

      {/* Auto-backup info */}
      <Card style={{ padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(34,197,94,0.03)', borderColor: 'rgba(34,197,94,0.1)' }}>
        <span style={{ fontSize: 16 }}>⏰</span>
        <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: mono }}>Auto-backup diário às 03:00 (horário de Brasília). Mantém os 7 mais recentes.</span>
      </Card>

      {msg && (
        <div style={{ padding: '12px 18px', borderRadius: 10, marginBottom: 20, background: msg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, color: msg.type === 'success' ? colors.green : colors.red, fontSize: 13, fontFamily: mono }}>
          {msg.text}
        </div>
      )}

      {/* WebSocket progress */}
      {wsStatus && wsStatus.step && (
        <div style={{ padding: '10px 18px', borderRadius: 10, marginBottom: 20, background: 'rgba(255,109,90,0.05)', border: `1px solid rgba(255,109,90,0.15)`, fontSize: 12, fontFamily: mono, color: colors.brand, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner size={12} color={colors.brand} />
          {wsStatus.step}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 28 }}>
        <Card style={{ padding: 26 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>📦</div>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Criar Backup</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18, lineHeight: 1.6 }}>pg_dump dos bancos + instances + configs</p>
          <Btn onClick={create} loading={creating} disabled={creating}>Gerar Backup</Btn>
        </Card>

        <Card style={{ padding: 26 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🔄</div>
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Restaurar Backup</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18, lineHeight: 1.6 }}>Importa de um arquivo .tar.gz</p>
          <input type="file" ref={fileRef} accept=".tar.gz,.tgz" onChange={restore} style={{ display: 'none' }} />
          <Btn variant="success" onClick={() => fileRef.current?.click()} loading={restoring} disabled={restoring}>Enviar Backup</Btn>
        </Card>
      </div>

      <Card>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: mono, color: colors.textMuted }}>Histórico ({backups.length}/7)</span>
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
  const [view, setView] = useState('dashboard');
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
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'install', label: 'Instalar', icon: '⚙️' },
    { id: 'monitor', label: 'Monitorar', icon: '🖥️' },
    { id: 'credentials', label: 'Credenciais', icon: '🔑' },
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
          <div style={{ fontSize: 9, color: colors.textDim, fontFamily: mono, letterSpacing: '0.15em', marginTop: 4 }}>SETUP PANEL v2.0</div>
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
                  <span style={{ fontSize: 11, color: colors.textMuted }}>Hostname</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: colors.green }}>{sysInfo.hostname}</span>
                </div>
              </>
            ) : <Spinner size={14} />}
          </Card>

          <button onClick={() => { clearToken(); setAuthed(false); }} style={{
            width: '100%', marginTop: 12, padding: '10px', borderRadius: 8, border: `1px solid ${colors.border}`,
            background: 'transparent', color: colors.textDim, fontSize: 11, fontFamily: mono, cursor: 'pointer',
          }}>
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: '30px 36px', overflowY: 'auto' }}>
        {view === 'dashboard' && <DashboardPage />}
        {view === 'install' && <InstallPage />}
        {view === 'monitor' && <MonitorPage />}
        {view === 'credentials' && <CredentialsPage />}
        {view === 'backup' && <BackupPage />}
      </main>
    </div>
  );
}
