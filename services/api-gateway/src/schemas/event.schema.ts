import { z } from 'zod';

// User event schema
export const UserEventSchema = z.object({
  type: z.enum([
    'page_view',
    'form_submit',
    'button_click',
    'video_watch',
    'download',
    'purchase',
    'signup',
    'login',
    'custom',
  ]),
  userId: z.string().optional(),
  email: z.string().email().optional(),
  anonymousId: z.string().optional(),
  properties: z.record(z.any()).optional(),
  context: z.object({
    page: z.object({
      url: z.string().url(),
      title: z.string().optional(),
      referrer: z.string().optional(),
    }).optional(),
    userAgent: z.string().optional(),
    ip: z.string().optional(),
    locale: z.string().optional(),
  }).optional(),
  timestamp: z.number().or(z.string()).optional(),
}).refine(
  (data) => data.userId || data.email || data.anonymousId,
  {
    message: 'At least one of userId, email, or anonymousId must be provided',
  }
);

export type UserEvent = z.infer<typeof UserEventSchema>;

// Batch events schema
export const BatchEventsSchema = z.object({
  events: z.array(UserEventSchema).min(1).max(100),
});

export type BatchEvents = z.infer<typeof BatchEventsSchema>;

// Auth schemas
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
