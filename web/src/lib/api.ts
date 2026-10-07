import type { GeocodeResult, MapSherm, PublicSherm, ReactionKind, ReportReason } from '@sherm/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'Keine Verbindung');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface ReactionCounts {
  like_count: number;
  still_there_count: number;
  gone_count: number;
  last_confirmed_at: string | null;
}

export const api = {
  sherms: () => request<MapSherm[]>('/api/sherms'),
  sherm: (id: number) => request<PublicSherm>(`/api/sherms/${id}`),
  react: (id: number, kind: ReactionKind, deviceId: string) =>
    request<ReactionCounts>(`/api/sherms/${id}/reactions`, json('POST', { kind, device_id: deviceId })),
  unreact: (id: number, kind: ReactionKind, deviceId: string) =>
    request<ReactionCounts>(`/api/sherms/${id}/reactions/${kind}?device_id=${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
  report: (id: number, reason: ReportReason, comment: string | null) =>
    request<{ success: true }>(`/api/sherms/${id}/reports`, json('POST', { reason, comment })),
  geocode: (q: string, signal?: AbortSignal) =>
    request<GeocodeResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`, { signal }),
};
