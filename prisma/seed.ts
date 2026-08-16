import {
  Role,
  HeardAbout,
  AgeGroup,
  BpCpEntryType,
  ApprovalStatus,
  InventoryStatementStatus,
} from "../generated/prisma/enums";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { INVENTORY_CATALOG } from "./inventory-catalog";

// Seed creates its own Prisma instance (separate from the app) so it can be run
// independently without importing the full app's module graph.
const dbUrl = new URL(process.env.DATABASE_URL!);
const useSsl =
  process.env.DATABASE_SSL !== undefined
    ? process.env.DATABASE_SSL === "true"
    : dbUrl.searchParams.get("ssl-mode") === "REQUIRED";

const adapter = new PrismaMariaDb({
  host: dbUrl.hostname,
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
  connectTimeout: 10_000,
  acquireTimeout: 15_000,
  minimumIdle: 1,
  ...(useSsl
    ? {
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {}),
});
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

function generateStrongPassword(length = 24): string {
  return randomBytes(length).toString("base64url");
}

function resolveSeedPassword(envKey: string, label: string): string {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  const generated = generateStrongPassword();
  console.warn(`  ⚠ ${envKey} not set — using a generated password for ${label}. Set ${envKey} to pin it.`);
  console.log(`    ${label} login → password: ${generated}`);
  return generated;
}

// ─── Static data ──────────────────────────────────────────────────────────────
const BRANCHES = [
  {
    code: "X-01",
    name: "Xian Restaurant",
    address: "212 New Elephant Road, Dhaka-1205",
    phone: ["01329661662"],
    latitude: 23.740042879559585,
    longitude: 90.38950769940561,
  },
  {
    code: "X-02",
    name: "Xenial Restaurant",
    address: "House No. 06 (New), Road No. 16 (Old 27), Dhanmondi, Dhaka-1209",
    phone: ["01329661663"],
    latitude: 23.7561511045432,
    longitude: 90.37447932021232,
  },
  {
    code: "X-03",
    name: "Xiamen Restaurant",
    address:
      "House No. 55A, Road No. 4A (New), Satmasjid Road, Dhanmondi, Dhaka-1209",
    phone: ["01755636260", "0258617163"],
    latitude: 23.740210145379404,
    longitude: 90.37477915317342,
  },
  {
    code: "X-04",
    name: "Golden Chimney Restaurant",
    address: "80/14/A Mymensingh Road, Sonargaon Road, Banglamotor, Dhaka-1000",
    phone: ["01755636261", "02223363969"],
    latitude: 23.746062889306078,
    longitude: 90.39286521010396,
  },
  {
    code: "X-05",
    name: "Xindian Restaurant",
    address: "House No. 55/55A, Road No. 16, Dhanmondi, Dhaka-1209",
    phone: ["01755636262", "0258150396"],
    latitude: 23.751946854874433,
    longitude: 90.36845087231482,
  },
  {
    code: "X-06",
    name: "Xinxian Restaurant, Dhanmondi",
    address: "House No. 7, Road No. 8, Dhanmondi, Dhaka-1205",
    phone: ["01755636263", "04478778843"],
    latitude: 23.74562924055612,
    longitude: 90.38434549981451,
  },
  {
    code: "X-07",
    name: "Four Seasons Restaurant, Dhanmondi",
    address:
      "House No. 59A, Road No. 16, Satmasjid Road, Dhanmondi, Dhaka-1209",
    phone: ["01755636264", "0241020520"],
    latitude: 23.751511578924287,
    longitude: 90.36809039735647,
  },
  {
    code: "X-08",
    name: "Xinxian Restaurant, Mirpur-10",
    address: "6/C, 8/11, Mirpur-11, Dhaka",
    phone: ["01755636265", "0248032146"],
    latitude: 23.81265844550352,
    longitude: 90.3668630722603,
  },
  {
    code: "X-09",
    name: "Chung Wah Restaurant",
    address: "203, Shaheed Syed Nazrul Islam Sarani, Bijoy Nagar, Dhaka",
    phone: ["01755636267", "029553263"],
    latitude: 23.73312528078283,
    longitude: 90.40995913192918,
  },
  {
    code: "X-11",
    name: "Xinxian Restaurant, Uttara",
    address: "House No. 1, Road No. 8, Sector-1, Uttara Model Town, Dhaka-1230",
    phone: ["01755636266", "0248958051"],
    latitude: 23.858085605330054,
    longitude: 90.40174794894915,
  },
  {
    code: "X-12",
    name: "Shimanto Convention Center",
    address:
      "75, Bir Uttom M A Rob Road, 4th Floor, Shimanto Square Market, Dhanmondi, Dhaka",
    phone: ["01755636268", "01755636321"],
    latitude: 23.73809337714598,
    longitude: 90.37761096789161,
  },
  {
    code: "X-16",
    name: "Xinxian Restaurant, Mirpur-01",
    address:
      "Mirpur New Market, VTCB Tower (5th Floor), Main Road, Mirpur-1, Dhaka-1216",
    phone: ["01709678135", "01709678146"],
    latitude: 23.799770728946406,
    longitude: 90.35435683584136,
  },
  {
    code: "X-17",
    name: "Zam Zam Convention Center, Mirpur-01",
    address:
      "Mirpur New Market, VTCB Tower (4th Floor), Main Road, Mirpur-1, Dhaka-1216",
    phone: ["01709678145", "01709678146"],
    latitude: 23.79954398535525,
    longitude: 90.35437327940905,
  },
  {
    code: "X-18",
    name: "Zam Zam Convention Center, Mirpur-11",
    address:
      "Section-7, Main Road-03, Avenue-4, Plot-1/1, Pallabi, Mirpur, Dhaka",
    phone: ["01709678171", "01709678172"],
    latitude: 23.81589567663798,
    longitude: 90.36567282924354,
  },
  {
    code: "X-19",
    name: "Four Seasons Restaurant, Mirpur-11",
    address:
      "Section-7, Main Road-3, Avenue-4, Plot-1/1 (2nd Floor), Pallabi, Mirpur, Dhaka-1216",
    phone: ["01709678170", "01709678171"],
    latitude: 23.81592431514009,
    longitude: 90.36567284723233,
  },
];

const BRANCH_MANAGERS = [
  {
    code: "X-01",
    name: "Xian Restaurant Manager",
    email: "xian@x-grouprestaurant.com",
  },
  {
    code: "X-02",
    name: "Xenial Restaurant Manager",
    email: "xenial@x-grouprestaurant.com",
  },
  {
    code: "X-03",
    name: "Xiamen Restaurant Manager",
    email: "xiamen@x-grouprestaurant.com",
  },
  {
    code: "X-04",
    name: "Golden Chimney Restaurant Manager",
    email: "golden.chm@x-grouprestaurant.com",
  },
  {
    code: "X-05",
    name: "Xindian Restaurant Manager",
    email: "xindian@x-grouprestaurant.com",
  },
  {
    code: "X-06",
    name: "Xinxian Restaurant, Dhanmondi Manager",
    email: "xinxian.dhan@x-grouprestaurant.com",
  },
  {
    code: "X-07",
    name: "Four Seasons Restaurant, Dhanmondi Manager",
    email: "4seasons@x-grouprestaurant.com",
  },
  {
    code: "X-08",
    name: "Xinxian Restaurant, Mirpur-10 Manager",
    email: "xinxian.mirpur@x-grouprestaurant.com",
  },
  {
    code: "X-09",
    name: "Chung Wah Restaurant Manager",
    email: "chungwah@x-grouprestaurant.com",
  },
  {
    code: "X-11",
    name: "Xinxian Restaurant, Uttara Manager",
    email: "xinxian.uttara@x-grouprestaurant.com",
  },
  {
    code: "X-12",
    name: "Shimanto Convention Center Manager",
    email: "shimanto@x-grouprestaurant.com",
  },
  {
    code: "X-16",
    name: "Xinxian Restaurant, Mirpur-01 Manager",
    email: "xinxian.mirpur1@x-grouprestaurant.com",
  },
  {
    code: "X-17",
    name: "Zam Zam Convention Center, Mirpur-01 Manager",
    email: "zamzam@x-grouprestaurant.com",
  },
  {
    code: "X-18",
    name: "Zam Zam Convention Center, Mirpur-11 Manager",
    email: "zamzam.mirpur@x-grouprestaurant.com",
  },
  {
    code: "X-19",
    name: "Four Seasons Restaurant, Mirpur-11 Manager",
    email: "4season@x-grouprestaurant.com",
  },
];

const FEEDBACK_TEMPLATES = [
  {
    guestName: "Rafiq Hasan",
    contact: "01711112222",
    foodRating: 5,
    serviceRating: 4,
    environmentRating: 5,
    eventRating: 4,
    overallRating: 5,
    heardAbout: HeardAbout.FRIENDS_AND_FAMILY,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Excellent food and great ambiance. Will definitely come back!",
  },
  {
    guestName: "Farzana Akhter",
    contact: "01722223333",
    foodRating: 4,
    serviceRating: 3,
    environmentRating: 4,
    eventRating: 3,
    overallRating: 4,
    heardAbout: HeardAbout.SOCIAL_MEDIA,
    ageGroup: AgeGroup.AGE_18_30,
    opinion: "Good food but service was a bit slow.",
  },
  {
    guestName: "Tanvir Ahmed",
    contact: "tanvir@email.com",
    foodRating: 3,
    serviceRating: 4,
    environmentRating: 3,
    eventRating: 4,
    overallRating: 3,
    heardAbout: HeardAbout.VISITED_BEFORE,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Average experience, nothing special.",
  },
  {
    guestName: "Nusrat Jahan",
    contact: "01733334444",
    foodRating: 5,
    serviceRating: 5,
    environmentRating: 5,
    eventRating: 5,
    overallRating: 5,
    heardAbout: HeardAbout.FRIENDS_AND_FAMILY,
    ageGroup: AgeGroup.AGE_18_30,
    opinion: "Perfect dining experience! The staff was amazing.",
  },
  {
    guestName: "Kamal Hossain",
    contact: "01744445555",
    foodRating: 3,
    serviceRating: 3,
    environmentRating: 3,
    eventRating: 3,
    overallRating: 3,
    heardAbout: HeardAbout.SOCIAL_MEDIA,
    ageGroup: AgeGroup.AGE_51_PLUS,
    opinion: "Disappointing compared to my last visit.",
  },
  {
    guestName: "Shamim Reza",
    contact: "01755556666",
    foodRating: 4,
    serviceRating: 4,
    environmentRating: 4,
    eventRating: 5,
    overallRating: 4,
    heardAbout: HeardAbout.VISITED_BEFORE,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Great place for family gatherings.",
  },
  {
    guestName: "Maliha Tabassum",
    contact: "01766667777",
    foodRating: 5,
    serviceRating: 3,
    environmentRating: 5,
    eventRating: 3,
    overallRating: 4,
    heardAbout: HeardAbout.FRIENDS_AND_FAMILY,
    ageGroup: AgeGroup.AGE_18_30,
    opinion: "Food was delicious but waiting time was long.",
  },
  {
    guestName: "Jahidul Islam",
    contact: "01777778888",
    foodRating: 3,
    serviceRating: 3,
    environmentRating: 4,
    eventRating: 3,
    overallRating: 3,
    heardAbout: HeardAbout.SOCIAL_MEDIA,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Okay for the price point.",
  },
  {
    guestName: "Sharmin Sultana",
    contact: "01788889999",
    foodRating: 5,
    serviceRating: 5,
    environmentRating: 5,
    eventRating: 5,
    overallRating: 5,
    heardAbout: HeardAbout.VISITED_BEFORE,
    ageGroup: AgeGroup.AGE_18_30,
    opinion: "Best Chinese restaurant in town! Highly recommended.",
  },
  {
    guestName: "Arif Khan",
    contact: "arif@email.com",
    foodRating: 4,
    serviceRating: 4,
    environmentRating: 3,
    eventRating: 4,
    overallRating: 4,
    heardAbout: HeardAbout.FRIENDS_AND_FAMILY,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Consistent quality every time I visit.",
  },
  {
    guestName: "Rabeya Sultana",
    contact: "01811110001",
    foodRating: 5,
    serviceRating: 4,
    environmentRating: 4,
    eventRating: 4,
    overallRating: 4,
    heardAbout: HeardAbout.SOCIAL_MEDIA,
    ageGroup: AgeGroup.BELOW_18,
    opinion: "Loved the atmosphere and the Peking duck!",
  },
  {
    guestName: "Imran Hossain",
    contact: "01822220002",
    foodRating: 4,
    serviceRating: 5,
    environmentRating: 5,
    eventRating: 4,
    overallRating: 5,
    heardAbout: HeardAbout.VISITED_BEFORE,
    ageGroup: AgeGroup.AGE_51_PLUS,
    opinion: "Staff is always welcoming and professional.",
  },
  {
    guestName: "Shahidul Alam",
    contact: "01833330003",
    foodRating: 2,
    serviceRating: 3,
    environmentRating: 2,
    eventRating: 3,
    overallRating: 2,
    heardAbout: HeardAbout.SOCIAL_MEDIA,
    ageGroup: AgeGroup.AGE_31_50,
    opinion: "Very disappointed with the food quality today.",
  },
  {
    guestName: "Roksana Begum",
    contact: "01844440004",
    foodRating: 2,
    serviceRating: 2,
    environmentRating: 3,
    eventRating: 2,
    overallRating: 2,
    heardAbout: HeardAbout.FRIENDS_AND_FAMILY,
    ageGroup: AgeGroup.AGE_51_PLUS,
    opinion: "Worst experience ever. Will not recommend to anyone.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomPastDate(maxDaysAgo: number): Date {
  const ms = Math.floor(Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - ms);
}

function createFeedbackId(branchCode: string, date: Date): string {
  const branchPrefix = branchCode.replace("X-", "").toUpperCase() || "01";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const random = Math.floor(100 + Math.random() * 900);
  return `${branchPrefix}${month}${day}${random}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error(
      "Refusing to seed in production — this script wipes existing data. " +
        "Set ALLOW_PRODUCTION_SEED=true to override.",
    );
  }
  console.log("🌱 Seeding database...\n");

  await prisma.$transaction([
    prisma.guestFeedback.deleteMany(),
    prisma.guestComplaint.deleteMany(),
    prisma.bpCpEntry.deleteMany(),
    prisma.managerReport.deleteMany(),
    prisma.guestDiscountLog.deleteMany(),
    prisma.guestEntertainmentLog.deleteMany(),
    prisma.monthlyInventoryLine.deleteMany(),
    prisma.monthlyInventoryStatement.deleteMany(),
    prisma.inventoryItem.deleteMany(),
    prisma.inventoryCategory.deleteMany(),
    prisma.user.deleteMany(),
    prisma.systemSetting.deleteMany(),
  ]);

  await prisma.branch.deleteMany();
  console.log("  ✓ Cleared existing data");

  const createdBranches = await Promise.all(
    BRANCHES.map((b) =>
      prisma.branch.create({
        data: {
          name: b.name,
          code: b.code,
          address: b.address,
          phone: b.phone.join(", "),
          latitude: b.latitude,
          longitude: b.longitude,
        },
        select: { id: true, code: true, name: true },
      }),
    ),
  );

  // Added dynamic parameter typing (b: any) to resolve implicit 'any' compile error
  const branchMap = new Map(createdBranches.map((b: any) => [b.code, b.id]));
  console.log(`  ✓ Branches: ${createdBranches.length} created`);
  createdBranches.forEach((b: any) =>
    console.log(`      ${b.code} — ${b.name}`),
  );

  const superAdminPw = await bcrypt.hash(
    resolveSeedPassword("SEED_SUPER_ADMIN_PASSWORD", "Super Admin"),
    SALT_ROUNDS,
  );
  const adminPw = await bcrypt.hash(
    resolveSeedPassword("SEED_ADMIN_PASSWORD", "Admin"),
    SALT_ROUNDS,
  );
  const managerPassword = resolveSeedPassword("SEED_MANAGER_PASSWORD", "Branch Managers");

  const managerHashPromises = BRANCH_MANAGERS.map(async (m) => ({
    ...m,
    hashedPassword: await bcrypt.hash(managerPassword, SALT_ROUNDS),
  }));
  const managersWithHashes = await Promise.all(managerHashPromises);

  await prisma.user.createMany({
    data: [
      {
        name: "Super Administrator",
        email: "superadmin@x-grouprestaurant.com",
        password: superAdminPw,
        role: Role.SUPER_ADMIN,
      },
      {
        name: "System Administrator",
        email: "admin@x-grouprestaurant.com",
        password: adminPw,
        role: Role.ADMIN,
      },
      ...managersWithHashes
        .filter((m) => {
          if (!branchMap.has(m.code)) {
            console.warn(
              `  ⚠ No branch for code ${m.code}, skipping manager ${m.email}`,
            );
            return false;
          }
          return true;
        })
        .map((m) => ({
          name: m.name,
          email: m.email,
          password: m.hashedPassword,
          role: Role.BRANCH_MANAGER,
          branchId: branchMap.get(m.code)!,
        })),
    ],
  });
  console.log(
    `  ✓ Users: 1 super admin, 1 admin, ${managersWithHashes.length} branch managers`,
  );

  const FEEDBACK_COUNT = 120;
  const branchCodes = Array.from(branchMap.keys());

  await prisma.guestFeedback.createMany({
    data: Array.from({ length: FEEDBACK_COUNT }, (_, i) => {
      const code = branchCodes[i % branchCodes.length]!;
      const tpl = FEEDBACK_TEMPLATES[i % FEEDBACK_TEMPLATES.length]!;
      const submittedAt = randomPastDate(180);

      return {
        feedbackId: createFeedbackId(code, submittedAt),
        branchId: branchMap.get(code)!,
        guestName: tpl.guestName,
        contact: tpl.contact,
        foodRating: tpl.foodRating,
        serviceRating: tpl.serviceRating,
        environmentRating: tpl.environmentRating,
        eventRating: tpl.eventRating,
        overallRating: tpl.overallRating,
        heardAbout: tpl.heardAbout,
        ageGroup: tpl.ageGroup,
        opinion: tpl.opinion,
        submittedAt,
      };
    }),
  });
  console.log(
    `  ✓ Feedbacks: ${FEEDBACK_COUNT} samples (spread over last 6 months)`,
  );

  await prisma.systemSetting.createMany({
    data: [
      { key: "company_name", value: "X-Group Restaurant" },
      { key: "contact_email", value: "info@x-grouprestaurant.com" },
      { key: "contact_phone", value: "01329661662" },
      { key: "feedback_form_active", value: "true" },
      { key: "company_address", value: "212 New Elephant Road, Dhaka-1205" },
    ],
  });
  console.log("  ✓ Settings: defaults created");

  // ─── Inventory master data (seed categories & items from the paper form) ───
  for (const category of INVENTORY_CATALOG) {
    const created = await prisma.inventoryCategory.create({
      data: { name: category.name, sortOrder: category.sortOrder },
    });
    await prisma.inventoryItem.createMany({
      data: category.items.map((name, i) => ({
        categoryId: created.id,
        name,
        sortOrder: i + 1,
      })),
    });
    console.log(`  ✓ Inventory: ${category.name} (${category.items.length} items)`);
  }

  // ─── Sample records for the new operational modules ─────────────────────────
  const managers = await prisma.user.findMany({
    where: { role: Role.BRANCH_MANAGER, branchId: { not: null } },
    select: { id: true, branchId: true },
  });
  const managerByBranch = new Map(
    managers.filter((m) => m.branchId != null).map((m) => [m.branchId!, m.id]),
  );
  const adminUser = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    select: { id: true },
  });
  const superAdminUser = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN },
    select: { id: true },
  });

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayStr = new Date(today.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  // 2 manager reports (yesterday + today) for the first two branches
  const sampleBranches = createdBranches.slice(0, 2);
  for (let idx = 0; idx < sampleBranches.length; idx += 1) {
    const branch = sampleBranches[idx]!;
    const managerId = managerByBranch.get(branch.id) ?? superAdminUser?.id;
    if (!managerId) continue;

    await prisma.managerReport.create({
      data: {
        branchId: branch.id,
        managerName: branch.name,
        reportDate: new Date(idx === 0 ? yesterdayStr : todayStr),
        managerComments:
          "শিফট শেষে ম্যানেজমেন্ট কে জানানো জরুরী বিষয়গুলো রেকর্ড করা হয়েছে।",
        supplyPurchaseIssues:
          "কিছু কাঁচামালের সাপ্লাই দেরি হয়েছে, সরবরাহকারীর সাথে যোগাযোগ চলছে।",
        briefingPoints:
          "স্টাফ ব্রিফিংয়ে সকালের টার্গেট নিয়ে আলোচনা করা হয়েছে।",
        dailyLearnings: "লাঞ্চ টাইমে স্টাফ শিফট রোটেশন আরও ভালোভাবে করতে হবে।",
        createdByUserId: managerId,
        complaints: {
          create: [
            {
              guestName: "কাস্টমার রবিন",
              mobile: "01711110000",
              email: "robin@example.com",
              complaintDetails: "অর্ডার ডেলিভারি দেরি হয়েছে।",
              serviceProviderName: "ওয়েটার কামাল",
              responsiblePerson: "শিফট ম্যানেজার",
              actionTaken: "ক্ষমা চাওয়া হয়েছে ও ডেজার্ট পরিবেশন করা হয়েছে।",
              solution: "ডেলিভারি টাইম মনিটরিং বৃদ্ধি করা হয়েছে।",
            },
            {
              guestName: "কাস্টমার সুমাইয়া",
              mobile: "01722220000",
              complaintDetails: "ফুড কুয়ালিটি নিয়ে অভিযোগ।",
              serviceProviderName: "চেফ",
              responsiblePerson: "চেফ ইন চার্জ",
              actionTaken: "ডিশ রি-মেক করে পরিবেশন করা হয়েছে।",
              solution: "কুয়ালিটি চেক প্রসেস শক্তিশালী করা হয়েছে।",
            },
          ],
        },
        bpCpEntries: {
          create: [
            {
              entryType: BpCpEntryType.TODAY,
              guestName: "মেহেদী",
              mobile: "01733330000",
              comment: "আজকের ভিজিট, পরিচিত কাস্টমার।",
            },
            {
              entryType: BpCpEntryType.TOMORROW,
              guestName: "নাফিসা",
              mobile: "01744440000",
              comment: "আগামীকাল ফ্যামিলি ডিনার রিজার্ভেশন।",
            },
          ],
        },
      },
    });
  }
  console.log(`  ✓ Manager Reports: ${sampleBranches.length} sample reports`);

  // Guest discount logs (1 approved + 1 pending) + 1 entertainment log
  const branch0 = createdBranches[0]!;
  const branch1 = createdBranches[1]!;
  const manager0 = managerByBranch.get(branch0.id) ?? adminUser?.id;

  if (manager0) {
    await prisma.guestDiscountLog.create({
      data: {
        branchId: branch0.id,
        logDate: new Date(todayStr),
        guestName: "হাবিবুর রহমান",
        mobile: "01755550000",
        hadLunch: true,
        hadDinner: false,
        totalBill: 4500,
        discountPercent: 10,
        discountAmount: 450,
        reasonForDiscount: "বিবাহবার্ষিকী উপলক্ষে বিশেষ ছাড়।",
        offeredByUserId: manager0,
        approvalStatus: ApprovalStatus.APPROVED,
        verifiedByUserId: adminUser?.id ?? null,
        approvedByUserId: adminUser?.id ?? null,
        approvedAt: new Date(),
      },
    });
    await prisma.guestDiscountLog.create({
      data: {
        branchId: branch1.id,
        logDate: new Date(yesterdayStr),
        guestName: "শারমিন",
        mobile: "01766660000",
        hadLunch: false,
        hadDinner: true,
        totalBill: 3200,
        discountPercent: 5,
        discountAmount: 160,
        reasonForDiscount: "বারবার আসা কাস্টমার, লয়্যালটি ডিসকাউন্ট।",
        offeredByUserId: managerByBranch.get(branch1.id) ?? manager0,
        approvalStatus: ApprovalStatus.PENDING,
      },
    });
    await prisma.guestEntertainmentLog.create({
      data: {
        branchId: branch0.id,
        logDate: new Date(todayStr),
        guestName: "সজীব ও তার দল",
        mobile: "01777770000",
        hadLunch: true,
        hadDinner: true,
        foodName: "চীজ কর্ন স্যুপ",
        foodCost: 1200,
        reasonForEntertainment:
          "নতুন ব্রাঞ্চ উদ্বোধন উপলক্ষে পরিচিত কাস্টমারকে এন্টারটেইন।",
        offeredByUserId: manager0,
        approvalStatus: ApprovalStatus.PENDING,
      },
    });
    console.log("  ✓ Guest Offers: 2 discount logs + 1 entertainment log");
  }

  // Inventory statements: previous month (filled) + current month (opening carried)
  const activeItems = await prisma.inventoryItem.findMany({
    where: { isDeleted: false, isActive: true },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });

  if (activeItems.length && manager0) {
    const now = new Date();
    const prevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const curMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const prevStatement = await prisma.monthlyInventoryStatement.create({
      data: {
        branchId: branch0.id,
        statementMonth: prevMonth,
        status: InventoryStatementStatus.SUBMITTED,
        submittedByUserId: manager0,
        submittedAt: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 20),
        ),
        lines: {
          create: activeItems.map((item, i) => ({
            itemId: item.id,
            openingStock: 10 + i,
            added: 5,
            brokenLost: i % 3 === 0 ? 1 : 0,
            reject: i % 5 === 0 ? 1 : 0,
            closingStock:
              10 + i + 5 - (i % 3 === 0 ? 1 : 0) - (i % 5 === 0 ? 1 : 0),
          })),
        },
      },
    });

    const prevLines = await prisma.monthlyInventoryLine.findMany({
      where: { statementId: prevStatement.id },
      select: { itemId: true, closingStock: true },
    });
    const prevClosing = new Map(
      prevLines.map((l) => [l.itemId, l.closingStock]),
    );

    await prisma.monthlyInventoryStatement.create({
      data: {
        branchId: branch0.id,
        statementMonth: curMonth,
        status: InventoryStatementStatus.DRAFT,
        lines: {
          create: activeItems.map((item) => ({
            itemId: item.id,
            openingStock: prevClosing.get(item.id) ?? 0,
          })),
        },
      },
    });
    console.log(
      `  ✓ Inventory Statements: previous month filled + current month (${activeItems.length} lines each)`,
    );
  }

  console.log("\n✅ Seeding complete.\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
