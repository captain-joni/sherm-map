import type { Request } from 'express';
import type { z } from 'zod';

// Wirft einen ZodError (-> 400 im Error-Handler), sonst die geparsten Daten
export const body = <S extends z.ZodType>(req: Request, schema: S): z.output<S> => schema.parse(req.body ?? {});
export const query = <S extends z.ZodType>(req: Request, schema: S): z.output<S> => schema.parse(req.query);
export const params = <S extends z.ZodType>(req: Request, schema: S): z.output<S> => schema.parse(req.params);
