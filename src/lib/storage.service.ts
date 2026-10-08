import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import httpStatus from "http-status";
import { appError } from "../utils/appError";
import { logger } from "./logger";
import { cloudinary } from "./cloudinary";
import env from "../config/env";

/**
 * File storage for the document approval module.
 *
 * The rest of the module only talks to this service, so switching from
 * Cloudinary to S3 / Cloudflare R2 / Azure Blob later is a provider swap, not a
 * rewrite.
 *
 * Provider selection is automatic:
 *   - CLOUDINARY   when CLOUDINARY_* credentials are configured. Assets are
 *                  uploaded as `type: "authenticated"`, which makes them
 *                  private: only a time-limited signed URL can read them.
 *   - LOCAL_SECURE otherwise — files land in `var/storage/` and are only ever
 *                  reachable through the authorised download endpoint, never
 *                  through a public static path.
 */

export type StorageProviderValue = "CLOUDINARY" | "LOCAL_SECURE";
export type StorageResourceType = "raw" | "image";

export interface StoredAsset {
  provider: StorageProviderValue;
  /** Backend-generated id: Cloudinary public_id or local relative path. */
  storageId: string;
  /** Display URL. Company documents are still served through the API. */
  url: string;
  resourceType: StorageResourceType;
  format: string | null;
  bytes: number;
  /** SHA-256 of the uploaded bytes — used for signature snapshots and integrity. */
  checksum: string;
}

export interface StoredAssetRef {
  provider: StorageProviderValue;
  storageId: string;
  resourceType: string;
}

export interface DownloadTarget {
  /** Cloudinary signed URL, or an absolute local path to stream from. */
  url?: string;
  localPath?: string;
  contentType: string;
  fileName: string;
  byteLength: number;
}

const LOCAL_ROOT = path.join(process.cwd(), "var", "storage");

/** Signed Cloudinary URLs expire quickly — long enough for one download only. */
const SIGNED_URL_TTL_SECONDS = 120;

export function isCloudinaryConfigured(): boolean {
  return Boolean(env.cloudinary_cloud_name && env.cloudinary_api_key && env.cloudinary_api_secret);
}

export function activeProvider(): StorageProviderValue {
  return isCloudinaryConfigured() ? "CLOUDINARY" : "LOCAL_SECURE";
}

export function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Builds a backend-owned storage id. User-supplied filenames are never used as
 * a path — only a random id is:
 *
 *   documents/DOC-2026-00042/v1/source-<uuid>
 *   signatures/users/7/signature-<uuid>
 *
 * The file extension is deliberately NOT part of the id. Cloudinary derives
 * (and appends) the extension itself for image assets, so baking it in would
 * make the stored public_id and the id we later request disagree — every read
 * would 404. Content type is served from the database, so nothing is lost.
 */
export function buildStorageId(scope: string): string {
  return `${scope.replace(/^\/+|\/+$/g, "")}/${randomUUID()}`;
}

function resolveResourceType(
  declared: StorageResourceType,
  mimeType: string,
): StorageResourceType {
  if (declared === "image") return "image";
  // Documents are stored as raw so Cloudinary never tries to transform them.
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml" ? "image" : "raw";
}

function localPathFor(storageId: string): string {
  const absolute = path.resolve(LOCAL_ROOT, storageId);
  // Path traversal guard: the resolved path must remain inside LOCAL_ROOT.
  if (!absolute.startsWith(path.resolve(LOCAL_ROOT) + path.sep)) {
    throw appError("Invalid storage path", httpStatus.BAD_REQUEST);
  }
  return absolute;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

function uploadToCloudinary(
  buffer: Buffer,
  storageId: string,
  resourceType: StorageResourceType,
  originalName: string,
): Promise<StoredAsset> {
  const declaredFormat = (path.extname(originalName) || "").replace(/^\./, "").toLowerCase() || null;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: storageId,
        resource_type: resourceType,
        // `authenticated` assets are not publicly readable — every read needs a
        // signed URL, which is only ever generated after an authz check.
        type: "authenticated",
        // REQUIRED for signed delivery: without an `acl` at upload time
        // Cloudinary cannot validate the expiration and rejects the signed URL
        // with 401. `*` means "any signed request is acceptable"; the signature
        // itself (plus the short expiry) is what actually gates access.
        acl: "*",
        overwrite: false,
        unique_filename: false,
        invalidate: true,
      },
      (error, result) => {
        if (error || !result) {
          logger.error({ err: error, storageId }, "cloudinary upload failed");
          reject(appError("Failed to store the uploaded file", httpStatus.BAD_GATEWAY));
          return;
        }
        resolve({
          provider: "CLOUDINARY",
          storageId: result.public_id,
          url: result.secure_url,
          resourceType,
          format: result.format ?? declaredFormat,
          bytes: result.bytes ?? buffer.length,
          checksum: sha256(buffer),
        });
      },
    );
    stream.end(buffer);
  });
}

async function uploadToLocalDisk(
  buffer: Buffer,
  storageId: string,
  resourceType: StorageResourceType,
  originalName: string,
): Promise<StoredAsset> {
  const absolute = localPathFor(storageId);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, buffer);

  return {
    provider: "LOCAL_SECURE",
    storageId,
    url: `/api/v1/documents/files/${storageId}`,
    resourceType,
    format: (path.extname(originalName) || "").replace(/^\./, "").toLowerCase() || null,
    bytes: buffer.length,
    checksum: sha256(buffer),
  };
}

/**
 * Stores an in-memory upload and returns the backend-generated asset reference.
 * Callers persist `storageId` + `url`; bytes are later served through
 * `resolveDownload` only after an authorisation check.
 */
export async function storeBuffer(
  buffer: Buffer,
  scope: string,
  originalName: string,
  mimeType: string,
  declaredResourceType: StorageResourceType = "raw",
): Promise<StoredAsset> {
  if (!buffer.length) {
    throw appError("The uploaded file is empty", httpStatus.BAD_REQUEST);
  }
  const resourceType = resolveResourceType(declaredResourceType, mimeType);
  const storageId = buildStorageId(scope);

  if (isCloudinaryConfigured()) {
    return uploadToCloudinary(buffer, storageId, resourceType, originalName);
  }
  return uploadToLocalDisk(buffer, storageId, resourceType, originalName);
}

// ─── Download ─────────────────────────────────────────────────────────────────

function signedUrlFor(asset: StoredAssetRef, attachment?: string): string {
  return cloudinary.url(asset.storageId, {
    resource_type: asset.resourceType as StorageResourceType,
    type: "authenticated",
    secure: true,
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
    ...(attachment ? { attachment } : {}),
  } as never);
}

/**
 * Resolves a stored asset to something the controller can stream or redirect
 * to. Call this ONLY after verifying the requester's permission on the owning
 * document — this function performs no authorisation itself.
 */
export async function resolveDownload(
  asset: StoredAssetRef,
  fileName: string,
  mimeType: string,
): Promise<DownloadTarget> {
  if (asset.provider === "CLOUDINARY") {
    if (!isCloudinaryConfigured()) {
      throw appError(
        "This file is stored in Cloudinary but the server has no Cloudinary credentials configured",
        httpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      url: signedUrlFor(asset, fileName),
      contentType: mimeType,
      fileName,
      byteLength: 0,
    };
  }

  const absolute = localPathFor(asset.storageId);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("not a regular file");
    return { localPath: absolute, contentType: mimeType, fileName, byteLength: stat.size };
  } catch {
    throw appError("The stored file could not be found", httpStatus.NOT_FOUND);
  }
}

/** Reads a stored asset back into memory (used by the final PDF generator). */
export async function readStoredAsset(asset: StoredAssetRef): Promise<Buffer> {
  if (asset.provider === "LOCAL_SECURE") {
    return fs.readFile(localPathFor(asset.storageId));
  }
  if (!isCloudinaryConfigured()) {
    throw appError("Cloudinary credentials are not configured", httpStatus.SERVICE_UNAVAILABLE);
  }
  const response = await fetch(signedUrlFor(asset));
  if (!response.ok) {
    logger.error({ status: response.status, storageId: asset.storageId }, "cloudinary download failed");
    throw appError("The stored file could not be retrieved from storage", httpStatus.BAD_GATEWAY);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function openLocalStream(absolutePath: string): Readable {
  return createReadStream(absolutePath);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Removes an asset. Used when a draft is abandoned or a source file replaced. */
export async function deleteStoredAsset(asset: StoredAssetRef): Promise<void> {
  try {
    if (asset.provider === "CLOUDINARY") {
      if (!isCloudinaryConfigured()) return;
      await cloudinary.uploader.destroy(asset.storageId, {
        resource_type: asset.resourceType as StorageResourceType,
        type: "authenticated",
        invalidate: true,
      });
      return;
    }
    await fs.unlink(localPathFor(asset.storageId));
  } catch (error) {
    // Cleanup failures must never fail the caller's business operation.
    logger.warn({ err: error, storageId: asset.storageId }, "failed to delete stored asset");
  }
}

export { LOCAL_ROOT };