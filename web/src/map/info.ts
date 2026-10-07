// "Über"-Dialog mit Links und Datenschutzhinweisen
import { X } from 'lucide';
import { h, icon } from '../lib/dom.ts';

export function openInfo(onClose: () => void): void {
  const dialog = h('dialog', { class: 'dialog info' },
    h('button', { class: 'icon-button dialog-close', type: 'button', 'aria-label': 'Schließen', onclick: () => dialog.close() }, icon(X)),
    h('h2', {}, 'Sherm Map'),
    h('p', {}, 'Alle Sherms auf einer Karte. Jede*r kann Sherms eintragen; sie erscheinen, sobald wir sie geprüft haben.'),
    h('nav', { class: 'info-links' },
      h('a', { href: 'https://www.sherm.fun', target: '_blank', rel: 'noopener' }, 'Über Sherm'),
      h('a', { href: 'https://www.sherm.fun/impressum', target: '_blank', rel: 'noopener' }, 'Impressum')),
    h('h3', {}, 'Datenschutz'),
    // ENTWURF: technische Beschreibung, muss vor dem Livegang rechtlich geprüft und ergänzt werden
    h('ul', { class: 'info-privacy' },
      h('li', {}, 'Beim Eintragen speichern wir Titel, Beschreibung, Ort und Foto. Aus dem Foto entfernen wir alle Metadaten (z.B. GPS-Position und Kamera) – schon auf deinem Gerät und noch einmal auf dem Server.'),
      h('li', {}, 'Deine IP-Adresse speichern wir nicht. Gegen Spam speichern wir nur einen verschlüsselten, nicht umkehrbaren Wert davon.'),
      h('li', {}, 'Für „Gefällt mir“ und „Noch da?“ erzeugt dein Browser eine zufällige Kennung, die nur in deinem Browser liegt. Ein Konto gibt es nicht.'),
      h('li', {}, 'Dein Standort wird nur verwendet, wenn du es antippst, und nur auf deinem Gerät – außer du trägst damit einen Sherm ein.'),
      h('li', {}, 'Die Karte kommt von OpenStreetMap; dabei sieht der Kartenserver deine IP-Adresse. Die Ortssuche läuft über unseren Server zu Photon (komoot), ohne deine IP weiterzugeben.')));
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose();
  });
  document.body.append(dialog);
  dialog.showModal();
}
