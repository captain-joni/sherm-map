// Admin-API. Bei 401 (Session abgelaufen) meldet sich die App neu an, siehe main.ts.
import type { AdminPhoto, AdminSherm, Page, SessionUser, ShermAction, ShermStatus, UserRole } from '@sherm/shared';
import { ApiError, request } from '../lib/api.ts';

export { ApiError };

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  try {
    return await request<T>(url, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
    throw err;
  }
}

const json = (method: string, body: unknown = {}): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface ShermDetail {
  sherm: AdminSherm;
  nearby: { id: number; title: string; status: ShermStatus; lat: number; lng: number; distance_m: number; thumb: string | null }[];
  same_source: { id: number; title: string; status: ShermStatus; created_at: string }[];
  reports: { id: number; reason: string; comment: string | null; status: string; created_at: string; resolved_by: string | null }[];
  history: AuditEntry[];
}

export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  sherm_id?: number | null;
  sherm_title?: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface GalleryPhoto extends AdminPhoto {
  created_at: string;
  sherm: { id: number; title: string; status: ShermStatus; country_code: string | null; like_count: number };
}

export interface ReportGroup {
  id: number;
  title: string;
  status: ShermStatus;
  deleted_at: string | null;
  thumb: string | null;
  reports: { id: number; reason: string; comment: string | null; created_at: string }[];
}

export interface Metrics {
  total: number;
  by_status: Record<ShermStatus, number>;
  countries: { count: number; top: { code: string; name: string | null; n: number }[] };
  weekly_submissions: { week: string; n: number }[];
  review: { approval_rate: number | null; median_review_hours: number | null };
  top_liked: { id: number; title: string; like_count: number }[];
  open_reports: number;
  probably_gone: number;
  deleted: number;
  photos: number;
  starred_photos: number;
  oldest_pending: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  must_change_password: boolean;
  disabled_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

export const adminApi = {
  me: () => request<SessionUser>('/api/auth/me'),
  login: (username: string, password: string) => request<SessionUser>('/api/auth/login', json('POST', { username, password })),
  logout: () => request('/api/auth/logout', json('POST')),
  changePassword: (current_password: string, new_password: string) =>
    request<SessionUser>('/api/auth/password', json('POST', { current_password, new_password })),

  sherms: (params: Record<string, string | number | boolean | undefined>) => call<Page<AdminSherm>>(`/api/admin/sherms${qs(params)}`),
  sherm: (id: number) => call<ShermDetail>(`/api/admin/sherms/${id}`),
  edit: (id: number, changes: Record<string, unknown>) => call<AdminSherm>(`/api/admin/sherms/${id}`, json('PATCH', changes)),
  action: (id: number, action: ShermAction, reason?: string) => call<AdminSherm>(`/api/admin/sherms/${id}/${action}`, json('POST', { reason })),
  bulk: (ids: number[], action: ShermAction, reason?: string) =>
    call<{ updated: number; ids: number[] }>('/api/admin/sherms/bulk', json('POST', { ids, action, reason })),

  photos: (params: Record<string, string | number | boolean | undefined>) => call<Page<GalleryPhoto>>(`/api/admin/photos${qs(params)}`),
  star: (id: number, starred: boolean) => call(`/api/admin/photos/${id}/star`, json('POST', { starred })),
  replaceImage: (id: number, image: Blob) => {
    const form = new FormData();
    form.set('image', image, 'bearbeitet.jpg');
    return call<AdminPhoto>(`/api/admin/photos/${id}/image`, { method: 'PUT', body: form });
  },
  revertImage: (id: number) => call<AdminPhoto>(`/api/admin/photos/${id}/revert`, json('POST')),

  reports: (status: string, page = 1) => call<Page<ReportGroup>>(`/api/admin/reports${qs({ status, page })}`),
  resolveAll: (shermId: number, status: 'resolved' | 'dismissed') =>
    call<{ updated: number }>(`/api/admin/reports/sherm/${shermId}/resolve`, json('POST', { status })),

  metrics: () => call<Metrics>('/api/admin/metrics'),
  audit: (params: Record<string, string | number | undefined>) => call<Page<AuditEntry>>(`/api/admin/audit${qs(params)}`),

  users: () => call<AdminUser[]>('/api/admin/users'),
  createUser: (username: string, role: UserRole) =>
    call<{ user: AdminUser; one_time_password: string }>('/api/admin/users', json('POST', { username, role })),
  updateUser: (id: number, changes: { role?: UserRole; disabled?: boolean }) => call<AdminUser>(`/api/admin/users/${id}`, json('PATCH', changes)),
  resetPassword: (id: number) => call<{ one_time_password: string }>(`/api/admin/users/${id}/reset-password`, json('POST')),
  logoutAll: (id: number) => call(`/api/admin/users/${id}/logout-all`, json('POST')),

  backups: () => call<{ available: boolean; backups: { name: string; bytes: number; created_at: string }[] }>('/api/admin/system/backups'),
  exportData: async () => {
    const res = await fetch('/api/admin/system/export', { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? `Fehler ${res.status}`);
    const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1] ?? 'sherm-export.tar.gz';
    return { blob: await res.blob(), name };
  },
};
