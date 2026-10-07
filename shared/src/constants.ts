// Konstanten und Typen ohne zod: kann das Frontend importieren, ohne zod ins Bundle zu ziehen
// (import { ... } from '@sherm/shared/constants').

export const LIMITS = {
  titleMax: 100,
  descriptionMax: 1000,
  placeNameMax: 120,
  reportCommentMax: 500,
  rejectReasonMax: 300,
  imageMaxBytes: 15 * 1024 * 1024,
  usernameMax: 50,
  passwordMin: 12,
  passwordMax: 200,
  pageSizeMax: 200,
} as const;

export const SHERM_STATUSES = ['pending', 'approved', 'rejected', 'hidden'] as const;
export const USER_ROLES = ['moderator', 'admin'] as const;
export const REPORT_REASONS = ['privacy', 'illegal', 'offensive', 'spam', 'wrong_location', 'other'] as const;
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export const REACTION_KINDS = ['like', 'still_there', 'gone'] as const;
export const IMAGE_VARIANTS = ['display', 'thumb'] as const; // öffentlich; 'original' nur für Admins

export type ShermStatus = (typeof SHERM_STATUSES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReactionKind = (typeof REACTION_KINDS)[number];

// "Wahrscheinlich weg": mindestens 3 Weg-Stimmen und mehr als doppelt so viele wie "noch da"
export const PROBABLY_GONE = { minGone: 3, ratio: 2 } as const;
export function isProbablyGone(s: { gone_count: number; still_there_count: number }): boolean {
  return s.gone_count >= PROBABLY_GONE.minGone && s.gone_count > PROBABLY_GONE.ratio * s.still_there_count;
}

// Fehlercodes der API ({ error, code }): das Frontend übersetzt anhand des Codes, "error" ist der deutsche Text
export const ERROR_CODES = [
  'invalid_input', 'bad_request', 'not_found', 'unauthorized', 'forbidden', 'conflict',
  'invalid_image', 'unsupported_image', 'image_failed', 'image_too_large', 'invalid_upload',
  'rate_limited', 'geocoder_unavailable', 'server_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

