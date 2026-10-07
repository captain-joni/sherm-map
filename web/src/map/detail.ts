// Inhalt des Sheets für einen Sherm: Foto, Text, Likes, "Noch da?", Teilen, Melden
import { Check, CircleX, Flag, Heart, MapPin, Share2, X } from 'lucide';
import { LIMITS, REPORT_REASONS, type ReactionKind, type ReportReason } from '@sherm/shared/constants';
import type { PublicSherm } from '@sherm/shared';
import { api, ApiError, type ReactionCounts } from '../lib/api.ts';
import { deviceId, myReactions, setMyReaction } from '../lib/device.ts';
import { h, icon, toast } from '../lib/dom.ts';
import { relativeTime } from '../lib/format.ts';
import { errorMessage, reasonLabel, t } from '../lib/i18n.ts';

export function renderDetail(sherm: PublicSherm): HTMLElement {
  const root = h('article', { class: 'detail' });

  // Titel zuerst: im halb offenen Sheet sieht man sofort, was es ist, das Foto darunter

  const place = [sherm.place_name, sherm.country_name].filter(Boolean).join(', ');
  root.append(
    h('header', { class: 'detail-header' },
      h('h2', {}, sherm.title),
      h('p', { class: 'detail-meta' },
        place ? h('span', {}, icon(MapPin, 14), place) : null,
        h('span', {}, t('detail.added', { time: relativeTime(sherm.created_at) })))),
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
    root.append(h('p', { class: 'badge badge-warn' }, t('detail.probablyGone')));
  }
  if (sherm.description) root.append(h('p', { class: 'detail-description' }, sherm.description));

  // Aktionen
  const likeButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  const shareButton = h('button', { class: 'chip-button', type: 'button', onclick: () => share(sherm) }, icon(Share2, 18), t('detail.share'));
  root.append(h('div', { class: 'detail-actions' }, likeButton, shareButton));

  // Noch da?
  const confirmed = h('p', { class: 'detail-confirmed' });
  const stillButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  const goneButton = h('button', { class: 'chip-button', type: 'button', 'aria-pressed': 'false' });
  root.append(h('section', { class: 'detail-still' },
    h('h3', {}, t('detail.stillThereQuestion')), confirmed, h('div', { class: 'detail-actions' }, stillButton, goneButton)));

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
    set(likeButton, 'like', Heart, t('detail.like'), counts.like_count);
    set(stillButton, 'still_there', Check, t('detail.stillThere'), counts.still_there_count);
    set(goneButton, 'gone', CircleX, t('detail.gone'), counts.gone_count);
    confirmed.textContent = counts.last_confirmed_at
      ? t('detail.confirmed', { time: relativeTime(counts.last_confirmed_at) })
      : t('detail.notConfirmed');
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
      toast(err instanceof ApiError ? errorMessage(err.code, err.message) : t('common.failed'));
    }
  }
  likeButton.addEventListener('click', () => toggle('like'));
  stillButton.addEventListener('click', () => toggle('still_there'));
  goneButton.addEventListener('click', () => toggle('gone'));
  render();

  root.append(h('footer', { class: 'detail-footer' },
    h('button', { class: 'link-button', type: 'button', onclick: () => openReportDialog(sherm) }, icon(Flag, 16), t('detail.report'))));

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
    toast(t('detail.linkCopied'));
  } catch {
    toast(url);
  }
}

function openViewer(src: string, alt: string) {
  const dialog = h('dialog', { class: 'viewer', onclick: () => dialog.close() },
    h('img', { src, alt }),
    h('button', { class: 'icon-button viewer-close', type: 'button', 'aria-label': t('common.close') }, icon(X)));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function openReportDialog(sherm: PublicSherm) {
  const comment = h('textarea', { name: 'comment', rows: 3, maxlength: LIMITS.reportCommentMax, placeholder: t('report.comment') });
  const options = REPORT_REASONS.map(reason =>
    h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'reason', value: reason, required: true }), reasonLabel(reason)));
  const submit = h('button', { class: 'button primary', type: 'submit' }, t('report.submit'));
  const form = h('form', { method: 'dialog', class: 'dialog-form' },
    h('h2', {}, t('report.title')),
    h('p', { class: 'muted' }, t('report.intro')),
    h('fieldset', {}, ...options),
    comment,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, t('common.cancel')),
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
      toast(t('report.thanks'));
    } catch (err) {
      submit.disabled = false;
      toast(err instanceof ApiError ? errorMessage(err.code, err.message) : t('report.failed'));
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
