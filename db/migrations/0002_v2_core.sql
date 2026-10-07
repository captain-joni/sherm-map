-- v2 Datenmodell: Status statt validated, Fotos als eigene Tabelle, Rollen, Sessions,
-- Audit-Log, Meldungen und Reaktionen. Bestehende Daten werden übernommen.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE marker_status AS ENUM ('pending', 'approved', 'rejected', 'hidden');
CREATE TYPE user_role AS ENUM ('moderator', 'admin');
CREATE TYPE report_reason AS ENUM ('privacy', 'illegal', 'offensive', 'spam', 'wrong_location', 'other');
CREATE TYPE report_status AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE reaction_kind AS ENUM ('like', 'still_there', 'gone');


-- users: Rolle als Enum (alle bisherigen User sind Admins), Zeitstempel mit Zeitzone
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users
  ALTER COLUMN role TYPE user_role
    USING (CASE WHEN role = 'moderator' THEN 'moderator' ELSE 'admin' END)::user_role,
  ALTER COLUMN role SET DEFAULT 'moderator',
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN created_at TYPE timestamptz USING COALESCE(created_at, now()::timestamp) AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN last_login_at timestamptz;


-- markers
ALTER TABLE markers
  ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid(),  -- stabile ID für Export/Import
  ADD COLUMN status marker_status NOT NULL DEFAULT 'pending',
  ADD COLUMN country_code text,
  ADD COLUMN place_name text,
  ADD COLUMN reject_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamptz,                         -- Soft Delete, wiederherstellbar
  ADD COLUMN like_count integer NOT NULL DEFAULT 0,          -- Zähler pflegt der Trigger auf reactions
  ADD COLUMN still_there_count integer NOT NULL DEFAULT 0,
  ADD COLUMN gone_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_confirmed_at timestamptz,
  ADD COLUMN source_hash text,                               -- gehashte IP/Gerät des Einsenders, nie die IP selbst
  ADD CONSTRAINT markers_uuid_key UNIQUE (uuid);

-- Alte Zeitstempel sind TIMESTAMP ohne Zeitzone, geschrieben in UTC (Default-Zeitzone des Containers)
ALTER TABLE markers
  ALTER COLUMN created_at TYPE timestamptz USING COALESCE(created_at, now()::timestamp) AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

UPDATE markers SET
  status = (CASE WHEN validated THEN 'approved' ELSE 'pending' END)::marker_status,
  updated_at = created_at;

ALTER TABLE markers ADD COLUMN search_text text GENERATED ALWAYS AS (
  coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(place_name, '')
) STORED;

CREATE INDEX markers_location_idx ON markers USING gist (location);
CREATE INDEX markers_status_created_idx ON markers (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX markers_search_idx ON markers USING gin (search_text gin_trgm_ops);


-- photos: ein Foto pro Sherm in der App, die Tabelle erlaubt später mehrere
CREATE TABLE photos (
  id serial PRIMARY KEY,
  marker_id integer NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,   -- Dateiname ohne Endung in uploads/{original,display,thumb}/
  legacy_path text,                   -- alter Pfad (/uploads/<datei>), bis das Bild neu verarbeitet ist
  width integer,
  height integer,
  bytes integer,                      -- Größe des Originals
  sha256 text,                        -- Hash des Originals
  processed_at timestamptz,           -- NULL = Varianten fehlen noch (reprocess-images)
  starred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_marker_id_idx ON photos (marker_id);
CREATE INDEX photos_unprocessed_idx ON photos (id) WHERE processed_at IS NULL;

INSERT INTO photos (marker_id, storage_key, legacy_path, created_at)
SELECT id, gen_random_uuid()::text, image_path, created_at
FROM markers
WHERE image_path IS NOT NULL AND image_path <> '';

ALTER TABLE markers DROP COLUMN validated, DROP COLUMN image_path;


-- sessions: gespeichert wird nur der Hash des Cookie-Tokens
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);


-- audit_log: marker_id bewusst ohne FK, Einträge sollen gelöschte Sherms überleben
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  username text,                      -- Snapshot, bleibt lesbar wenn der User gelöscht wird
  action text NOT NULL,
  marker_id integer,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_marker_id_idx ON audit_log (marker_id);


-- reports
CREATE TABLE reports (
  id serial PRIMARY KEY,
  uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  marker_id integer NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  reason report_reason NOT NULL,
  comment text,
  reporter_hash text,
  status report_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz
);
CREATE INDEX reports_open_idx ON reports (marker_id) WHERE status = 'open';


-- reactions: eine Reaktion pro Art und Gerät; Zähler auf markers per Trigger
CREATE TABLE reactions (
  marker_id integer NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  kind reaction_kind NOT NULL,
  voter_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marker_id, kind, voter_hash)
);

CREATE FUNCTION reactions_update_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r reactions;
  delta integer;
BEGIN
  IF TG_OP = 'INSERT' THEN r := NEW; delta := 1; ELSE r := OLD; delta := -1; END IF;

  UPDATE markers SET
    like_count        = like_count        + CASE WHEN r.kind = 'like'        THEN delta ELSE 0 END,
    still_there_count = still_there_count + CASE WHEN r.kind = 'still_there' THEN delta ELSE 0 END,
    gone_count        = gone_count        + CASE WHEN r.kind = 'gone'        THEN delta ELSE 0 END,
    last_confirmed_at = CASE
      WHEN delta = 1 AND r.kind = 'still_there' THEN GREATEST(last_confirmed_at, r.created_at)
      ELSE last_confirmed_at END
  WHERE id = r.marker_id;

  RETURN NULL;
END $$;

CREATE TRIGGER reactions_counts
  AFTER INSERT OR DELETE ON reactions
  FOR EACH ROW EXECUTE FUNCTION reactions_update_counts();
