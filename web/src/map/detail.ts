// Inhalt des Sheets für einen Sherm: Foto, Text, Likes, "Noch da?", Teilen, Melden
import { Check, CircleX, Flag, Heart, MapPin, Share2, X } from 'lucide';
import { LIMITS, REPORT_REASONS, type ReactionKind, type ReportReason } from '@sherm/shared/constants';
import type { PublicSherm } from '@sherm/shared';
import { api, ApiError, type ReactionCounts } from '../lib/api.ts';
import { deviceId, myReactions, setMyReaction } from '../lib/device.ts';
import { h, icon, toast } from '../lib/dom.ts';
import { relativeTime } from '../lib/format.ts';

const REASON_LABELS: Record<ReportReason, string> = {
  privacy: 'Person, Gesicht oder Kennzeichen zu erkennen',
  illegal: 'Illegal',
  offensive: 'Beleidigend oder anstößig',
  spam: 'Spam oder Werbung',
  wrong_location: 'Falscher Ort',
  other: 'Etwas anderes',
};

export function renderDetail(sherm: PublicSherm): HTMLElement {
  const root = h('article', { class: 'detail' });

  // Titel zuerst: im halb offenen Sheet sieht man sofort, was es ist, das Foto darunter

  const place = [sherm.place_name, sherm.country_name].filter(Boolean).join(', ');
  root.append(
    h('header', { class: 'detail-header' },
      h('h2', {}, sherm.title),
      h('p', { class: 'detail-meta' },
        place ? h('span', {}, icon(MapPin, 14), place) : null,
        h('span', {}, `eingetragen ${relativeTime(sherm.created_at)}`))),
  );

  if (sherm.photo) {
    const img = h('img', {
      class: 'detail-photo',
      src: sherm.photo.display,
      alt: sherm.title,
      width: sherm.photo.width ?? undefined,
      height: sherm.photo.height ?? undefined,
      decoding: 'async',
      onclick: () => openViewer(sherm.photo!.display, sherm.title),
    });
    root.append(h('div', { class: 'detail-photo-wrap' }, img));
  }

  if (sherm.probably_gone) {
    root.append(h('p', { class: 'badge badge-warn' }, 'Wahrscheinlich nicht mehr da'));
  }
  if (sherm.description) root.append(h('p', { class: 'detail-description' }, sherm.description));

  // Aktionen
  const likeButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  const shareButton = h('button', { class: 'chip-button', type: 'button', onclick: () => share(sherm) }, icon(Share2, 18), 'Teilen');
  root.append(h('div', { class: 'detail-actions' }, likeButton, shareButton));

  // Noch da?
  const confirmed = h('p', { class: 'detail-confirmed' });
  const stillButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  const goneButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  root.append(h('section', { class: 'detail-still' },
    h('h3', {}, 'Ist der Sherm noch da?'), confirmed, h('div', { class: 'detail-actions' }, stillButton, goneButton)));

  let counts: ReactionCounts = {
    like_count: sherm.like_count, still_there_count: sherm.still_there_count,
    gone_count: sherm.gone_count, last_confirmed_at: sherm.last_confirmed_at,
  };

  function render() {
    const mine = myReactions(sherm.id);
    const set = (button: HTMLButtonElement, kind: ReactionKind, iconNode: Parameters<typeof icon>[0], label: string, count: number) => {
      const active = mine.includes(kind);
      button.replaceChildren(icon(iconNode, 18), `${label} · ${count}`);
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    };
    set(likeButton, 'like', Heart, 'Gefällt mir', counts.like_count);
    set(stillButton, 'still_there', Check, 'Noch da', counts.still_there_count);
    set(goneButton, 'gone', CircleX, 'Weg', counts.gone_count);
    confirmed.textContent = counts.last_confirmed_at
      ? `Zuletzt bestätigt ${relativeTime(counts.last_confirmed_at)}`
      : 'Noch von niemandem bestätigt';
  }

  async function toggle(kind: ReactionKind) {
    const active = myReactions(sherm.id).includes(kind);
    try {
      counts = active
        ? await api.unreact(sherm.id, kind, deviceId())
        : await api.react(sherm.id, kind, deviceId());
      setMyReaction(sherm.id, kind, !active);
      render();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Hat nicht geklappt');
    }
  }
  likeButton.addEventListener('click', () => toggle('like'));
  stillButton.addEventListener('click', () => toggle('still_there'));
  goneButton.addEventListener('click', () => toggle('gone'));
  render();

  root.append(h('footer', { class: 'detail-footer' },
    h('button', { class: 'link-button', type: 'button', onclick: () => openReportDialog(sherm) }, icon(Flag, 16), 'Sherm melden')));

  return root;
}

export function shermUrl(id: number): string {
  return `${location.origin}/s/${id}`;
}

async function share(sherm: PublicSherm) {
  const url = shermUrl(sherm.id);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${sherm.title} – Sherm Map`, url });
    } catch {
      // abgebrochen
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopiert');
  } catch {
    toast(url);
  }
}

function openViewer(src: string, alt: string) {
  const dialog = h('dialog', { class: 'viewer', onclick: () => dialog.close() },
    h('img', { src, alt }),
    h('button', { class: 'icon-button viewer-close', type: 'button', 'aria-label': 'Schließen' }, icon(X)));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function openReportDialog(sherm: PublicSherm) {
  const comment = h('textarea', { name: 'comment', rows: 3, maxlength: LIMITS.reportCommentMax, placeholder: 'Optional: was ist das Problem?' });
  const options = REPORT_REASONS.map(reason =>
    h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'reason', value: reason, required: true }), REASON_LABELS[reason]));
  const submit = h('button', { class: 'button primary', type: 'submit' }, 'Melden');
  const form = h('form', { method: 'dialog', class: 'dialog-form' },
    h('h2', {}, 'Sherm melden'),
    h('p', { class: 'muted' }, 'Wir schauen uns das an und entfernen den Sherm, wenn nötig.'),
    h('fieldset', {}, ...options),
    comment,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'),
      submit));
  const dialog = h('dialog', { class: 'dialog' }, form);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const reason = (new FormData(form).get('reason') as ReportReason | null);
    if (!reason) return;
    submit.disabled = true;
    try {
      await api.report(sherm.id, reason, comment.value.trim() || null);
      dialog.close();
      toast('Danke, wir schauen es uns an');
    } catch (err) {
      submit.disabled = false;
      toast(err instanceof ApiError ? err.message : 'Melden hat nicht geklappt');
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
