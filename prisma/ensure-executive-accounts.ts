import { Role } from "../generated/prisma/enums";
import {
  KNOWN_ACCOUNTS,
  hashPassword,
  resolveSeedPassword,
  runScript,
} from "./seed-utils";

async function main() {
  await runScript("👔 Ensuring executive accounts...", async (prisma) => {
    for (const a of KNOWN_ACCOUNTS.filter((x) => x.role === Role.COO || x.role === Role.MD)) {
      const hashed = await hashPassword(resolveSeedPassword(a.envKey, a.label, a.fallbackPassword));
      const user = await prisma.user.upsert({
        where: { email: a.email },
        update: { name: a.name, password: hashed, role: a.role, isActive: true, isDeleted: false, signatureUrl: a.signatureUrl ?? null },
        create: { name: a.name, email: a.email, password: hashed, role: a.role, signatureUrl: a.signatureUrl ?? null },
        select: { id: true, email: true, role: true },
      });
      console.log(`  ✓ ${user.email} (${user.role}) ready — id ${user.id}`);
    }
    console.log("Existing data untouched.");
  });
}

main();
