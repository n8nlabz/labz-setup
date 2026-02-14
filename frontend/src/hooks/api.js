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

export { api, apiUpload, getToken, setToken, clearToken };
