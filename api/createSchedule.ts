import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import { db } from "../lib/firebase.js";
import { setCorsHeaders, isValidReferer } from "../lib/cors.js";
import { rateLimit } from "../lib/rateLimit.js";
import { validateSchedulePayload } from "../lib/scheduleValidation.js";

const MAX_BODY_BYTES = 50 * 1024;

class RequestBodyTooLargeError extends Error {}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    let done = false;

    req.on("data", (chunk: Buffer) => {
      if (done) return;

      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject(new RequestBodyTooLargeError("Request body too large"));
        return;
      }

      data += chunk.toString();
    });

    req.on("end", () => {
      if (done) return;
      done = true;

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!isValidReferer(req)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  const limited = await rateLimit(
    req,
    res,
    10,
    24 * 60 * 60 * 1000,
    1,
    "create-schedule",
  );
  if (limited) return;

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  let body: unknown;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      json(res, 413, { error: "Request body too large" });
      return;
    }

    json(res, 400, { error: "Invalid request body" });
    return;
  }

  const payload = validateSchedulePayload(body);
  if (!payload) {
    json(res, 400, { error: "Invalid schedule payload" });
    return;
  }

  try {
    const id = generateId();
    await db.collection("schedules").doc(id).set({
      schedule: payload.schedule,
      createdAt: Date.now(),
    });

    json(res, 200, { id });
  } catch (err) {
    console.error("[createSchedule]", err);
    json(res, 500, { error: "Internal server error" });
  }
}
