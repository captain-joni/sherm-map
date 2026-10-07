// Warteschlange für neue Sherms in IndexedDB. Wird von der Seite UND vom Service Worker
// (Background Sync) abgearbeitet. Die uuid macht doppeltes Senden harmlos.
import { openDB, type DBSchema } from 'idb';

export interface QueuedSherm {
  uuid: string;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  image: Blob | null;
  website: string;     // Honeypot, wird unverändert mitgeschickt
  created_at: string;
  attempts: number;
  status: 'waiting' | 'failed';  // failed = vom Server abgelehnt, Nutzer muss entscheiden
  error: string | null;
}

interface QueueDB extends DBSchema {
  queue: { key: string; value: QueuedSherm };
}

const db = () => openDB<QueueDB>('sherm-map', 1, {
  upgrade(database) {
    database.createObjectStore('queue', { keyPath: 'uuid' });
  },
});

export const SYNC_TAG = 'sherm-queue';

export async function enqueue(item: Omit<QueuedSherm, 'attempts' | 'status' | 'error' | 'created_at'>): Promise<void> {
  await (await db()).put('queue', { ...item, created_at: new Date().toISOString(), attempts: 0, status: 'waiting', error: null });
}

export async function queued(): Promise<QueuedSherm[]> {
  return (await db()).getAll('queue');
}

export async function removeQueued(uuid: string): Promise<void> {
  await (await db()).delete('queue', uuid);
}

type SendResult = 'sent' | 'retry' | 'failed';

async function send(item: QueuedSherm): Promise<{ result: SendResult; error: string | null }> {
  const form = new FormData();
  form.set('uuid', item.uuid);
  form.set('title', item.title);
  if (item.description) form.set('description', item.description);
  form.set('lat', String(item.lat));
  form.set('lng', String(item.lng));
  form.set('website', item.website);
  if (item.image) form.set('image', item.image, 'sherm.jpg');

  let res: Response;
  try {
    res = await fetch('/api/sherms', { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    return { result: 'retry', error: 'Keine Verbindung' };
  }
  if (res.ok) return { result: 'sent', error: null };
  const message = (await res.json().catch(() => null))?.error ?? `Fehler ${res.status}`;
  // Überlastung/Serverfehler: später nochmal. Sonst (400 usw.) bringt Wiederholen nichts.
  return { result: res.status === 429 || res.status === 408 || res.status >= 500 ? 'retry' : 'failed', error: message };
}

// Alles Wartende senden. Gibt die Anzahl gesendeter Einträge zurück.
export async function processQueue(): Promise<{ sent: number; remaining: number }> {
  const run = async () => {
    let sent = 0;
    for (const item of await queued()) {
      if (item.status === 'failed') continue;
      const { result, error } = await send(item);
      if (result === 'sent') {
        await removeQueued(item.uuid);
        sent++;
      } else {
        await (await db()).put('queue', { ...item, attempts: item.attempts + 1, status: result === 'failed' ? 'failed' : 'waiting', error });
        if (result === 'retry' && error === 'Keine Verbindung') break; // offline: Rest gar nicht erst versuchen
      }
    }
    return { sent, remaining: (await queued()).length };
  };
  // Nicht gleichzeitig aus mehreren Tabs/dem Service Worker
  return 'locks' in navigator ? navigator.locks.request('sherm-queue', run) : run();
}
