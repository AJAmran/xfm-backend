import { INVENTORY_CATALOG } from "./inventory-catalog";
import { runScript } from "./seed-utils";

async function main() {
  await runScript("📦 Syncing inventory catalog...", async (prisma) => {
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
  });
}

main();
