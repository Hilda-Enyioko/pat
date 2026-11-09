import type { Express, NextFunction, Request, Response } from "express";
import { config } from "./config";

/** CORS for the browser-facing routes. /ussd is server-to-server and needs none. */
export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  const all = config.corsOrigins.includes("*");
  if (origin && (all || config.corsOrigins.includes(origin))) {
    res.set("Access-Control-Allow-Origin", all ? "*" : origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "content-type,x-enroll-token");
    res.set("Access-Control-Max-Age", "600");
  }
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

export function useCors(app: Express) {
  // app.use matches by prefix, so "/enroll" also covers /enroll/challenge etc.
  for (const path of ["/meta", "/enroll"]) app.use(path, cors);
}
