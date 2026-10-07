import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';

// Fehler mit Status und einer Meldung, die so an den Client gehen darf
export class HttpError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, message);
export const forbidden = (message = 'Keine Berechtigung') => new HttpError(403, message);
export const unauthorized = (message = 'Nicht eingeloggt') => new HttpError(401, message);
export const conflict = (message: string) => new HttpError(409, message);

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Nicht gefunden' });
};

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: 'Bild ist zu groß',
  LIMIT_FILE_COUNT: 'Nur ein Bild erlaubt',
  LIMIT_UNEXPECTED_FILE: 'Unerwartetes Dateifeld',
};

// Einheitliches Fehlerformat: { error: string, details?: ... }. Interna (Stacktraces, SQL) gehen nie raus.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Ungültige Eingabe', details: z.flattenError(err) });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(err.details === undefined ? { error: err.message } : { error: err.message, details: err.details });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: MULTER_MESSAGES[err.code] ?? 'Ungültiger Upload' });
    return;
  }
  // body-parser (kaputtes JSON, zu groß) setzt status/expose
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status < 500 && err.expose) {
    res.status(status).json({ error: status === 413 ? 'Anfrage zu groß' : 'Ungültige Anfrage' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Serverfehler' });
};
