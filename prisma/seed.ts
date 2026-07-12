import { Role, HeardAbout, AgeGroup } from "../generated/prisma/enums";
import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";

// Seed creates its own Prisma instance (separate from the app) so it can be run
// independently without importing the full app's module graph.
const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

// ─── Static data ──────────────────────────────────────────────────────────────

const BRANCHES = [
  { code: "X-01", name: "Xian Restaurant", address: "212 New Elephant Road, Dhaka-1205", phone: ["01329661662"], latitude: 23.7418, longitude: 90.3927 },
  { code: "X-02", name: "Xenial Restaurant", address: "House No. 06 (New), Road No. 16 (Old 27), Dhanmondi, Dhaka-1209", phone: ["01329661663"], latitude: 23.7465, longitude: 90.3753 },
  { code: "X-03", name: "Xiamen Restaurant", address: "House No. 55A, Road No. 4A (New), Satmasjid Road, Dhanmondi, Dhaka-1209", phone: ["01755636260", "0258617163"], latitude: 23.7467, longitude: 90.3746 },
  { code: "X-04", name: "Golden Chimney Restaurant", address: "80/14/A Mymensingh Road, Sonargaon Road, Banglamotor, Dhaka-1000", phone: ["01755636261", "02223363969"], latitude: 23.7388, longitude: 90.3956 },
  { code: "X-05", name: "Xindian Restaurant", address: "House No. 55/55A, Road No. 16, Dhanmondi, Dhaka-1209", phone: ["01755636262", "0258150396"], latitude: 23.7468, longitude: 90.3750 },
  { code: "X-06", name: "Xinxian Restaurant, Dhanmondi", address: "House No. 7, Road No. 8, Dhanmondi, Dhaka-1205", phone: ["01755636263", "04478778843"], latitude: 23.7452, longitude: 90.3765 },
  { code: "X-07", name: "Four Seasons Restaurant, Dhanmondi", address: "House No. 59A, Road No. 16, Satmasjid Road, Dhanmondi, Dhaka-1209", phone: ["01755636264", "0241020520"], latitude: 23.7469, longitude: 90.3749 },
  { code: "X-08", name: "Xinxian Restaurant, Mirpur-10", address: "6/C, 8/11, Mirpur-11, Dhaka", phone: ["01755636265", "0248032146"], latitude: 23.8244, longitude: 90.3665 },
  { code: "X-09", name: "Chung Wah Restaurant", address: "203, Shaheed Syed Nazrul Islam Sarani, Bijoy Nagar, Dhaka", phone: ["01755636267", "029553263"], latitude: 23.7334, longitude: 90.4123 },
  { code: "X-11", name: "Xinxian Restaurant, Uttara", address: "House No. 1, Road No. 8, Sector-1, Uttara Model Town, Dhaka-1230", phone: ["01755636266", "0248958051"], latitude: 23.8742, longitude: 90.3987 },
  { code: "X-12", name: "Shimanto Convention Center", address: "75, Bir Uttom M A Rob Road, 4th Floor, Shimanto Square Market, Dhanmondi, Dhaka", phone: ["01755636268", "01755636321"], latitude: 23.7441, longitude: 90.3669 },
  { code: "X-16", name: "Xinxian Restaurant, Mirpur-01", address: "Mirpur New Market, VTCB Tower (5th Floor), Main Road, Mirpur-1, Dhaka-1216", phone: ["01709678135", "01709678146"], latitude: 23.8048, longitude: 90.3548 },
  { code: "X-17", name: "Zam Zam Convention Center, Mirpur-01", address: "Mirpur New Market, VTCB Tower (4th Floor), Main Road, Mirpur-1, Dhaka-1216", phone: ["01709678145", "01709678146"], latitude: 23.8048, longitude: 90.3548 },
  { code: "X-18", name: "Zam Zam Convention Center, Mirpur-11", address: "Section-7, Main Road-03, Avenue-4, Plot-1/1, Pallabi, Mirpur, Dhaka", phone: ["01709678171", "01709678172"], latitude: 23.8271, longitude: 90.3658 },
  { code: "X-19", name: "Four Seasons Restaurant, Mirpur-11", address: "Section-7, Main Road-3, Avenue-4, Plot-1/1 (2nd Floor), Pallabi, Mirpur, Dhaka-1216", phone: ["01709678170", "01709678171"], latitude: 23.8271, longitude: 90.3658 },
];

const BRANCH_MANAGERS = [
  { code: "X-01", name: "Xian Restaurant Manager", email: "xian@x-grouprestaurant.com", password: "Xian@123" },
  { code: "X-02", name: "Xenial Restaurant Manager", email: "xenial@x-grouprestaurant.com", password: "Xenial@123" },
  { code: "X-03", name: "Xiamen Restaurant Manager", email: "xiamen@x-grouprestaurant.com", password: "Xiamen@123" },
  { code: "X-04", name: "Golden Chimney Restaurant Manager", email: "golden.chm@x-grouprestaurant.com", password: "Golden@123" },
  { code: "X-05", name: "Xindian Restaurant Manager", email: "xindian@x-grouprestaurant.com", password: "Xindian@123" },
  { code: "X-06", name: "Xinxian Restaurant, Dhanmondi Manager", email: "xinxian.dhan@x-grouprestaurant.com", password: "Dhanmondi@123" },
  { code: "X-07", name: "Four Seasons Restaurant, Dhanmondi Manager", email: "4seasons@x-grouprestaurant.com", password: "FourDhan@123" },
  { code: "X-08", name: "Xinxian Restaurant, Mirpur-10 Manager", email: "xinxian.mirpur@x-grouprestaurant.com", password: "Mirpur10@123" },
  { code: "X-09", name: "Chung Wah Restaurant Manager", email: "chungwah@x-grouprestaurant.com", password: "ChungWah@123" },
  { code: "X-11", name: "Xinxian Restaurant, Uttara Manager", email: "xinxian.uttara@x-grouprestaurant.com", password: "Uttara@123" },
  { code: "X-12", name: "Shimanto Convention Center Manager", email: "shimanto@x-grouprestaurant.com", password: "Shimanto@123" },
  { code: "X-16", name: "Xinxian Restaurant, Mirpur-01 Manager", email: "xinxian.mirpur1@x-grouprestaurant.com", password: "Mirpur01@123" },
  { code: "X-17", name: "Zam Zam Convention Center, Mirpur-01 Manager", email: "zamzam@x-grouprestaurant.com", password: "ZamZam01@123" },
  { code: "X-18", name: "Zam Zam Convention Center, Mirpur-11 Manager", email: "zamzam.mirpur@x-grouprestaurant.com", password: "ZamZam11@123" },
  { code: "X-19", name: "Four Seasons Restaurant, Mirpur-11 Manager", email: "4season@x-grouprestaurant.com", password: "Four11@123" },
];

// Feedback templates with realistic ratings (min 3 per schema) and enum values.
// overallRating 2 removed — schema minimum is 3 (consistent with Zod validation).
const FEEDBACK_TEMPLATES = [
  { guestName: "Rafiq Hasan",       contact: "01711112222",     foodRating: 5, serviceRating: 4, environmentRating: 5, eventRating: 4, overallRating: 5, heardAbout: HeardAbout.FRIENDS_AND_FAMILY, ageGroup: AgeGroup.AGE_31_50, opinion: "Excellent food and great ambiance. Will definitely come back!" },
  { guestName: "Farzana Akhter",    contact: "01722223333",     foodRating: 4, serviceRating: 3, environmentRating: 4, eventRating: 3, overallRating: 4, heardAbout: HeardAbout.SOCIAL_MEDIA,        ageGroup: AgeGroup.AGE_18_30, opinion: "Good food but service was a bit slow." },
  { guestName: "Tanvir Ahmed",      contact: "tanvir@email.com",foodRating: 3, serviceRating: 4, environmentRating: 3, eventRating: 4, overallRating: 3, heardAbout: HeardAbout.VISITED_BEFORE,      ageGroup: AgeGroup.AGE_31_50, opinion: "Average experience, nothing special." },
  { guestName: "Nusrat Jahan",      contact: "01733334444",     foodRating: 5, serviceRating: 5, environmentRating: 5, eventRating: 5, overallRating: 5, heardAbout: HeardAbout.FRIENDS_AND_FAMILY, ageGroup: AgeGroup.AGE_18_30, opinion: "Perfect dining experience! The staff was amazing." },
  { guestName: "Kamal Hossain",     contact: "01744445555",     foodRating: 3, serviceRating: 3, environmentRating: 3, eventRating: 3, overallRating: 3, heardAbout: HeardAbout.SOCIAL_MEDIA,        ageGroup: AgeGroup.AGE_51_PLUS,opinion: "Disappointing compared to my last visit." },
  { guestName: "Shamim Reza",       contact: "01755556666",     foodRating: 4, serviceRating: 4, environmentRating: 4, eventRating: 5, overallRating: 4, heardAbout: HeardAbout.VISITED_BEFORE,      ageGroup: AgeGroup.AGE_31_50, opinion: "Great place for family gatherings." },
  { guestName: "Maliha Tabassum",   contact: "01766667777",     foodRating: 5, serviceRating: 3, environmentRating: 5, eventRating: 3, overallRating: 4, heardAbout: HeardAbout.FRIENDS_AND_FAMILY, ageGroup: AgeGroup.AGE_18_30, opinion: "Food was delicious but waiting time was long." },
  { guestName: "Jahidul Islam",     contact: "01777778888",     foodRating: 3, serviceRating: 3, environmentRating: 4, eventRating: 3, overallRating: 3, heardAbout: HeardAbout.SOCIAL_MEDIA,        ageGroup: AgeGroup.AGE_31_50, opinion: "Okay for the price point." },
  { guestName: "Sharmin Sultana",   contact: "01788889999",     foodRating: 5, serviceRating: 5, environmentRating: 5, eventRating: 5, overallRating: 5, heardAbout: HeardAbout.VISITED_BEFORE,      ageGroup: AgeGroup.AGE_18_30, opinion: "Best Chinese restaurant in town! Highly recommended." },
  { guestName: "Arif Khan",         contact: "arif@email.com",  foodRating: 4, serviceRating: 4, environmentRating: 3, eventRating: 4, overallRating: 4, heardAbout: HeardAbout.FRIENDS_AND_FAMILY, ageGroup: AgeGroup.AGE_31_50, opinion: "Consistent quality every time I visit." },
  { guestName: "Rabeya Sultana",    contact: "01811110001",     foodRating: 5, serviceRating: 4, environmentRating: 4, eventRating: 4, overallRating: 4, heardAbout: HeardAbout.SOCIAL_MEDIA,        ageGroup: AgeGroup.BELOW_18,   opinion: "Loved the atmosphere and the Peking duck!" },
  { guestName: "Imran Hossain",     contact: "01822220002",     foodRating: 4, serviceRating: 5, environmentRating: 5, eventRating: 4, overallRating: 5, heardAbout: HeardAbout.VISITED_BEFORE,      ageGroup: AgeGroup.AGE_51_PLUS,opinion: "Staff is always welcoming and professional." },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a random date within the past N days for realistic trend data. */
function randomPastDate(maxDaysAgo: number): Date {
  const ms = Math.floor(Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - ms);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database...\n");

  // ── 1. Clear all data (order respects FK constraints) ──────────────────────
  await prisma.$transaction([
    prisma.guestFeedback.deleteMany(),
    prisma.user.deleteMany(),
    prisma.systemSetting.deleteMany(),
  ]);
  // Branches must be deleted after users/feedbacks due to FK constraints.
  await prisma.branch.deleteMany();
  console.log("  ✓ Cleared existing data");

  // ── 2. Create all branches in parallel ─────────────────────────────────────
  const createdBranches = await Promise.all(
    BRANCHES.map((b) =>
      prisma.branch.create({
        data: {
          name: b.name,
          code: b.code,
          address: b.address,
          // Array → comma-separated string (schema stores as String)
          phone: b.phone.join(", "),
          latitude: b.latitude,
          longitude: b.longitude,
        },
        select: { id: true, code: true, name: true },
      }),
    ),
  );
  const branchMap = new Map(createdBranches.map((b) => [b.code, b.id]));
  console.log(`  ✓ Branches: ${createdBranches.length} created`);
  createdBranches.forEach((b) => console.log(`      ${b.code} — ${b.name}`));

  // ── 3. Hash all passwords in parallel, then batch-create users ─────────────
  // bcrypt is CPU-bound; running all hashes concurrently saturates available
  // cores instead of waiting for each one sequentially.
  const superAdminPw = await bcrypt.hash("SuperAdmin@123", SALT_ROUNDS);
  const adminPw      = await bcrypt.hash("Admin@123", SALT_ROUNDS);

  const managerHashPromises = BRANCH_MANAGERS.map(async (m) => ({
    ...m,
    hashedPassword: await bcrypt.hash(m.password, SALT_ROUNDS),
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
            console.warn(`  ⚠ No branch for code ${m.code}, skipping manager ${m.email}`);
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
  console.log(`  ✓ Users: 1 super admin, 1 admin, ${managersWithHashes.length} branch managers`);

  // ── 4. Create feedback samples with spread dates (last 6 months) ───────────
  // Dates are randomised so the monthly trends chart shows meaningful data.
  const FEEDBACK_COUNT = 120; // 8 per branch across 12 templates
  const branchCodes = Array.from(branchMap.keys());

  await prisma.guestFeedback.createMany({
    data: Array.from({ length: FEEDBACK_COUNT }, (_, i) => {
      const code = branchCodes[i % branchCodes.length];
      const tpl  = FEEDBACK_TEMPLATES[i % FEEDBACK_TEMPLATES.length];
      return {
        branchId:          branchMap.get(code)!,
        guestName:         tpl.guestName,
        contact:           tpl.contact,
        foodRating:        tpl.foodRating,
        serviceRating:     tpl.serviceRating,
        environmentRating: tpl.environmentRating,
        eventRating:       tpl.eventRating,
        overallRating:     tpl.overallRating,
        heardAbout:        tpl.heardAbout,
        ageGroup:          tpl.ageGroup,
        opinion:           tpl.opinion,
        // Spread over the last 180 days so monthly trends are meaningful.
        submittedAt:       randomPastDate(180),
      };
    }),
  });
  console.log(`  ✓ Feedbacks: ${FEEDBACK_COUNT} samples (spread over last 6 months)`);

  // ── 5. Default settings ────────────────────────────────────────────────────
  await prisma.systemSetting.createMany({
    data: [
      { key: "company_name",         value: "X-Group Restaurant" },
      { key: "contact_email",        value: "info@x-grouprestaurant.com" },
      { key: "contact_phone",        value: "01329661662" },
      { key: "feedback_form_active", value: "true" },
      { key: "company_address",      value: "212 New Elephant Road, Dhaka-1205" },
    ],
  });
  console.log("  ✓ Settings: defaults created");

  console.log("\n✅ Seeding complete.\n");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
