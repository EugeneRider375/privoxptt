import axios, { AxiosError } from 'axios';
import { useStore } from '@/store/useStore';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10_000,
});

// Токены лежат в двух местах: в Zustand-persist (ключ privoxptt) и плоскими
// ключами localStorage. Раньше этот файл читал только плоские, и стоило им
// разъехаться со стором — приложение вставало в цикл: 401 -> редирект на
// /login -> стор регидрируется из уцелевшего privoxptt -> снова считает себя
// залогиненным -> 401. На рации это выглядело как «страница прыгает раз в
// секунду и не даёт ввести пароль». Читаем и пишем оба места сразу.
function readToken(kind: 'accessToken' | 'refreshToken'): string | null {
  return useStore.getState()[kind] ?? localStorage.getItem(kind);
}

function storeTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
  useStore.setState({ accessToken, refreshToken });
}

// Сессии больше нет: чистим ОБА хранилища (clearAuth убирает и privoxptt) и
// уходим на логин. Проверка pathname — страховка от повторного редиректа,
// который и раскручивал цикл перезагрузок.
function dropSession(): void {
  useStore.getState().clearAuth();
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

// Подставляем Bearer токен
api.interceptors.request.use((config) => {
  const token = readToken('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Обновление сессии ровно одним запросом на всё приложение. Сервер ротирует
// refresh-токен и удаляет старый, поэтому два параллельных обновления одним и
// тем же токеном — это гарантированный 401 у проигравшего и разлогин живой
// сессии. Все желающие ждут один и тот же промис.
let refreshPromise: Promise<string> | null = null;

function performRefresh(): Promise<string> {
  if (!refreshPromise) {
    const refreshToken = readToken('refreshToken');
    if (!refreshToken) return Promise.reject(new Error('no refresh token'));

    refreshPromise = axios
      .post(`${BASE_URL}/auth/refresh`, { refreshToken })
      .then(({ data }) => {
        storeTokens(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Автоматический refresh при 401
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      try {
        const accessToken = await performRefresh();
        original.headers!.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        dropSession();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// Тихое продление сессии при старте приложения. Сервер ротирует refresh-токен
// и отодвигает срок ещё на год, поэтому устройство, которое включают хотя бы
// раз в год, логин больше не спросит. Вызывается из main.tsx, ответа не ждём:
// рация вне зоны должна стартовать на уже сохранённом токене.
export async function refreshSession(): Promise<boolean> {
  if (!readToken('refreshToken')) return false;

  try {
    await performRefresh();
    return true;
  } catch (err) {
    // 401 — сессия отозвана или истекла, показываем логин.
    // Нет сети — молчим и работаем с тем токеном, что есть.
    if ((err as AxiosError).response?.status === 401) dropSession();
    return false;
  }
}

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

// ─── Sensors ──────────────────────────────────────────────
export const sensorsApi = {
  list: (orgId?: string) => api.get('/sensors', { params: { orgId } }).then((r) => r.data),
  get: (id: string) => api.get(`/sensors/${id}`).then((r) => r.data),
  create: (data: object) => api.post('/sensors', data).then((r) => r.data),
  update: (id: string, data: object) => api.patch(`/sensors/${id}`, data).then((r) => r.data),
  rotateKey: (id: string) => api.post(`/sensors/${id}/rotate-key`).then((r) => r.data),
  arm: (id: string, armed: boolean) => api.post(`/sensors/${id}/arm`, { armed }).then((r) => r.data),
  delete: (id: string) => api.delete(`/sensors/${id}`),
};

// ─── Вопросник суперадмина ──────────────────────────────────
// Создание пачки участников упирается в bcrypt: 50 человек — около 4 секунд,
// 200 — около 16. Глобальный таймаут (10 с) для этого мал, поэтому поднимаем
// его точечно, не трогая остальные запросы.
export const onboardingApi = {
  preview: (data: object) =>
    api.post('/onboarding/preview', data, { timeout: 30_000 }).then((r) => r.data),
  create: (data: object) =>
    api.post('/onboarding/create', data, { timeout: 180_000 }).then((r) => r.data),

  // Пополнение уже работающей группы — «пришёл новый сотрудник».
  previewForGroup: (groupId: string, data: object) =>
    api.post(`/onboarding/groups/${groupId}/preview`, data, { timeout: 30_000 }).then((r) => r.data),
  addToGroup: (groupId: string, data: object) =>
    api.post(`/onboarding/groups/${groupId}/add`, data, { timeout: 180_000 }).then((r) => r.data),
};

// ─── Приглашение по персональному QR ────────────────────────
// Без авторизации: токен из ссылки и есть удостоверение.
export const invitesApi = {
  resolve: (token: string) =>
    api.get(`/invites/${encodeURIComponent(token)}`).then((r) => r.data),
  activate: (token: string) =>
    api.post(`/invites/${encodeURIComponent(token)}/activate`).then((r) => r.data),
};

// ─── Activity log ─────────────────────────────────────────
export const activityApi = {
  list: (params?: { limit?: number; type?: string }) =>
    api.get('/activity', { params }).then((r) => r.data),
};

// ─── Native push devices ─────────────────────────────────
export const devicesApi = {
  register: (data: {
    pushToken: string;
    platform: 'ANDROID' | 'IOS';
    deviceName?: string;
    appVersion?: string;
  }) => api.post('/devices/register', data).then((r) => r.data),
  unregister: (pushToken: string) =>
    api.post('/devices/unregister', { pushToken }).then((r) => r.data),
};

// ─── Messenger ────────────────────────────────────────────
export const messagesApi = {
  conversations: () => api.get('/messages/conversations').then((r) => r.data),
  history: (target: { groupId?: string; userId?: string }, cursor?: string) =>
    api.get('/messages', { params: { ...target, cursor, limit: 100 } }).then((r) => r.data),
  send: (data: { body: string; groupId?: string; userId?: string }) =>
    api.post('/messages', data).then((r) => r.data),
  sendAttachment: (file: File, target: { groupId?: string; userId?: string }) =>
    api.post('/messages/attachments', file, {
      params: target,
      headers: {
        'Content-Type': file.type || attachmentTypeFromName(file.name),
        'X-File-Name': encodeURIComponent(file.name),
      },
      timeout: 120_000,
    }).then((r) => r.data),
  attachment: (messageId: string) =>
    api.get(`/messages/${messageId}/attachment`, {
      responseType: 'blob',
      timeout: 30_000,
    }).then((r) => r.data as Blob),
  markRead: (target: { groupId?: string; userId?: string }) =>
    api.post('/messages/read', target).then((r) => r.data),
  clearHistory: (target: { groupId?: string; userId?: string }) =>
    api.post('/messages/clear', target).then((r) => r.data),
};

function attachmentTypeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  return ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}
