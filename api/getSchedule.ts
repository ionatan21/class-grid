import type { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { db } from "../lib/firebase.js";
import { setCorsHeaders } from "../lib/cors.js";
import { rateLimit } from "../lib/rateLimit.js";

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const limited = await rateLimit(
    req,
    res,
    300,
    60 * 60 * 1000,
    1,
    "get-schedule",
  );
  if (limited) return;

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const id = url.searchParams.get("id");

  if (!id || !/^(?:[0-9a-f]{8}|[0-9a-f]{32})$/i.test(id)) {
    json(res, 400, { error: "Valid id query parameter is required" });
    return;
  }

  try {
    const doc = await db.collection("schedules").doc(id).get();

    if (!doc.exists) {
      json(res, 404, { error: "Schedule not found" });
      return;
    }

    const data = doc.data()!;
    json(res, 200, { schedule: data.schedule });
  } catch (err) {
    console.error("[getSchedule]", err);
    json(res, 500, { error: "Internal server error" });
  }
}
