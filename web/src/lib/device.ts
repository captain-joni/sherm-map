// Zufällige Geräte-ID (für Likes/"noch da" ohne Account) und die eigenen Reaktionen pro Sherm
import type { ReactionKind } from '@sherm/shared';
import { storage } from './dom.ts';

export function deviceId(): string {
  let id = storage.get<string | null>('device-id', null);
  if (!id) {
    id = crypto.randomUUID();
    storage.set('device-id', id);
  }
  return id;
}

type Reactions = Record<string, ReactionKind[]>;

export function myReactions(shermId: number): ReactionKind[] {
  return storage.get<Reactions>('reactions', {})[shermId] ?? [];
}

export function setMyReaction(shermId: number, kind: ReactionKind, active: boolean): void {
  const all = storage.get<Reactions>('reactions', {});
  let kinds = (all[shermId] ?? []).filter(k => k !== kind);
  if (active) {
    // "noch da" und "weg" schließen sich aus, wie im Backend
    if (kind === 'still_there') kinds = kinds.filter(k => k !== 'gone');
    if (kind === 'gone') kinds = kinds.filter(k => k !== 'still_there');
    kinds.push(kind);
  }
  all[shermId] = kinds;
  storage.set('reactions', all);
}
