import { z } from 'zod';
import { AppError } from './errors.js';
import { EMAIL_RE, USERNAME_RE } from './ids.js';

/** Trim + length-bound every string that reaches the database. */
export const text = (max: number, field: string, min = 0) =>
  z
    .string({ invalid_type_error: `${field} is required.` })
    .transform((s) => s.trim())
    .refine((s) => s.length >= min, { message: `${field} must be at least ${min} characters.` })
    .refine((s) => s.length <= max, { message: `${field} must be ${max} characters or fewer.` });

export const emailField = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => EMAIL_RE.test(s), { message: 'Enter a valid email address.' });

export const usernameField = z
  .string()
  .transform((s) => s.trim().replace(/^@+/, '').toLowerCase())
  .refine((s) => USERNAME_RE.test(s), {
    message: 'Usernames start with a letter, then 2-23 letters, numbers, _ or -.',
  });

export const isoDate = z
  .union([z.string(), z.date()])
  .transform((v, ctx) => {
    const d = v instanceof Date ? v : new Date(String(v).trim());
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date and time.' });
      return z.NEVER;
    }
    return d.toISOString();
  });

export const optionalIsoDate = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const d = v instanceof Date ? v : new Date(String(v).trim());
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date and time.' });
      return z.NEVER;
    }
    return d.toISOString();
  });

export const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'on', 'yes'].includes(v.toLowerCase())));

export const intIn = (lo: number, hi: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? v : Number.parseInt(String(v).trim(), 10)))
    .refine((n) => Number.isFinite(n), { message: 'Enter a number.' })
    .refine((n) => n >= lo && n <= hi, { message: `Enter a number between ${lo} and ${hi}.` });

/** Validate and flatten, turning Zod issues into one AppError the UI can render. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({
    field: i.path.join('.') || '_',
    message: i.message,
  }));
  const first = issues[0];
  throw new AppError(400, 'validation_failed', first.message, {
    field: first.field,
    meta: { issues },
  });
}

export function issueList(err: unknown): { field: string; message: string }[] {
  if (err instanceof AppError && Array.isArray(err.meta?.issues)) {
    return err.meta.issues as { field: string; message: string }[];
  }
  return [];
}
