import { runScript } from "./seed-utils";

/**
 * Demo manager reports covering every testable aspect:
 * PENDING / APPROVED / REJECTED, 0–3 complaints, comment threads,
 * minimal vs full fields, several branches and dates.
 *
 * All rows use managerName "Demo Manager <Branch>" so `--clean` can remove
 * exactly these rows (soft-delete) without touching real data.
 *
 *   npx tsx prisma/seed-manager-report-demo.ts          # seed (skips if present)
 *   npx tsx prisma/seed-manager-report-demo.ts --clean  # remove demo rows
 *
 * NOTE: rows are inserted directly (no submit mails). For a live mail-flow
 * test, create one report through POST /manager-reports as a branch manager.
 */

const CLEAN = process.argv.includes("--clean");
const MARKER = "Demo Manager";

interface DemoComplaint {
  guestName: string;
  mobile: string;
  email?: string | null;
  complaintDetails: string;
  serviceProviderName?: string;
  responsiblePerson?: string;
  actionTaken?: string;
  solution?: string;
}

interface DemoReport {
  branchCode: string;
  daysAgo: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  managerComments: string;
  supplyPurchaseIssues: string;
  briefingPoints: string;
  dailyLearnings: string;
  complaints: DemoComplaint[];
  comments: Array<{ userKey: "bm" | "admin"; comment: string }>;
  approvalComment?: string;
}

const DEMO: DemoReport[] = [
  {
    branchCode: "X-01",
    daysAgo: 0,
    status: "PENDING",
    managerComments: "Smooth lunch rush, one large party of 20 handled well.",
    supplyPurchaseIssues: "Chicken delivery 30 min late from supplier.",
    briefingPoints: "Reminded team about new dessert menu upsell.",
    dailyLearnings: "Large parties need a dedicated server from seating.",
    complaints: [
      {
        guestName: "Rahim Uddin",
        mobile: "01711111111",
        email: "rahim@example.com",
        complaintDetails: "Soup arrived lukewarm, asked for reheat twice before it came back hot.",
        serviceProviderName: "Kitchen",
        responsiblePerson: "Sous Chef",
        actionTaken: "Reheated immediately + complimentary dessert",
        solution: "Pass temperature check added to soup station",
      },
      {
        guestName: "Nasrin Akter",
        mobile: "01822222222",
        complaintDetails: "Waiting time crossed 25 minutes for main course during peak hour.",
        serviceProviderName: "F & B Service",
        responsiblePerson: "Floor Manager",
        actionTaken: "Apologised, 10% discount applied",
        solution: "Stagger large-party seatings on weekends",
      },
    ],
    comments: [{ userKey: "admin", comment: "Noted on the chicken delay — please confirm tomorrow's delivery slot." }],
  },
  {
    branchCode: "X-01",
    daysAgo: 1,
    status: "APPROVED",
    managerComments: "Quiet Monday, deep-cleaned the tandoor section.",
    supplyPurchaseIssues: "",
    briefingPoints: "New roster shared for next week.",
    dailyLearnings: "",
    complaints: [],
    comments: [],
    approvalComment: "Verified. Good job.",
  },
  {
    branchCode: "X-02",
    daysAgo: 0,
    status: "PENDING",
    managerComments: "",
    supplyPurchaseIssues: "",
    briefingPoints: "",
    dailyLearnings: "",
    complaints: [],
    comments: [],
  },
  {
    branchCode: "X-02",
    daysAgo: 2,
    status: "REJECTED",
    managerComments: "Sales totalled 84,500 for the day.",
    supplyPurchaseIssues: "None.",
    briefingPoints: "Weekend prep list shared.",
    dailyLearnings: "Recheck register tape before closing.",
    complaints: [
      {
        guestName: "Karim Sheikh",
        mobile: "01933333333",
        complaintDetails: "Bill had an extra dessert charged that was never ordered.",
        actionTaken: "Removed from bill on the spot",
        solution: "Cashier to repeat order back for desserts",
      },
    ],
    comments: [],
    approvalComment: "Sales figures don't match the register tape — please correct and resubmit.",
  },
  {
    branchCode: "X-04",
    daysAgo: 3,
    status: "APPROVED",
    managerComments: "Catering order for 60 pax delivered on time.",
    supplyPurchaseIssues: "Short of 2kg prawns, substituted with chef's approval.",
    briefingPoints: "Catering checklist reviewed with team.",
    dailyLearnings: "Confirm protein quantities a day before catering events.",
    complaints: [
      { guestName: "Ayesha Khan", mobile: "01644444444", complaintDetails: "Naan basket arrived after mains.", actionTaken: "Fresh basket rushed", solution: "Fire naan with starter course" },
      { guestName: "Tanvir Ahmed", mobile: "01555555555", email: "tanvir@example.com", complaintDetails: "AC over the corner table dripping lightly.", serviceProviderName: "Engineering", responsiblePerson: "Technician", actionTaken: "Table moved, technician called", solution: "Quarterly AC service logged" },
      { guestName: "Farhana Islam", mobile: "01366666666", complaintDetails: "Very long detailed complaint testing how the UI renders multi-line text across cards, tables and the detail view without breaking layout or overflowing containers on small screens.", actionTaken: "Heard out fully, manager visited table", solution: "Added a second hostess for Friday rush" },
    ],
    comments: [
      { userKey: "bm", comment: "Prawn shortage resolved with supplier for tomorrow." },
      { userKey: "admin", comment: "Good handling of the catering order." },
    ],
  },
  {
    branchCode: "X-07",
    daysAgo: 0,
    status: "PENDING",
    managerComments: "New trainee server joined today.",
    supplyPurchaseIssues: "",
    briefingPoints: "",
    dailyLearnings: "",
    complaints: [],
    comments: [
      { userKey: "bm", comment: "Trainee shadowed the floor lead for lunch service." },
      { userKey: "admin", comment: "Please share the trainee checklist by tomorrow." },
    ],
  },
  {
    branchCode: "X-11",
    daysAgo: 5,
    status: "PENDING",
    managerComments: "Power cut for 40 minutes, generator covered the kitchen.",
    supplyPurchaseIssues: "Fridge temperature log attached in register.",
    briefingPoints: "",
    dailyLearnings: "",
    complaints: [],
    comments: [],
  },
  {
    branchCode: "X-19",
    daysAgo: 7,
    status: "APPROVED",
    managerComments: "Weekend rush handled, no major issues.",
    supplyPurchaseIssues: "",
    briefingPoints: "",
    dailyLearnings: "",
    complaints: [],
    comments: [],
    approvalComment: "OK.",
  },
];

function dayAgo(days: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
}

runScript("🧪 Manager-report demo data", async (prisma) => {
  if (CLEAN) {
    // Match regardless of isDeleted so leftovers from interrupted runs
    // (children of already-cleaned reports) are caught too.
    const demo = await prisma.managerReport.findMany({
      where: { managerName: { startsWith: MARKER } },
      select: { id: true, isDeleted: true },
    });
    const ids = demo.map((row) => row.id);
    if (ids.length) {
      // Demo-only child rows: hard-delete so repeated seed/clean cycles
      // leave zero residue (reports themselves stay soft-deleted per repo rule).
      const [complaints, comments] = await Promise.all([
        prisma.guestComplaint.deleteMany({ where: { managerReportId: { in: ids } } }),
        prisma.managerReportComment.deleteMany({ where: { reportId: { in: ids } } }),
      ]);
      let softDeleted = 0;
      for (const row of demo) {
        if (!row.isDeleted) {
          await prisma.managerReport.update({ where: { id: row.id }, data: { isDeleted: true } });
          softDeleted++;
        }
      }
      console.log(`  cleaned ${softDeleted} demo report(s) + ${complaints.count} complaints + ${comments.count} comments`);
    } else {
      console.log("  no demo reports to clean");
    }
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { email: "admin@x-grouprestaurant.com", isDeleted: false },
    select: { id: true },
  });

  // DB complaint columns are NOT NULL without defaults — mirror the
  // validation defaults explicitly (guestComplaintSchema).
  const complaintRows = (list: DemoComplaint[]) =>
    list.map((c) => ({
      guestName: c.guestName ?? "",
      mobile: c.mobile ?? "",
      email: c.email ?? null,
      complaintDetails: c.complaintDetails ?? "",
      serviceProviderName: c.serviceProviderName ?? "",
      responsiblePerson: c.responsiblePerson ?? "",
      actionTaken: c.actionTaken ?? "",
      solution: c.solution ?? "",
    }));

  let created = 0;
  for (const demo of DEMO) {
    const branch = await prisma.branch.findFirst({
      where: { code: demo.branchCode, isDeleted: false },
      select: { id: true },
    });
    if (!branch) {
      console.log(`  SKIP branch ${demo.branchCode} not found`);
      continue;
    }
    const bm = await prisma.user.findFirst({
      where: { branchId: branch.id, role: "BRANCH_MANAGER", isDeleted: false },
      select: { id: true },
    });
    const creatorId = bm?.id ?? admin?.id;
    if (!creatorId) {
      console.log(`  SKIP ${demo.branchCode}: no creator account`);
      continue;
    }
    const reportDate = dayAgo(demo.daysAgo);
    const rowData = {
      branchId: branch.id,
      managerName: `${MARKER} (${demo.branchCode})`,
      reportDate,
      managerComments: demo.managerComments,
      supplyPurchaseIssues: demo.supplyPurchaseIssues,
      briefingPoints: demo.briefingPoints,
      dailyLearnings: demo.dailyLearnings,
      createdByUserId: creatorId,
      approvalStatus: demo.status,
      approvedByUserId: demo.status === "PENDING" ? null : (admin?.id ?? null),
      approvedAt: demo.status === "PENDING" ? null : new Date(),
      approvalComment: demo.approvalComment ?? null,
      isDeleted: false,
    };
    // The unique key spans soft-deleted rows, so a cleaned demo row still
    // occupies its (branch, date). Resurrect demo rows; never touch real ones.
    const clash = await prisma.managerReport.findUnique({
      where: { branchId_reportDate: { branchId: branch.id, reportDate } },
      select: { id: true, managerName: true },
    });
    if (clash && !clash.managerName.startsWith(MARKER)) {
      console.log(`  SKIP ${demo.branchCode} ${reportDate.toISOString().slice(0, 10)}: real report exists`);
      continue;
    }
    let reportId: number;
    let verb: string;
    if (clash) {
      await prisma.guestComplaint.deleteMany({ where: { managerReportId: clash.id } });
      await prisma.managerReportComment.deleteMany({ where: { reportId: clash.id } });
      await prisma.managerReport.update({ where: { id: clash.id }, data: rowData });
      await prisma.guestComplaint.createMany({
        data: complaintRows(demo.complaints).map((c) => ({ ...c, managerReportId: clash.id })),
      });
      reportId = clash.id;
      verb = "resurrected";
    } else {
      const report = await prisma.managerReport.create({
        data: { ...rowData, complaints: { create: complaintRows(demo.complaints) } },
        select: { id: true },
      });
      reportId = report.id;
      verb = "created";
    }
    for (const c of demo.comments) {
      const commenter = c.userKey === "admin" ? admin?.id : creatorId;
      if (!commenter) continue;
      await prisma.managerReportComment.create({
        data: { reportId, userId: commenter, comment: c.comment },
      });
    }
    created++;
    console.log(`  #${reportId} ${demo.branchCode} ${reportDate.toISOString().slice(0, 10)} ${demo.status} (${demo.complaints.length} complaints, ${demo.comments.length} comments) [${verb}]`);
  }
  console.log(`\n  ${created} demo report(s) ready. Remove anytime: npx tsx prisma/seed-manager-report-demo.ts --clean`);
});
