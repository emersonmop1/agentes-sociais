import { z } from "zod";

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);
export const displayNameSchema = z.string().min(1).max(100).trim();

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;
