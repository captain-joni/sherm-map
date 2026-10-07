// "Über"-Dialog: Links, Sprache, Datenschutzhinweise
import { X } from 'lucide';
import { h, icon } from '../lib/dom.ts';
import { lang, setLang, t, type Lang } from '../lib/i18n.ts';

export function openInfo(onClose: () => void): void {
  const langButton = (value: Lang, label: string) =>
    h('button', { type: 'button', 'aria-pressed': String(lang === value), onclick: () => { if (lang !== value) setLang(value); } }, label);

  const dialog = h('dialog', { class: 'dialog info' },
    h('button', { class: 'icon-button dialog-close', type: 'button', 'aria-label': t('common.close'), onclick: () => dialog.close() }, icon(X)),
    h('h2', {}, t('app.title')),
    h('p', {}, t('info.text')),
    h('nav', { class: 'info-links' },
      h('a', { href: 'https://www.sherm.fun', target: '_blank', rel: 'noopener' }, t('info.about')),
      h('a', { href: 'https://www.sherm.fun/impressum', target: '_blank', rel: 'noopener' }, t('info.imprint'))),
    h('div', { class: 'info-lang' },
      h('span', {}, t('info.language')),
      h('div', { class: 'segmented', role: 'group', 'aria-label': t('info.language') }, langButton('de', 'Deutsch'), langButton('en', 'English'))),
    h('h3', {}, t('info.privacy')),
    // ENTWURF: technische Beschreibung, muss vor dem Livegang rechtlich geprüft und ergänzt werden
    h('ul', { class: 'info-privacy' },
      h('li', {}, t('privacy.1')),
      h('li', {}, t('privacy.2')),
      h('li', {}, t('privacy.3')),
      h('li', {}, t('privacy.4')),
      h('li', {}, t('privacy.5'))));
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose();
  });
  document.body.append(dialog);
  dialog.showModal();
}
