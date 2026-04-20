import { Readable } from "node:stream";

import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "s3-service" });

const s3Client = new S3Client({
  region: environment.UPLOAD_S3_REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

export class S3Service {
  /**
   * Generate a presigned PUT URL for browser-to-S3 upload.
   */
  static async createPresignedUpload(
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
    logger.debug({ s3Key, expiresIn }, "Created presigned upload URL");
    return url;
  }

  /**
   * Get a readable stream for an S3 object.
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
   * Check if an object exists in S3 and return its metadata.
   * Returns null if the object does not exist.
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
}
