import { Readable } from "node:stream";

import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { S3ClientConfig } from "@aws-sdk/client-s3";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "s3-service" });

/**
 * Build the `S3Client` config from environment (#567). When
 * `UPLOAD_S3_ENDPOINT` is set, the client targets an S3-compatible object
 * store (MinIO / Ceph / R2) with path-style addressing per
 * `UPLOAD_S3_FORCE_PATH_STYLE`; unset leaves the AWS-S3 default untouched.
 * Credentials are intentionally NOT read here — they resolve through the AWS
 * SDK credential chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, ~/.aws,
 * IAM role), which keeps the env-parity guard's READ_BY_OTHERS invariant.
 */
export function buildS3ClientConfig(
  env: Pick<
    typeof environment,
    "UPLOAD_S3_REGION" | "UPLOAD_S3_ENDPOINT" | "UPLOAD_S3_FORCE_PATH_STYLE"
  >
): S3ClientConfig {
  return {
    region: env.UPLOAD_S3_REGION,
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(env.UPLOAD_S3_ENDPOINT
      ? {
          endpoint: env.UPLOAD_S3_ENDPOINT,
          forcePathStyle: env.UPLOAD_S3_FORCE_PATH_STYLE,
        }
      : {}),
  };
}

const s3Client = new S3Client(buildS3ClientConfig(environment));

/**
 * Thin wrapper over the AWS S3 SDK for the upload-streaming pipeline.
 * Every method is keyed by `s3Key` so the caller owns the namespace.
 */
export class S3Service {
  /**
   * Generate a presigned PUT URL so the browser can upload bytes directly
   * to S3 without those bytes transiting the API. The returned URL has the
   * configured expiry baked in.
   */
  static async createPresignedPutUrl(
    s3Key: string,
    contentType: string,
    expiresIn: number = environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: environment.UPLOAD_S3_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    logger.debug({ s3Key, expiresIn }, "Created presigned PUT URL");
    return url;
  }

  /**
   * Return a readable byte stream for the object. The stream is unbuffered —
   * callers are expected to pipe it through a parser.
   */
  static async getObjectStream(
    s3Key: string
  ): Promise<{ stream: Readable; contentLength: number }> {
    const command = new GetObjectCommand({
      Bucket: environment.UPLOAD_S3_BUCKET,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error(`Empty response body for S3 key: ${s3Key}`);
    }
    return {
      stream: response.Body as unknown as Readable,
      contentLength: response.ContentLength ?? 0,
    };
  }

  /**
   * Return `{ contentLength, contentType }` when the object exists, or `null`
   * when it does not. The `NotFound` error is swallowed and mapped to null;
   * every other error bubbles so callers can distinguish "missing" from
   * "permissions broken".
   */
  static async headObject(
    s3Key: string
  ): Promise<{ contentLength: number; contentType: string } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: environment.UPLOAD_S3_BUCKET,
        Key: s3Key,
      });
      const response = await s3Client.send(command);
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "name" in error &&
        error.name === "NotFound"
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Best-effort delete. Swallows NotFound; every other error bubbles.
   */
  static async deleteObject(s3Key: string): Promise<void> {
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: environment.UPLOAD_S3_BUCKET,
          Key: s3Key,
        })
      );
      logger.debug({ s3Key }, "Deleted S3 object");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "name" in error &&
        error.name === "NotFound"
      ) {
        return;
      }
      throw error;
    }
  }
}
