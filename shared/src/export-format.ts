// Format des portablen Exports (sherm-export-*.tar.gz). Unabhängig vom DB-Schema, damit Daten
// zwischen App-Versionen und Servern umziehen können. Änderungen nur abwärtskompatibel, sonst
// FORMAT_VERSION erhöhen und den Import für alte Versionen weiter unterstützen.
import { z } from 'zod';

export const EXPORT_FORMAT = 'sherm-export';
export const EXPORT_FORMAT_VERSION = 1;

const timestamp = z.iso.datetime({ offset: true });

export const exportManifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  format_version: z.literal(EXPORT_FORMAT_VERSION),
  created_at: timestamp,
  schema_version: z.string().nullable(),
  counts: z.object({
    sherms: z.number().int(),
    photos: z.number().int(),
    reports: z.number().int(),
    reactions: z.number().int(),
    audit_log: z.number().int(),
  }),
  files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)), // relativer Pfad -> sha256
  missing_photos: z.array(z.string()).default([]), // Fotos, deren Datei beim Export fehlte
});

export const exportPhotoSchema = z.object({
  storage_key: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  file: z.string().regex(/^photos\/[A-Za-z0-9-]+\.[a-z0-9]+$/),
  starred: z.boolean(),
  created_at: timestamp,
});

export const exportShermSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
  properties: z.object({
    uuid: z.uuid(),
    title: z.string(),
    description: z.string().nullable(),
    author: z.string().nullable(),
    status: z.enum(['pending', 'approved', 'rejected', 'hidden']),
    country_code: z.string().nullable(),
    place_name: z.string().nullable(),
    reject_reason: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    reviewed_at: timestamp.nullable(),
    reviewed_by: z.string().nullable(), // Username
    deleted_at: timestamp.nullable(),
    source_hash: z.string().nullable(),
    // Nur zur Info, beim Import werden die Zähler aus reactions neu berechnet
    like_count: z.number().int(),
    still_there_count: z.number().int(),
    gone_count: z.number().int(),
    photos: z.array(exportPhotoSchema),
  }),
});

export const exportShermsSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(exportShermSchema),
});

export const exportReportSchema = z.object({
  uuid: z.uuid(),
  sherm_uuid: z.uuid(),
  reason: z.enum(['privacy', 'illegal', 'offensive', 'spam', 'wrong_location', 'other']),
  comment: z.string().nullable(),
  reporter_hash: z.string().nullable(),
  status: z.enum(['open', 'resolved', 'dismissed']),
  created_at: timestamp,
  resolved_by: z.string().nullable(),
  resolved_at: timestamp.nullable(),
});

export const exportReactionSchema = z.object({
  sherm_uuid: z.uuid(),
  kind: z.enum(['like', 'still_there', 'gone']),
  voter_hash: z.string(),
  created_at: timestamp,
});

export const exportAuditSchema = z.object({
  uuid: z.uuid(),
  username: z.string().nullable(),
  action: z.string(),
  sherm_uuid: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
  created_at: timestamp,
});

export type ExportManifest = z.infer<typeof exportManifestSchema>;
export type ExportSherm = z.infer<typeof exportShermSchema>;
export type ExportReport = z.infer<typeof exportReportSchema>;
export type ExportReaction = z.infer<typeof exportReactionSchema>;
export type ExportAudit = z.infer<typeof exportAuditSchema>;
