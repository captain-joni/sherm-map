import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

function limiter(windowMinutes: number, limit: number, message: string): RequestHandler {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
  });
}

// Pro App-Instanz eigene Zähler (In-Memory). scale > 1 lockert alle Limits (Tests).
export function createRateLimits(scale = 1) {
  return {
    submit: limiter(60, 20 * scale, 'Zu viele Sherms auf einmal, bitte später nochmal'),
    reaction: limiter(60, 120 * scale, 'Zu viele Reaktionen, bitte später nochmal'),
    report: limiter(60, 10 * scale, 'Zu viele Meldungen, bitte später nochmal'),
    login: limiter(15, 10 * scale, 'Zu viele Login-Versuche, bitte später nochmal'),
    geocode: limiter(1, 30 * scale, 'Zu viele Suchanfragen, kurz warten'),
  };
}
