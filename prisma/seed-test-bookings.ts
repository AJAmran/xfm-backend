
import { randomBytes } from "node:crypto";
import {
  BookingPartyType,
  BookingStatus,
  PaxAdjustmentType,
  Role,
} from "../generated/prisma/enums";
import { createSeedClient, runScript } from "./seed-utils";

const MARKER = "[TEST-DATA]";
const TARGET_PER_BRANCH = 12;

function utcDay(offsetDays: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

function bookingNumber(partyDate: Date): string {
  const compact = partyDate.toISOString().slice(0, 10).replaceAll("-", "");
  return `BK-${compact}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

const GUESTS: Array<[string, string]> = [
  ["Rahim Uddin", "01711110001"],
  ["Sharma Akter", "01711110002"],
  ["Kamal Hossain", "01711110003"],
  ["Nusrat Jahan", "01711110004"],
  ["Tanvir Ahmed", "01711110005"],
  ["Farzana Islam", "01711110006"],
  ["Arif Chowdhury", "01711110007"],
  ["Mitu Rahman", "01711110008"],
  ["Sajib Khan", "01711110009"],
  ["Lima Begum", "01711110010"],
  ["Hasan Mahmud", "01711110011"],
  ["Priya Das", "01711110012"],
];

/** 12-spec rotation per branch: [dayOffset, partyType, status, initialPax, paxDelta, actualDelta, cancelled?] */
type Spec = [number, BookingPartyType, BookingStatus, number, number, number | null, string?];
const SPECS: Spec[] = [
  [-10, BookingPartyType.LUNCH, BookingStatus.COMPLETED, 100, 20, -5],
  [-7, BookingPartyType.DINNER, BookingStatus.COMPLETED, 80, 0, 0],
  [-5, BookingPartyType.LUNCH, BookingStatus.COMPLETED, 60, 10, 18], // actual notably over expected
  [-3, BookingPartyType.DINNER, BookingStatus.CANCELLED, 50, 0, null, "Guest requested cancellation (date changed)"],
  [-1, BookingPartyType.LUNCH, BookingStatus.COMPLETED, 120, 0, -8],
  [0, BookingPartyType.LUNCH, BookingStatus.CONFIRMED, 90, 15, null],
  [0, BookingPartyType.DINNER, BookingStatus.TENTATIVE, 70, 0, null],
  [0, BookingPartyType.DINNER, BookingStatus.CONFIRMED, 110, 0, null],
  [1, BookingPartyType.LUNCH, BookingStatus.TENTATIVE, 85, 0, null], // tomorrow-tentative warning
  [1, BookingPartyType.DINNER, BookingStatus.CONFIRMED, 150, 25, null],
  [3, BookingPartyType.LUNCH, BookingStatus.TENTATIVE, 95, -10, null],
  [5, BookingPartyType.DINNER, BookingStatus.TENTATIVE, 65, 0, null],
];

async function main() {
  await runScript("📅 Seeding test bookings (12 per branch)…", async (prisma) => {
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
      const existingMarkers = await prisma.booking.count({
        where: { branchId: branch.id, isDeleted: false, remarks: { startsWith: MARKER } },
      });
      const actorId = managerByBranch.get(branch.id) ?? fallbackUser!.id;
      let guestIdx = 0;

      for (let i = existingMarkers; i < TARGET_PER_BRANCH; i += 1) {
        const [offset, partyType, status, initialPax, delta, actualDelta, cancelReason] = SPECS[i % SPECS.length]!;
        const expectedPax = initialPax + delta;
        const partyDate = utcDay(offset);
        const [guestName, guestMobile] = GUESTS[(guestIdx + branch.id) % GUESTS.length]!;
        guestIdx += 1;

        const history: Array<{ from: BookingStatus | null; to: BookingStatus }> = [{ from: null, to: BookingStatus.TENTATIVE }];
        if (status !== BookingStatus.TENTATIVE) history.push({ from: BookingStatus.TENTATIVE, to: BookingStatus.CONFIRMED });
        if (status === BookingStatus.COMPLETED) history.push({ from: BookingStatus.CONFIRMED, to: BookingStatus.COMPLETED });
        if (status === BookingStatus.CANCELLED) history.push({ from: BookingStatus.CONFIRMED, to: BookingStatus.CANCELLED });

        await prisma.booking.create({
          data: {
            bookingNumber: bookingNumber(partyDate),
            branchId: branch.id,
            guestName: `${guestName} (Test ${i + 1})`,
            guestMobile,
            partyDate,
            partyType,
            initialPax,
            expectedPax,
            actualPax: status === BookingStatus.COMPLETED ? expectedPax + (actualDelta ?? 0) : null,
            status,
            remarks: `${MARKER} ${partyType === BookingPartyType.LUNCH ? "Lunch" : "Dinner"} party — auto test data`,
            createdByUserId: actorId,
            confirmedByUserId: status === BookingStatus.TENTATIVE ? null : actorId,
            confirmedAt: status === BookingStatus.TENTATIVE ? null : utcDay(Math.min(offset, 0)),
            cancelledByUserId: status === BookingStatus.CANCELLED ? actorId : null,
            cancelledAt: status === BookingStatus.CANCELLED ? utcDay(offset) : null,
            cancellationReason: cancelReason ?? null,
            completedByUserId: status === BookingStatus.COMPLETED ? actorId : null,
            completedAt: status === BookingStatus.COMPLETED ? utcDay(offset) : null,
            statusHistory: { create: history.map((h) => ({ fromStatus: h.from, toStatus: h.to, changedByUserId: actorId })) },
            adjustments:
              delta === 0
                ? undefined
                : {
                    create: {
                      type: delta > 0 ? PaxAdjustmentType.INCREASE : PaxAdjustmentType.DECREASE,
                      quantity: Math.abs(delta),
                      previousExpectedPax: initialPax,
                      newExpectedPax: expectedPax,
                      reason: `${MARKER} headcount ${delta > 0 ? "increased" : "reduced"} by guest`,
                      createdByUserId: actorId,
                    },
                  },
          },
        });
        created += 1;
      }
      console.log(`  ✓ ${branch.code} — ${branch.name}: +${TARGET_PER_BRANCH - existingMarkers} test bookings`);
    }

    console.log(`\n✅ Created ${created} test booking(s) across ${branches.length} branch(es).`);
    console.log("   Marker: remarks start with [TEST-DATA] — safe to delete, rerun tops up only missing rows.");
  });
}

main();
