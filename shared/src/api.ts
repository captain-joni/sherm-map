// API-Vertrag zwischen Backend und Frontend: Grenzwerte, Enums, Eingabe-Schemas und Antworttypen.
import { z } from 'zod';
import { LIMITS, REACTION_KINDS, REPORT_REASONS, REPORT_STATUSES, SHERM_STATUSES, USER_ROLES, type ShermStatus, type UserRole } from './constants.ts';

export * from './constants.ts';

// Hilfen

// Steuerzeichen raus (Postgres mag z.B. \u0000 nicht), Zeilenumbrüche bleiben, außen trimmen
const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

const text = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max));
const requiredText = (max: number) => z.string().transform(cleanText).pipe(z.string().min(1).max(max));
// Fehlt das Feld, ist es leer oder null -> null. nullish() statt union, sonst gilt der Key in zod 4 als Pflicht.
const optionalText = (max: number) =>
  z.string().nullish()
    .transform(v => (v == null ? null : cleanText(v) || null))
    .pipe(z.string().max(max).nullable());

// Formularfelder kommen als String, JSON als Zahl: beides akzeptieren
const latitude = z.coerce.number().finite().min(-90).max(90);
const longitude = z.coerce.number().finite().min(-180).max(180);
const id = z.coerce.number().int().positive().max(2_147_483_647);

const booleanish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform(v => v === true || v === 'true' || v === '1');


// Öffentliche Eingaben

export const idParam = z.object({ id });

export const createShermInput = z.object({
  uuid: z.uuid(), // vom Client erzeugt, macht Wiederholungen (Offline-Queue) idempotent
  title: requiredText(LIMITS.titleMax),
  description: optionalText(LIMITS.descriptionMax),
  lat: latitude,
  lng: longitude,
  website: z.string().optional(), // Honeypot: Menschen sehen das Feld nicht, Bots füllen es aus
});

export const bboxQuery = z.object({
  bbox: z.string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .transform(v => v.split(',').map(Number) as [number, number, number, number]) // west,south,east,north
    .optional(),
});

export const reactionInput = z.object({
  kind: z.enum(REACTION_KINDS),
  device_id: z.uuid().optional(),
});

export const reactionParams = z.object({ id, kind: z.enum(REACTION_KINDS) });

export const reportInput = z.object({
  reason: z.enum(REPORT_REASONS),
  comment: optionalText(LIMITS.reportCommentMax),
});

export const geocodeQuery = z.object({
  q: text(200).pipe(z.string().min(2)),
});


// Auth

export const loginInput = z.object({
  username: z.string().max(LIMITS.usernameMax),
  password: z.string().max(LIMITS.passwordMax),
});

export const newPassword = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

export const changePasswordInput = z.object({
  current_password: z.string().max(LIMITS.passwordMax),
  new_password: newPassword,
});


// Admin

export const SHERM_SORTS = ['newest', 'oldest', 'likes', 'reports'] as const;

export const shermListQuery = z.object({
  q: text(200).optional(),
  status: z.enum(SHERM_STATUSES).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  has_photo: booleanish.optional(),
  reported: booleanish.optional(),     // nur mit offenen Meldungen
  probably_gone: booleanish.optional(),
  deleted: booleanish.optional(),      // Papierkorb statt aktive Sherms
  sort: z.enum(SHERM_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50),
});

export const shermEditInput = z.object({
  title: requiredText(LIMITS.titleMax).optional(),
  description: optionalText(LIMITS.descriptionMax).optional(),
  place_name: optionalText(LIMITS.placeNameMax).optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
}).refine(v => (v.lat === undefined) === (v.lng === undefined), 'lat und lng nur zusammen ändern');

// reopen: Prüfung zurücknehmen, der Sherm ist wieder pending (für versehentliche Freigaben/Ablehnungen)
export const SHERM_ACTIONS = ['approve', 'reject', 'hide', 'reopen', 'delete', 'restore'] as const;
export type ShermAction = (typeof SHERM_ACTIONS)[number];

export const shermActionInput = z.object({
  reason: optionalText(LIMITS.rejectReasonMax).optional(), // bei reject
});

export const bulkActionInput = z.object({
  ids: z.array(id).min(1).max(500),
  action: z.enum(SHERM_ACTIONS),
  reason: optionalText(LIMITS.rejectReasonMax).optional(),
});

export const photoListQuery = z.object({
  status: z.enum(SHERM_STATUSES).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  starred: booleanish.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(60),
});

export const starInput = z.object({ starred: z.boolean() });

export const reportListQuery = z.object({
  status: z.enum(REPORT_STATUSES).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50),
});

export const resolveReportInput = z.object({
  status: z.enum(['resolved', 'dismissed']),
});

export const auditListQuery = z.object({
  user: z.string().max(LIMITS.usernameMax).optional(),
  action: z.string().max(50).optional(),
  sherm_id: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(100),
});

export const createUserInput = z.object({
  username: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,50}$/, 'Nur Buchstaben, Zahlen, . _ - (3–50 Zeichen)'),
  role: z.enum(USER_ROLES),
});

export const updateUserInput = z.object({
  role: z.enum(USER_ROLES).optional(),
  disabled: z.boolean().optional(),
});


// Antworttypen

export interface PhotoUrls {
  thumb: string;
  display: string;
}

/** Kompakter Eintrag für die Karte */
export interface MapSherm {
  id: number;
  title: string;
  lat: number;
  lng: number;
  thumb: string | null;
}

export interface PublicSherm {
  id: number;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  country_code: string | null;
  country_name: string | null;
  place_name: string | null;
  created_at: string;
  photo: (PhotoUrls & { width: number | null; height: number | null }) | null;
  like_count: number;
  still_there_count: number;
  gone_count: number;
  last_confirmed_at: string | null;
  probably_gone: boolean;
}

export interface AdminPhoto {
  id: number;
  storage_key: string;
  urls: PhotoUrls & { original: string };
  width: number | null;
  height: number | null;
  starred: boolean;
  processed: boolean;
  edited: boolean;
}

export interface AdminSherm extends Omit<PublicSherm, 'photo'> {
  uuid: string;
  status: ShermStatus;
  author: string | null;
  reject_reason: string | null;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  deleted_at: string | null;
  source_hash: string | null;
  open_reports: number;
  photos: AdminPhoto[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
  must_change_password: boolean;
}

export interface GeocodeResult {
  name: string;
  detail: string | null;
  lat: number;
  lng: number;
}
