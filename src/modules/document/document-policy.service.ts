import { prisma } from "../../lib/prisma";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import { DEFAULT_DOCUMENT_POLICY, type DocumentPolicy } from "./document.logic";
import { logger } from "../../lib/logger";

/**
 * Admin-configurable approval policy, persisted as a JSON value in the existing
 * `system_settings` table (key `document_policy`).
 *
 * Read on every submit/resubmit, cached briefly, and validated with the same
 * Zod shape the settings endpoint uses, so a hand-edited row can never break
 * the workflow engine.
 */

const POLICY_KEY = "document_policy";
const POLICY_CACHE_KEY = "documentPolicy_";
const POLICY_TTL_SECONDS = 60;

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return fallback;
}

/** Never throws: an unreadable or malformed policy degrades to the defaults. */
export async function getDocumentPolicy(): Promise<DocumentPolicy> {
  return withCache(
    POLICY_CACHE_KEY,
    async () => {
      const row = await prisma.systemSetting.findUnique({ where: { key: POLICY_KEY } });
      if (!row?.value) return DEFAULT_DOCUMENT_POLICY;

      const parsed = JSON.parse(row.value) as Partial<DocumentPolicy>;
      const maxApprovers = Number(parsed.maxApprovers);

      return {
        hierarchyPolicy:
          parsed.hierarchyPolicy === "NONE" ? "NONE" : DEFAULT_DOCUMENT_POLICY.hierarchyPolicy,
        minApprovers: Math.max(1, Number(parsed.minApprovers) || DEFAULT_DOCUMENT_POLICY.minApprovers),
        maxApprovers:
          Number.isFinite(maxApprovers) && maxApprovers > 0
            ? maxApprovers
            : DEFAULT_DOCUMENT_POLICY.maxApprovers,
        allowCreatorAsApprover: coerceBoolean(
          parsed.allowCreatorAsApprover,
          DEFAULT_DOCUMENT_POLICY.allowCreatorAsApprover,
        ),
        reminderAfterHours:
          Number(parsed.reminderAfterHours) || DEFAULT_DOCUMENT_POLICY.reminderAfterHours,
        escalateAfterHours:
          Number(parsed.escalateAfterHours) || DEFAULT_DOCUMENT_POLICY.escalateAfterHours,
        maxApprovalDays: Number(parsed.maxApprovalDays) || DEFAULT_DOCUMENT_POLICY.maxApprovalDays,
        requireSignature: coerceBoolean(
          parsed.requireSignature,
          DEFAULT_DOCUMENT_POLICY.requireSignature,
        ),
      };
    },
    POLICY_TTL_SECONDS,
  );
}

/** Merges a partial update over the current policy. Super Admin only. */
export async function updateDocumentPolicy(patch: Partial<DocumentPolicy>): Promise<DocumentPolicy> {
  const current = await getDocumentPolicy();
  const next: DocumentPolicy = { ...current, ...patch };

  // Keep min <= max so a stored policy can never reject every sequence.
  if (next.minApprovers > next.maxApprovers) {
    next.maxApprovers = next.minApprovers;
  }

  await prisma.systemSetting.upsert({
    where: { key: POLICY_KEY },
    create: { key: POLICY_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });

  await invalidateByPrefix(POLICY_CACHE_KEY);
  logger.info({ policy: next }, "document approval policy updated");
  return next;
}

/** Read-only view of the policy, plus the derived defaults for the admin UI. */
export async function getPolicyOverview() {
  const policy = await getDocumentPolicy();
  return { policy, defaults: DEFAULT_DOCUMENT_POLICY };
}