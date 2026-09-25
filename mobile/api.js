import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000').replace(/\/$/, '');
const TOKEN_KEY = 'sos-car-token';

async function request(path, options = {}) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  let response;
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique o backend e a rede do emulador.');
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.erro || 'Não foi possível concluir a operação.');
  return body;
}

export const api = {
  baseUrl: BASE_URL,
  getToken: () => AsyncStorage.getItem(TOKEN_KEY),
  setToken: (token) => (token ? AsyncStorage.setItem(TOKEN_KEY, token) : AsyncStorage.removeItem(TOKEN_KEY)),
  categorias: () => request('/categorias'),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  registrar: (data) => request('/auth/registrar', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  forgotPassword: (data) => request('/auth/esqueci-senha', { method: 'POST', body: JSON.stringify(data) }),
  resetPassword: (data) => request('/auth/redefinir-senha', { method: 'POST', body: JSON.stringify(data) }),
  adminLogin: (data) => request('/auth/login-admin', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (data) => request('/auth/atualizar', { method: 'PATCH', body: JSON.stringify(data) }),
  geocode: (address) => request(`/localizacao/geocodificar?endereco=${encodeURIComponent(address)}`),
  chamadoAtual: () => request('/chamados/atual'),
  abrirChamado: (data) => request('/chamados', { method: 'POST', body: JSON.stringify(data) }),
  updateCallLocation: (id, data) => request(`/chamados/${id}/localizacao`, { method: 'PATCH', body: JSON.stringify(data) }),
  cancelarChamado: (id) => request(`/chamados/${id}/cancelar`, { method: 'POST' }),
  avaliarChamado: (id, data) => request(`/chamados/${id}/avaliacao`, { method: 'POST', body: JSON.stringify(data) }),
  historico: () => request('/chamados/historico'),
  disponibilidade: (data) => request('/prestador/disponibilidade', { method: 'PATCH', body: JSON.stringify(data) }),
  disponiveis: () => request('/chamados/disponiveis'),
  aceitar: (id) => request(`/chamados/${id}/aceitar`, { method: 'POST' }),
  iniciar: (id) => request(`/chamados/${id}/iniciar`, { method: 'POST' }),
  concluir: (id) => request(`/chamados/${id}/concluir`, { method: 'POST' }),
  cancelarPrestador: (id) => request(`/chamados/${id}/cancelar-prestador`, { method: 'POST' }),
  myReviews: () => request('/prestador/me/avaliacoes'),
  adminStats: () => request('/admin/estatisticas'),
  adminUsers: () => request('/admin/usuarios'),
  adminApproveProvider: (id) => request(`/admin/prestadores/${id}/aprovar`, { method: 'POST' }),
  adminCalls: (status) => request(`/admin/chamados${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  adminCancelCall: (id) => request(`/admin/chamados/${id}/cancelar`, { method: 'POST' }),
  adminCategories: () => request('/admin/categorias'),
  adminRenameCategory: (id, name) => request(`/admin/categorias/${id}`, { method: 'PATCH', body: JSON.stringify({ nome: name }) })
};
