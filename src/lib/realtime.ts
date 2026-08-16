import { ServerResponse } from "http";
import { randomUUID } from "crypto";
import { logger } from "./logger";

export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  BRANCH_MANAGER: "BRANCH_MANAGER",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Scope attached to an event so recipients can be filtered. */
export type RealtimeScope =
  | { type: "global" }
  | { type: "branch"; branchId: number };

/** Lightweight contract for anything that can receive a realtime event. */
export interface RealtimeSubscriber {
  id: string;
  role: Role;
  branchId: number | null;
  send: (event: RealtimeEvent) => void;
  close: () => void;
}

export interface RealtimeEvent {
  /** Machine-readable topic, e.g. "feedback.created". */
  entity: string;
  /** Optional id of the affected branch — used for BRANCH_MANAGER scoping. */
  branchId?: number;
  /** OccurredAt ISO timestamp. */
  timestamp: string;
}

/**
 * In-process realtime fan-out hub used by the SSE stream endpoint.
 *
 * Single-instance backend: events published after any mutation are pushed
 * to every connected dashboard through an SSE connection. Branch managers only
 * receive events for their own branch plus global events; admins receive all.
 *
 * If the backend is ever scaled to multiple instances, replace this in-process
 * hub with a shared pub/sub (e.g. Redis) that keeps the same `publish` API.
 */
export class RealtimeHub {
  private subscribers = new Map<string, RealtimeSubscriber>();
  private heartbeatMs = 25_000;

  /** Register a subscriber; returns an unsubscribe function. */
  subscribe(subscriber: Omit<RealtimeSubscriber, "id">): () => void {
    const id = randomUUID();
    this.subscribers.set(id, { ...subscriber, id });

    const interval = setInterval(() => {
      try {
        subscriber.send({ entity: "ping", timestamp: new Date().toISOString() });
      } catch (err) {
        logger.warn({ err }, "realtime subscriber heartbeat failed");
        this.unsubscribe(id);
      }
    }, this.heartbeatMs);

    return () => {
      clearInterval(interval);
      this.unsubscribe(id);
    };
  }

  /** Remove a subscriber if it's still registered. */
  unsubscribe(id: string) {
    this.subscribers.delete(id);
  }

  /** Number of currently connected clients (used for health/logging). */
  get size(): number {
    return this.subscribers.size;
  }

  /**
   * Publish an event to every subscriber whose role/branch scope matches.
   * Global events reach everyone; branch events reach admins + that branch's managers.
   */
  publish(event: Omit<RealtimeEvent, "timestamp"> & RealtimeScope) {
    const full: RealtimeEvent = { ...event, timestamp: new Date().toISOString() };

    for (const sub of this.subscribers.values()) {
      if (this.shouldDeliver(sub, event)) {
        try {
          sub.send(full);
        } catch (err) {
          logger.warn({ err }, "failed to deliver realtime event");
          this.unsubscribe(sub.id);
          sub.close();
        }
      }
    }
  }

  private shouldDeliver(
    sub: RealtimeSubscriber,
    event: Omit<RealtimeEvent, "timestamp"> & RealtimeScope,
  ): boolean {
    // Admins see everything.
    if (sub.role === Role.SUPER_ADMIN || sub.role === Role.ADMIN) return true;

    // Branch managers: global events + events for their own branch.
    if (event.type === "global") return true;
    if (event.type === "branch") return event.branchId === (sub.branchId ?? undefined);

    return false;
  }
}

export const realtimeHub = new RealtimeHub();

/** Convenience helper: broadcast a change event after a mutation. */
export function publishDataChanged(entity: string, scope: RealtimeScope) {
  realtimeHub.publish({ entity, ...scope });
}