// Pseudonyme Kennungen für Einsender, Abstimmende und Melder: HMAC mit Server-Geheimnis.
// Rohe IPs werden nie gespeichert; ohne HASH_SECRET lassen sich die Hashes nicht zurückrechnen.
import { createHmac } from 'node:crypto';
import type { Request } from 'express';

export function makeHasher(secret: string) {
  const hash = (kind: string, value: string) =>
    createHmac('sha256', secret).update(`${kind}:${value}`).digest('base64url').slice(0, 32);

  return {
    ip: (req: Request) => hash('ip', req.ip ?? 'unknown'),
    // Gerät (zufällige ID aus dem localStorage), sonst die IP
    voter: (req: Request, deviceId?: string) => (deviceId ? hash('device', deviceId) : hash('ip', req.ip ?? 'unknown')),
  };
}

export type Hasher = ReturnType<typeof makeHasher>;
