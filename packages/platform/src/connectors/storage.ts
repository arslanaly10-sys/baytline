import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Document-storage connector: any S3-compatible bucket (Amazon S3, or a compatible service via
 * STORAGE_ENDPOINT). Server secrets:
 *   STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY  (required)
 *   STORAGE_ENDPOINT                                                                 (optional, https only)
 * The connection check reads the bucket's metadata (HeadBucket): it proves the key and bucket work and
 * writes nothing. Every object key is scoped to one organization: orgs/<orgId>/...
 */
export const STORAGE_SECRETS = ["STORAGE_BUCKET", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"] as const;

export type StorageFailure = "not_configured" | "bad_endpoint" | "auth" | "no_bucket" | "connection" | "unknown";
export class StorageError extends Error {
  constructor(public code: StorageFailure) { super(code); }
}

type Sendable = Pick<S3Client, "send">;

export function storageClient(env: NodeJS.ProcessEnv = process.env): { client: S3Client; bucket: string } {
  for (const n of STORAGE_SECRETS) if (!env[n]) throw new StorageError("not_configured");
  let endpoint: string | undefined;
  if (env.STORAGE_ENDPOINT) {
    try {
      const u = new URL(env.STORAGE_ENDPOINT);
      if (u.protocol !== "https:") throw new Error("https only");
      endpoint = u.origin;
    } catch {
      throw new StorageError("bad_endpoint");
    }
  }
  const client = new S3Client({
    region: env.STORAGE_REGION,
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY! },
    maxAttempts: 2,
  });
  return { client, bucket: env.STORAGE_BUCKET! };
}

function mapError(e: unknown): StorageFailure {
  if (e instanceof StorageError) return e.code;
  if (e instanceof S3ServiceException) {
    const status = e.$metadata?.httpStatusCode;
    if (status === 403 || e.name === "InvalidAccessKeyId" || e.name === "SignatureDoesNotMatch" || e.name === "AccessDenied") return "auth";
    if (status === 404 || e.name === "NotFound" || e.name === "NoSuchBucket") return "no_bucket";
    return "unknown";
  }
  const name = (e as { name?: string; code?: string })?.name ?? "";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|TimeoutError|NetworkingError/.test(name + String((e as { code?: string })?.code ?? ""))) return "connection";
  return "unknown";
}

const SUMMARY: Record<StorageFailure, string> = {
  not_configured: "A STORAGE_* secret is not set.",
  bad_endpoint: "STORAGE_ENDPOINT must be an https:// address.",
  auth: "The storage service rejected the access key, or the key can't read this bucket.",
  no_bucket: "The bucket wasn't found.",
  connection: "Couldn't connect to the storage service.",
  unknown: "The storage check failed.",
};

export async function checkStorage(env: NodeJS.ProcessEnv = process.env, override?: { client: Sendable; bucket: string }): Promise<{ ok: boolean; summary: string }> {
  try {
    const { client, bucket } = override ?? storageClient(env);
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, summary: "The bucket answered. Nothing was written." };
  } catch (e) {
    return { ok: false, summary: SUMMARY[mapError(e)] };
  }
}

const SAFE = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

/** orgs/<orgId>/<folder>/<name>: callers can't escape their organization's prefix. */
export function objectKey(orgId: string, folder: string, name: string): string {
  if (!/^[0-9a-f-]{36}$/.test(orgId) || !SAFE.test(folder) || !SAFE.test(name) || name.includes("..") || folder.includes("..")) throw new StorageError("unknown");
  return `orgs/${orgId}/${folder}/${name}`;
}

/** The storage operations later features use. Failures carry fixed codes. */
export function documentStore(env: NodeJS.ProcessEnv = process.env, override?: { client: Sendable; bucket: string }) {
  const { client, bucket } = override ?? storageClient(env);
  const run = async <T>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (e) { throw new StorageError(mapError(e)); }
  };
  return {
    put: (key: string, body: Uint8Array, contentType: string) =>
      run(() => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256" }))).then(() => undefined),
    /** A short-lived download link (default 5 minutes). */
    signedDownloadUrl: (key: string, seconds = 300) =>
      run(() => getSignedUrl(client as S3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: Math.min(Math.max(seconds, 60), 3600) })),
    remove: (key: string) => run(() => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))).then(() => undefined),
  };
}
