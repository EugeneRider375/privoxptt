import axios, { AxiosError } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10_000,
});

// Подставляем Bearer токен из localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Автоматический refresh при 401
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((token) => {
            original.headers!.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('no refresh token');

        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);

        queue.forEach((cb) => cb(data.accessToken));
        queue = [];

        original.headers!.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me').then((r) => r.data),
};

// ─── Users ────────────────────────────────────────────────
export const usersApi = {
  list: (orgId?: string) =>
    api.get('/users', { params: { orgId } }).then((r) => r.data),
  online: () => api.get('/users/online').then((r) => r.data),
  get: (id: string) => api.get(`/users/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/users', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/users/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/users/${id}`),
  resetPassword: (id: string, newPassword: string) =>
    api.post(`/users/${id}/reset-password`, { newPassword }),
  changePassword: (id: string, currentPassword: string, newPassword: string) =>
    api.post(`/users/${id}/change-password`, { currentPassword, newPassword }),
};

// ─── Groups ───────────────────────────────────────────────
export const groupsApi = {
  list: (orgId?: string) => api.get('/groups', { params: { orgId } }).then((r) => r.data),
  get: (id: string) => api.get(`/groups/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/groups', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/groups/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/groups/${id}`),
  addMember: (groupId: string, userId: string, canSpeak = true) =>
    api.post(`/groups/${groupId}/members`, { userId, canSpeak }).then((r) => r.data),
  removeMember: (groupId: string, userId: string) =>
    api.delete(`/groups/${groupId}/members/${userId}`),
  updateMember: (groupId: string, userId: string, canSpeak: boolean) =>
    api.patch(`/groups/${groupId}/members/${userId}`, { canSpeak }),
};

// ─── Organizations ────────────────────────────────────────
export const orgsApi = {
  list: () => api.get('/orgs').then((r) => r.data),
  get: (id: string) => api.get(`/orgs/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/orgs', data).then((r) => r.data),
  update: (id: string, data: object) => api.put(`/orgs/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/orgs/${id}`),
};

// ─── Activity log ─────────────────────────────────────────
export const activityApi = {
  list: (params?: { limit?: number; type?: string }) =>
    api.get('/activity', { params }).then((r) => r.data),
};
