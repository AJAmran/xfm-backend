import { randomBytes } from "node:crypto";
import {
  BookingPartyType,
  BookingStatus,
  PaxAdjustmentType,
  Role,
} from "../generated/prisma/enums";
import { createSeedClient, runScript } from "./seed-utils";

const MARKER = "[TEST-DATA]";

const FIRST = ["Rahim", "Karim", "Sharma", "Nusrat", "Tanvir", "Farzana", "Arif", "Mitu", "Sajib", "Lima", "Hasan", "Priya", "Rashed", "Mim", "Jakir", "Tania", "Fahim", "Nabila", "Sakib", "Ruma"];
const LAST = ["Uddin", "Hossain", "Akhter", "Jahan", "Ahmed", "Islam", "Chowdhury", "Rahman", "Khan", "Begum", "Mahmud", "Das", "Sarker", "Ali", "Hasan"];
const OCCASIONS = ["Birthday party", "Wedding reception", "Corporate lunch", "Family gathering", "Anniversary dinner", "Iftar mahfil", "Office farewell", "Engagement ceremony", "Reunion dinner", "Client entertainment"];

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

function utcDay(offsetDays: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

function bookingNumber(partyDate: Date): string {
  const compact = partyDate.toISOString().slice(0, 10).replaceAll("-", "");
  return `BK-${compact}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function main() {
  const target = Math.max(1, Number(process.argv[2] ?? 10));

  await runScript(`🎲 Seeding random test bookings (${target} per branch)…`, async (prisma) => {
    const branches = await prisma.branch.findMany({
      where: { isDeleted: false, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
    if (branches.length === 0) {
      console.log("  − No active branches found, nothing to do.");
      return;
    }

    const managers = await prisma.user.findMany({
      where: { role: Role.BRANCH_MANAGER, isDeleted: false, branchId: { not: null } },
      select: { id: true, branchId: true },
    });
    const managerByBranch = new Map(managers.map((m) => [m.branchId!, m.id]));
    const fallbackUser = await prisma.user.findFirst({
      where: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] }, isDeleted: false },
      select: { id: true },
    });
    if (!fallbackUser && managerByBranch.size === 0) {
      throw new Error("No users found to attribute bookings to — run the main seed first.");
    }

    let created = 0;
    for (const branch of branches) {
      const existing = await prisma.booking.count({
        where: { branchId: branch.id, isDeleted: false, remarks: { startsWith: MARKER } },
      });
      const actorId = managerByBranch.get(branch.id) ?? fallbackUser!.id;

      for (let i = existing; i < target; i += 1) {
        const offset = rnd(-30, 30);
        const partyType = Math.random() < 0.5 ? BookingPartyType.LUNCH : BookingPartyType.DINNER;
        const partyDate = utcDay(offset);

        // Status consistent with the date: past → completed/cancelled,
        // today → any live status, future → tentative/confirmed.
        let status: BookingStatus;
        const roll = Math.random();
        if (offset < 0) {
          status = roll < 0.75 ? BookingStatus.COMPLETED : roll < 0.9 ? BookingStatus.CANCELLED : BookingStatus.CONFIRMED;
        } else if (offset === 0) {
          status = roll < 0.4 ? BookingStatus.CONFIRMED : roll < 0.7 ? BookingStatus.TENTATIVE : roll < 0.9 ? BookingStatus.COMPLETED : BookingStatus.CANCELLED;
        } else {
          status = roll < 0.55 ? BookingStatus.TENTATIVE : roll < 0.9 ? BookingStatus.CONFIRMED : BookingStatus.CANCELLED;
        }

        const initialPax = rnd(20, 200);
        // 0–2 pax adjustments for realism.
        let expectedPax = initialPax;
        const adjSpecs: Array<{ type: PaxAdjustmentType; quantity: number }> = [];
        const adjCount = status === BookingStatus.CANCELLED ? 0 : rnd(0, 2);
        for (let a = 0; a < adjCount; a += 1) {
          const type = Math.random() < 0.65 ? PaxAdjustmentType.INCREASE : PaxAdjustmentType.DECREASE;
          const quantity = rnd(2, 30);
          const next = expectedPax + (type === PaxAdjustmentType.INCREASE ? quantity : -quantity);
          if (next < 1) continue;
          expectedPax = next;
          adjSpecs.push({ type, quantity });
        }

        const actualPax =
          status === BookingStatus.COMPLETED
            ? Math.max(0, expectedPax + rnd(-15, 25))
            : null;

        const guestName = `${pick(FIRST)} ${pick(LAST)}`;
        const guestMobile = `01${rnd(3, 9)}${String(rnd(0, 99999999)).padStart(8, "0")}`;

        const history: Array<{ from: BookingStatus | null; to: BookingStatus }> = [
          { from: null, to: BookingStatus.TENTATIVE },
        ];
        if (status !== BookingStatus.TENTATIVE) history.push({ from: BookingStatus.TENTATIVE, to: BookingStatus.CONFIRMED });
        if (status === BookingStatus.COMPLETED) history.push({ from: BookingStatus.CONFIRMED, to: BookingStatus.COMPLETED });
        if (status === BookingStatus.CANCELLED) history.push({ from: BookingStatus.CONFIRMED, to: BookingStatus.CANCELLED });

        let running = initialPax;
        await prisma.booking.create({
          data: {
            bookingNumber: bookingNumber(partyDate),
            branchId: branch.id,
            guestName,
            guestMobile,
            partyDate,
            partyType,
            initialPax,
            expectedPax,
            actualPax,
            status,
            remarks: `${MARKER} ${pick(OCCASIONS)} — auto test data`,
            createdByUserId: actorId,
            confirmedByUserId: status === BookingStatus.TENTATIVE ? null : actorId,
            confirmedAt: status === BookingStatus.TENTATIVE ? null : utcDay(Math.min(offset, 0)),
            cancelledByUserId: status === BookingStatus.CANCELLED ? actorId : null,
            cancelledAt: status === BookingStatus.CANCELLED ? utcDay(offset) : null,
            cancellationReason:
              status === BookingStatus.CANCELLED
                ? pick(["Guest requested cancellation", "Date changed by guest", "Duplicate entry", "Event postponed"])
                : null,
            completedByUserId: status === BookingStatus.COMPLETED ? actorId : null,
            completedAt: status === BookingStatus.COMPLETED ? utcDay(offset) : null,
            statusHistory: { create: history.map((h) => ({ fromStatus: h.from, toStatus: h.to, changedByUserId: actorId })) },
            adjustments:
              adjSpecs.length === 0
                ? undefined
                : {
                    create: adjSpecs.map((a) => {
                      const previousExpectedPax = running;
                      running += a.type === PaxAdjustmentType.INCREASE ? a.quantity : -a.quantity;
                      return {
                        type: a.type,
                        quantity: a.quantity,
                        previousExpectedPax,
                        newExpectedPax: running,
                        reason: `${MARKER} headcount ${a.type === PaxAdjustmentType.INCREASE ? "increased" : "reduced"} by guest`,
                        createdByUserId: actorId,
                      };
                    }),
                  },
          },
        });
        created += 1;
      }
      console.log(`  ✓ ${branch.code} — ${branch.name}: +${target - existing} random bookings`);
    }

    console.log(`\n✅ Created ${created} random test booking(s) across ${branches.length} branch(es).`);
  });
}

main();
