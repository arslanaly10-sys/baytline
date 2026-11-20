import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));

/**
 * scrypt with OWASP-recommended cost (N=2^17, r=8, p=1) by default.
 * BAYTLINE_SCRYPT_LOG2 may lower it for tests only; production refuses anything below 17.
 */
function costLog2(): number {
  const v = Number(process.env.BAYTLINE_SCRYPT_LOG2 ?? 17);
  if (!Number.isInteger(v) || v < 14 || v > 20) throw new Error("BAYTLINE_SCRYPT_LOG2 must be between 14 and 20");
  if (process.env.NODE_ENV === "production" && v < 17) throw new Error("scrypt cost below 2^17 is not allowed in production");
  return v;
}

const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const log2 = costLog2();
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: 2 ** log2, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", log2, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, log2, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !log2 || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: 2 ** Number(log2),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** Spends the same time as a real check, so unknown emails can't be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummy);
}

/** 256-bit random token for cookies and links. Only its SHA-256 is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}
