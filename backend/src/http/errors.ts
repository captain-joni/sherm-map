import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ErrorCode } from '@sherm/shared/constants';

// Fehler mit Status und einer Meldung, die so an den Client gehen darf
const DEFAULT_CODES: Record<number, ErrorCode> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 429: 'rate_limited',
};

// Fehler mit Status, einer Meldung, die so an den Client gehen darf, und einem Code zum Übersetzen
export class HttpError extends Error {
  status: number;
  details: unknown;
  code: ErrorCode;

  constructor(status: number, message: string, details?: unknown, code?: ErrorCode) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code ?? DEFAULT_CODES[status] ?? 'server_error';
  }
}

export const badRequest = (message: string, details?: unknown, code?: ErrorCode) => new HttpError(400, message, details, code);
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, message);
export const forbidden = (message = 'Keine Berechtigung') => new HttpError(403, message);
export const unauthorized = (message = 'Nicht eingeloggt') => new HttpError(401, message);
export const conflict = (message: string) => new HttpError(409, message);

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Nicht gefunden', code: 'not_found' });
};

const MULTER_ERRORS: Record<string, [string, ErrorCode]> = {
  LIMIT_FILE_SIZE: ['Bild ist zu groß', 'image_too_large'],
  LIMIT_FILE_COUNT: ['Nur ein Bild erlaubt', 'invalid_upload'],
  LIMIT_UNEXPECTED_FILE: ['Unerwartetes Dateifeld', 'invalid_upload'],
};

// Einheitliches Fehlerformat: { error: string, details?: ... }. Interna (Stacktraces, SQL) gehen nie raus.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Ungültige Eingabe', code: 'invalid_input', details: z.flattenError(err) });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.details === undefined ? {} : { details: err.details }) });
    return;
  }
  if (err instanceof multer.MulterError) {
    const [error, code] = MULTER_ERRORS[err.code] ?? ['Ungültiger Upload', 'invalid_upload'];
    res.status(400).json({ error, code });
    return;
  }
  // body-parser (kaputtes JSON, zu groß) setzt status/expose
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status < 500 && err.expose) {
    res.status(status).json({ error: status === 413 ? 'Anfrage zu groß' : 'Ungültige Anfrage', code: 'bad_request' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Serverfehler', code: 'server_error' });
};
