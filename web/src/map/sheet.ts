// Bottom Sheet wie in Karten-Apps: halb offen zeigt das Wichtigste, nach oben ziehen für alles,
// nach unten ziehen schließt. Auf breiten Bildschirmen ist es ein Seitenpanel ohne Ziehen.
import { h } from '../lib/dom.ts';
import { t } from '../lib/i18n.ts';

export type SheetState = 'closed' | 'half' | 'full';

const DESKTOP = window.matchMedia('(min-width: 900px)');

export interface Sheet {
  element: HTMLElement;
  open(content: Node, state?: SheetState): void;
  setState(state: SheetState): void;
  state(): SheetState;
  close(): void;
}

export function createSheet(onClose: () => void): Sheet {
  const body = h('div', { class: 'sheet-body' });
  const handle = h('button', { class: 'sheet-handle', type: 'button', 'aria-label': t('sheet.handle') }, h('span'));
  const element = h('section', { class: 'sheet', 'aria-hidden': 'true', 'data-state': 'closed' }, handle, body);
  let current: SheetState = 'closed';

  // Position (Abstand von oben in px) je Zustand
  const offset = (state: SheetState) => {
    const vh = window.innerHeight;
    return { closed: vh, half: vh * 0.45, full: Math.max(vh * 0.06, 24) }[state];
  };

  function apply(state: SheetState, animate = true) {
    current = state;
    element.dataset.state = state;
    element.setAttribute('aria-hidden', String(state === 'closed'));
    element.style.transition = animate ? '' : 'none';
    element.style.transform = DESKTOP.matches ? '' : `translateY(${offset(state)}px)`;
    body.scrollTop = state === 'full' ? body.scrollTop : 0;
  }

  // Ziehen: im halben Zustand am ganzen Sheet, im vollen nur am Griff (sonst scrollt der Inhalt)
  let drag: { startY: number; startOffset: number; lastY: number; lastT: number; velocity: number; onHandle: boolean } | null = null;

  element.addEventListener('pointerdown', e => {
    if (DESKTOP.matches || current === 'closed') return;
    if (current === 'full' && !handle.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, dialog')) {
      if (!handle.contains(e.target as Node)) return;
    }
    // Mit Pointer-Capture ist das Ziel von pointerup immer das Sheet, daher den Start merken
    drag = { startY: e.clientY, startOffset: offset(current), lastY: e.clientY, lastT: e.timeStamp, velocity: 0, onHandle: handle.contains(e.target as Node) };
    element.setPointerCapture(e.pointerId);
    element.style.transition = 'none';
  });

  element.addEventListener('pointermove', e => {
    if (!drag) return;
    const y = Math.max(offset('full'), drag.startOffset + e.clientY - drag.startY);
    drag.velocity = (e.clientY - drag.lastY) / Math.max(1, e.timeStamp - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    element.style.transform = `translateY(${y}px)`;
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const moved = e.clientY - drag.startY;
    const y = drag.startOffset + moved;
    const v = drag.velocity;
    const onHandle = drag.onHandle;
    drag = null;
    element.style.transition = '';

    if (Math.abs(moved) < 6) {
      // Tippen auf den Griff wechselt zwischen halb und voll
      if (onHandle) apply(current === 'full' ? 'half' : 'full');
      else apply(current);
      return;
    }
    // Schneller Wisch entscheidet, sonst der nächste Zustand
    if (v > 0.6) return y > offset('half') || current === 'half' ? close() : apply('half');
    if (v < -0.6) return apply('full');
    const states: SheetState[] = ['full', 'half', 'closed'];
    const nearest = states.reduce((a, b) => (Math.abs(offset(a) - y) < Math.abs(offset(b) - y) ? a : b));
    if (nearest === 'closed') close();
    else apply(nearest);
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => apply(current, false));
  DESKTOP.addEventListener('change', () => apply(current, false));

  function close() {
    if (current === 'closed') return;
    apply('closed');
    onClose();
  }

  apply('closed', false);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && current !== 'closed' && !document.querySelector('dialog[open]')) close();
  });

  return {
    element,
    open(content, state = 'half') {
      body.replaceChildren(content);
      body.scrollTop = 0;
      apply(state);
    },
    setState: state => apply(state),
    state: () => current,
    close,
  };
}
