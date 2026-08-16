import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { INVENTORY_CATALOG } from "./inventory-catalog";

// Idempotent sync of the inventory catalog into an EXISTING database.
// Unlike `npm run seed`, this never wipes data. It only:
//   - creates missing categories / items
//   - re-syncs sortOrder on existing rows
// Already-deleted (soft-deleted) rows are left untouched.

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
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const prisma = new PrismaClient({ adapter });

async function main() {
  let categoriesCreated = 0;
  let itemsCreated = 0;

  for (const category of INVENTORY_CATALOG) {
    let cat = await prisma.inventoryCategory.findUnique({
      where: { name: category.name },
    });
    if (!cat) {
      cat = await prisma.inventoryCategory.create({
        data: { name: category.name, sortOrder: category.sortOrder },
      });
      categoriesCreated += 1;
    } else if (cat.sortOrder !== category.sortOrder) {
      cat = await prisma.inventoryCategory.update({
        where: { id: cat.id },
        data: { sortOrder: category.sortOrder },
      });
    }

    for (const [index, name] of category.items.entries()) {
      const existing = await prisma.inventoryItem.findUnique({
        where: { categoryId_name: { categoryId: cat.id, name } },
      });
      if (!existing) {
        await prisma.inventoryItem.create({
          data: { categoryId: cat.id, name, sortOrder: index + 1 },
        });
        itemsCreated += 1;
      } else if (existing.sortOrder !== index + 1) {
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { sortOrder: index + 1 },
        });
      }
    }
  }

  console.log(
    `✓ Inventory catalog synced: ${categoriesCreated} categories created, ${itemsCreated} items created (existing rows updated only).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
