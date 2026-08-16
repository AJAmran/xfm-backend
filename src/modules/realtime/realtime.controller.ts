import { Request, Response } from "express";
import { realtimeHub, RealtimeEvent } from "../../lib/realtime";

/**
 * SSE stream endpoint. Keeps the HTTP response open and streams events to the
 * connected browser. Heartbeats are handled by the hub; the response closes
 * when the client disconnects.
 */
export function streamEvents(req: Request, res: Response) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  // SSE handshake headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`retry: 3000\n\n`);

  const send = (event: RealtimeEvent) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    res.write(payload);
  };

  const close = () => {
    res.end();
  };

  const unsubscribe = realtimeHub.subscribe({
    role: user.role,
    branchId: user.branchId ?? null,
    send,
    close,
  });

  // Clean up when the browser disconnects (or the response errors).
  req.on("close", unsubscribe);
  res.on("close", unsubscribe);
  res.on("error", () => {
    unsubscribe();
  });
}