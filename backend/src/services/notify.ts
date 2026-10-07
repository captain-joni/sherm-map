// Benachrichtigungen per Webhook (z.B. n8n -> Telegram/Mail). Gleiches Format wie die Backup-Skripte:
//   { source: 'sherm-map', event, host, at, message, ...daten }
// "message" ist ein fertiger deutscher Text, damit n8n ihn ohne Umbau weiterleiten kann.
// Fire-and-forget: ein langsamer oder kaputter Webhook bremst nie einen Request.
import os from 'node:os';

export type NotifyEvent = 'sherm.submitted' | 'report.created';
export type Notify = (event: NotifyEvent, data: { message: string } & Record<string, unknown>) => void;

export function createNotifier(url: string | null, token: string | null, fetchImpl: typeof fetch = fetch): Notify {
  return (event, data) => {
    if (!url) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = JSON.stringify({ source: 'sherm-map', event, host: os.hostname(), at: new Date().toISOString(), ...data });
    fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
      .then(res => { if (!res.ok) console.error(`Webhook ${event}: HTTP ${res.status}`); })
      .catch(err => console.error(`Webhook ${event}: ${(err as Error).message}`));
  };
}
