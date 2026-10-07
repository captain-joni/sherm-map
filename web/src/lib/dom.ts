// Kleine DOM-Helfer. Text kommt immer über textContent rein, nie über innerHTML (kein XSS).
import { createElement as lucide, type IconNode } from 'lucide';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function icon(node: IconNode, size = 22): SVGElement {
  return lucide(node, { width: size, height: size, 'aria-hidden': 'true', 'stroke-width': 2 });
}

// Kurze Meldung unten am Bildschirm
let toastTimer: number | undefined;
export function toast(message: string, action?: { label: string; onClick: () => void }, ms = 3500): void {
  document.querySelector('.toast')?.remove();
  window.clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  if (action) {
    el.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { el.remove(); action.onClick(); } }, action.label));
  }
  document.body.append(el);
  toastTimer = window.setTimeout(() => el.remove(), action ? ms * 3 : ms);
}

// localStorage kann in privaten Fenstern o.ä. werfen
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // egal, ist nur Komfort
    }
  },
};
