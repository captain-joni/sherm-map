import type { SessionUser } from '@sherm/shared';

export interface AdminContext {
  user: SessionUser;
  navigate(path: string, replace?: boolean): void;
  refreshBadges(): Promise<void>;
}

// Eine Ansicht rendert in container und gibt optional eine Aufräumfunktion zurück
export type View = (container: HTMLElement, ctx: AdminContext, params: Record<string, string>) => (() => void) | void;
