// Abfragen und Umwandlung DB-Zeile -> API-Objekt für Sherms
import { existsSync } from 'node:fs';
import type pg from 'pg';
import {
  isProbablyGone, type AdminPhoto, type AdminSherm, type MapSherm, type PublicSherm,
} from '@sherm/shared';
import { preEditPath } from './storage.ts';

// Öffentlich sichtbar heißt: freigegeben und nicht im Papierkorb
export const PUBLIC_WHERE = `m.status = 'approved' AND m.deleted_at IS NULL`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const version = (d: Date | null) => (d ? `?v=${d.getTime().toString(36)}` : '');

export function publicPhotoUrls(storageKey: string, processedAt: Date | null) {
  return {
    thumb: `/media/thumb/${storageKey}.webp${version(processedAt)}`,
    display: `/media/display/${storageKey}.webp${version(processedAt)}`,
  };
}

export function adminPhotoUrls(storageKey: string, processedAt: Date | null) {
  const v = version(processedAt);
  return {
    thumb: `/api/admin/media/thumb/${storageKey}.webp${v}`,
    display: `/api/admin/media/display/${storageKey}.webp${v}`,
    original: `/api/admin/media/original/${storageKey}.jpg${v}`,
  };
}

// Erstes verarbeitetes Foto eines Sherms
const FIRST_PHOTO = `
  LEFT JOIN LATERAL (
    SELECT p.storage_key, p.width, p.height, p.processed_at FROM photos p
    WHERE p.marker_id = m.id AND p.processed_at IS NOT NULL
    ORDER BY p.id LIMIT 1
  ) ph ON true`;

const SHERM_COLUMNS = `
  m.id, m.title, m.description,
  ST_Y(m.location::geometry) AS lat, ST_X(m.location::geometry) AS lng,
  m.country_code, c.name_de AS country_name, m.place_name, m.created_at,
  m.like_count, m.still_there_count, m.gone_count, m.last_confirmed_at`;

export async function listMapSherms(pool: pg.Pool, bbox?: [number, number, number, number]): Promise<MapSherm[]> {
  const params: unknown[] = [];
  let where = PUBLIC_WHERE;
  if (bbox) {
    const [west, south, east, north] = bbox;
    params.push(west, south, east, north);
    // Über die Datumsgrenze (west > east): zwei Rechtecke
    where += west <= east
      ? ` AND m.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`
      : ` AND (m.location && ST_MakeEnvelope($1, $2, 180, $4, 4326)::geography
              OR m.location && ST_MakeEnvelope(-180, $2, $3, $4, 4326)::geography)`;
  }
  const { rows } = await pool.query(`
    SELECT m.id, m.title, ST_Y(m.location::geometry) AS lat, ST_X(m.location::geometry) AS lng,
           ph.storage_key, ph.processed_at
    FROM markers m ${FIRST_PHOTO}
    WHERE ${where}
    ORDER BY m.id`, params);
  return rows.map(r => ({
    id: r.id, title: r.title, lat: r.lat, lng: r.lng,
    thumb: r.storage_key ? publicPhotoUrls(r.storage_key, r.processed_at).thumb : null,
  }));
}

function toPublic(r: Record<string, any>): PublicSherm {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    lat: r.lat,
    lng: r.lng,
    country_code: r.country_code,
    country_name: r.country_name,
    place_name: r.place_name,
    created_at: iso(r.created_at)!,
    photo: r.storage_key
      ? { ...publicPhotoUrls(r.storage_key, r.processed_at), width: r.width, height: r.height }
      : null,
    like_count: r.like_count,
    still_there_count: r.still_there_count,
    gone_count: r.gone_count,
    last_confirmed_at: iso(r.last_confirmed_at),
    probably_gone: isProbablyGone(r as { gone_count: number; still_there_count: number }),
  };
}

export async function getPublicSherm(pool: pg.Pool, id: number): Promise<PublicSherm | null> {
  const { rows } = await pool.query(`
    SELECT ${SHERM_COLUMNS}, ph.storage_key, ph.width, ph.height, ph.processed_at
    FROM markers m
    LEFT JOIN countries c ON c.code = m.country_code
    ${FIRST_PHOTO}
    WHERE ${PUBLIC_WHERE} AND m.id = $1`, [id]);
  return rows[0] ? toPublic(rows[0]) : null;
}


// Admin

const ADMIN_SELECT = `
  SELECT ${SHERM_COLUMNS},
    m.uuid, m.status, m.author, m.reject_reason, m.updated_at, m.reviewed_at, ru.username AS reviewed_by,
    m.deleted_at, m.source_hash,
    (SELECT count(*)::int FROM reports r WHERE r.marker_id = m.id AND r.status = 'open') AS open_reports,
    coalesce((
      SELECT json_agg(json_build_object(
        'id', p.id, 'storage_key', p.storage_key, 'width', p.width, 'height', p.height,
        'starred', p.starred, 'processed_at', p.processed_at) ORDER BY p.id)
      FROM photos p WHERE p.marker_id = m.id
    ), '[]') AS photos,
    count(*) OVER () AS total
  FROM markers m
  LEFT JOIN countries c ON c.code = m.country_code
  LEFT JOIN users ru ON ru.id = m.reviewed_by`;

interface PhotoJson {
  id: number;
  storage_key: string;
  width: number | null;
  height: number | null;
  starred: boolean;
  processed_at: string | null;
}

export function toAdminPhoto(p: PhotoJson): AdminPhoto {
  const processedAt = p.processed_at ? new Date(p.processed_at) : null;
  return {
    id: p.id,
    storage_key: p.storage_key,
    urls: adminPhotoUrls(p.storage_key, processedAt),
    width: p.width,
    height: p.height,
    starred: p.starred,
    processed: processedAt !== null,
    edited: existsSync(preEditPath(p.storage_key)),
  };
}

function toAdmin(r: Record<string, any>): AdminSherm {
  const { photo: _photo, ...base } = toPublic(r);
  return {
    ...base,
    uuid: r.uuid,
    status: r.status,
    author: r.author,
    reject_reason: r.reject_reason,
    updated_at: iso(r.updated_at)!,
    reviewed_at: iso(r.reviewed_at),
    reviewed_by: r.reviewed_by,
    deleted_at: iso(r.deleted_at),
    source_hash: r.source_hash,
    open_reports: r.open_reports,
    photos: (r.photos as PhotoJson[]).map(toAdminPhoto),
  };
}

export interface AdminFilter {
  q?: string;
  status?: string;
  country?: string;
  from?: string;
  to?: string;
  has_photo?: boolean;
  reported?: boolean;
  probably_gone?: boolean;
  deleted?: boolean;
  sort: 'newest' | 'oldest' | 'likes' | 'reports';
  page: number;
  page_size: number;
}

const SORTS = {
  newest: 'm.created_at DESC, m.id DESC',
  oldest: 'm.created_at ASC, m.id ASC',
  likes: 'm.like_count DESC, m.id DESC',
  reports: 'open_reports DESC, m.created_at DESC',
} as const;

export async function listAdminSherms(pool: pg.Pool, f: AdminFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => `$${params.push(value)}`;

  where.push(f.deleted ? 'm.deleted_at IS NOT NULL' : 'm.deleted_at IS NULL');
  if (f.q) {
    const idMatch = f.q.match(/^#?(\d{1,9})$/);
    const like = add(`%${f.q.replace(/[\\%_]/g, c => `\\${c}`)}%`);
    where.push(`(m.search_text ILIKE ${like}${idMatch ? ` OR m.id = ${add(Number(idMatch[1]))}` : ''})`);
  }
  if (f.status) where.push(`m.status = ${add(f.status)}`);
  if (f.country) where.push(`m.country_code = ${add(f.country)}`);
  if (f.from) where.push(`m.created_at >= ${add(f.from)}::date`);
  if (f.to) where.push(`m.created_at < ${add(f.to)}::date + 1`);
  if (f.has_photo !== undefined) {
    where.push(`${f.has_photo ? '' : 'NOT '}EXISTS (SELECT 1 FROM photos p WHERE p.marker_id = m.id)`);
  }
  if (f.reported) where.push(`EXISTS (SELECT 1 FROM reports r WHERE r.marker_id = m.id AND r.status = 'open')`);
  if (f.probably_gone) where.push(`m.gone_count >= 3 AND m.gone_count > 2 * m.still_there_count`);

  const { rows } = await pool.query(`
    ${ADMIN_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY ${SORTS[f.sort]}
    LIMIT ${add(f.page_size)} OFFSET ${add((f.page - 1) * f.page_size)}`, params);

  return {
    items: rows.map(toAdmin),
    total: rows[0] ? Number(rows[0].total) : await countOnly(pool, where, params.slice(0, -2)),
    page: f.page,
    page_size: f.page_size,
  };
}

// Seite hinter dem Ende: Gesamtzahl separat zählen
async function countOnly(pool: pg.Pool, where: string[], params: unknown[]): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM markers m WHERE ${where.join(' AND ')}`, params);
  return rows[0].n;
}

export async function getAdminSherm(db: Pick<pg.Pool, 'query'>, id: number): Promise<AdminSherm | null> {
  const { rows } = await db.query(`${ADMIN_SELECT} WHERE m.id = $1`, [id]);
  return rows[0] ? toAdmin(rows[0]) : null;
}
