/**
 * AES-256-GCM encryption utilities for securing sensitive data at rest.
 *
 * Used primarily for encrypting connector instance credentials before
 * persisting them to the database.
 */

import crypto from "crypto";
import { environment } from "../environment.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/** Shape of the encrypted payload stored in the database. */
interface EncryptedPayload {
  /** Base64-encoded initialisation vector (unique per record). */
  iv: string;
  /** Base64-encoded GCM authentication tag. */
  authTag: string;
  /** Base64-encoded ciphertext. */
  data: string;
  /** Key version — enables future key rotation. */
  v: number;
}

/**
 * Derive the 32-byte encryption key from the environment.
 * Throws at call-time if the key is missing or invalid.
 */
function getKey(): Buffer {
  const raw = environment.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not configured. Generate one with: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length})`
    );
  }
  return key;
}

/**
 * Encrypt a plain-text credentials object into an opaque string
 * suitable for storage in a `text` column.
 */
export function encryptCredentials(
  data: Record<string, unknown>
): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(JSON.stringify(data), "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  const payload: EncryptedPayload = {
    iv: iv.toString("base64"),
    authTag,
    data: encrypted,
    v: 1,
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt a previously-encrypted credentials blob back into a
 * plain-text object.
 */
export function decryptCredentials(
  blob: string
): Record<string, unknown> {
  const key = getKey();
  const { iv, authTag, data } = JSON.parse(blob) as EncryptedPayload;

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted) as Record<string, unknown>;
}
