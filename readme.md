## Sherm Map

Eine öffentliche Karte aller Sherms: https://map.sherm.fun

- **Karte (PWA):** Sherms ansehen (gruppiert beim Rauszoomen), suchen (Sherms und Orte) und „In meiner Nähe“ anzeigen. Liken, „Noch da?“ bestätigen, teilen (mit Link-Vorschau) und melden.
- **Eintragen:** Standort per GPS oder auf der Karte, Foto direkt mit der Kamera, Titel – fertig. Ohne Netz wird der Eintrag gespeichert und später automatisch hochgeladen. Aus Fotos werden alle Metadaten (GPS, Kamera) entfernt.
- **Admin (`/admin`):**
  - Übersicht mit Kennzahlen
  - Prüf-Warteschlange (Tastatur oder Wischen)
  - Bearbeiten inkl. Ort verschieben und Gesichter/Kennzeichen verpixeln
  - Suche, Galerie mit Favoriten-Download, Meldungen, Verlauf (Audit-Log)
  - Moderatoren-Accounts, Export

Neue Sherms sind erst sichtbar, wenn ein Moderator sie geprüft hat.

### Technik

TypeScript überall: Express 5 + PostgreSQL/PostGIS im Backend, Vite + Leaflet im Frontend (ohne Framework), Docker Compose hinter Traefik.

### Doku

- `CLAUDE.md` – Aufbau, Konventionen, lokal starten
- `docs/api.md` – API
- `docs/operations.md` – Backups, Wiederherstellen, Export/Import, Migrationen, Umstieg v1 → v2
- `rebuild.md` – Plan und Status des Rebuilds, offene Fragen
