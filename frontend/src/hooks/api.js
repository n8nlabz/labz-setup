const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('n8nlabz_jwt') || '';
}

function setToken(token) {
  localStorage.setItem('n8nlabz_jwt', token);
}

function clearToken() {
  localStorage.removeItem('n8nlabz_jwt');
}

async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

async function apiUpload(endpoint, file) {
  const token = getToken();
  const formData = new FormData();
  formData.append('backup', file);

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro no upload');
  return data;
}

function connectWebSocket(onMessage) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/api/ws/logs`;
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => {};
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (onMessage) onMessage(data);
      } catch {}
    };
    ws.onclose = () => {
      reconnectTimer = setTimeout(connect, 3000);
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}

async function fetchCredentials() {
  return api('/credentials');
}

export { api, apiUpload, getToken, setToken, clearToken, connectWebSocket, fetchCredentials };
