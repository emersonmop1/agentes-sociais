/**
 * AES-256-GCM encrypt/decrypt for at-rest secrets (OAuth tokens, etc.).
 *
 * Format:
 *   ciphertext = base64( iv (12B) ‖ ciphertext ‖ authTag (16B) )
 *
 * The encryption key comes from ENCRYPTION_KEY (32-byte hex, 64 chars).
 * Never log plaintext. Never expose decrypted tokens beyond the immediate
 * Graph/YouTube/Drive call.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadEnv } from "../env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;       // 96-bit IV recommended for GCM
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  const env = loadEnv();
  if (env.ENCRYPTION_KEY.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  _key = Buffer.from(env.ENCRYPTION_KEY, "hex");
  return _key;
}

export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function decryptString(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Optional: compare two strings in constant time without leaking lengths. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
