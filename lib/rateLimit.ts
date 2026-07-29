import crypto from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { db } from "./firebase.js";

const BLOCK_CACHE_TTL = 24 * 60 * 60 * 1000;
const blockedIpsCache = new Map<string, number>();
const rateLimitedIpsCache = new Map<string, number>();

const isIPBlocked = (key: string): boolean => {
  const blockedUntil = blockedIpsCache.get(key);
  if (!blockedUntil) return false;
  if (Date.now() > blockedUntil) {
    blockedIpsCache.delete(key);
    return false;
  }
  return true;
};

const isIPRateLimited = (key: string): boolean => {
  const expiresAt = rateLimitedIpsCache.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    rateLimitedIpsCache.delete(key);
    return false;
  }
  return true;
};

const hashIp = (ip: string): string => {
  return crypto.createHash("sha256").update(ip).digest("hex");
};

const getIp = (
  req: IncomingMessage & { connection?: { remoteAddress?: string } },
): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw || req.connection?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
};

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

export async function rateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  limit = 10,
  resetTime = 60 * 60 * 1000,
  newcount = 1,
  scope = "global",
): Promise<true | null> {
  const ip = getIp(req);
  const key = `${scope}:${hashIp(ip)}`;
  const now = Date.now();

  if (isIPBlocked(key)) {
    sendJson(res, 403, { error: "Access denied" });
    return true;
  }

  if (isIPRateLimited(key)) {
    sendJson(res, 429, { error: "Rate limit exceeded" });
    return true;
  }

  const docRef = db.collection("rate-limit").doc(key);
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);

    if (!snap.exists) {
      transaction.set(docRef, { count: newcount, firstRequest: now, scope });
      return { limited: false, expiresAt: now + resetTime };
    }

    const data = snap.data()!;
    const firstRequest =
      typeof data.firstRequest === "number" ? data.firstRequest : now;
    const count = typeof data.count === "number" ? data.count : 0;

    if (now - firstRequest > resetTime) {
      transaction.set(docRef, { count: newcount, firstRequest: now, scope });
      return { limited: false, expiresAt: now + resetTime };
    }

    if (count >= limit) {
      return { limited: true, expiresAt: firstRequest + resetTime };
    }

    transaction.set(docRef, {
      count: count + newcount,
      firstRequest,
      scope,
    });
    return { limited: false, expiresAt: firstRequest + resetTime };
  });

  if (result.limited) {
    rateLimitedIpsCache.set(key, result.expiresAt);
    sendJson(res, 429, { error: "Rate limit exceeded" });
    return true;
  }

  return null;
}

export async function BlockIP(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const ip = getIp(req);
  const key = `global:${hashIp(ip)}`;
  const now = Date.now();

  blockedIpsCache.set(key, now + BLOCK_CACHE_TTL);
  const docRef = db.collection("rate-limit").doc(key);
  await docRef.set({ count: 20, firstRequest: now, scope: "global" });
  sendJson(res, 403, { error: "Access denied" });
}
