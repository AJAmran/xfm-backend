import { prisma } from "../../lib/prisma";

export async function getSettings() {
  const settings = await prisma.systemSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

/**
 * Upserts all settings in parallel instead of sequentially.
 * Each key-value pair fires its own upsert concurrently via Promise.all,
 * reducing total latency from O(N × roundtrip) to O(1 × roundtrip).
 */
export async function updateSettings(payload: Record<string, string>) {
  const upserts = Object.entries(payload).map(([key, value]) =>
    prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    }),
  );

  await Promise.all(upserts);
  return getSettings();
}
