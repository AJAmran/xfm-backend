import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { toMonthStart, toNextMonthStart } from "../../utils/dateHelpers";
import { resolveBranchScope } from "../../utils/accessScope";
import {
  InventoryCategoryCreateInput,
  InventoryCategoryUpdateInput,
  InventoryItemCreateInput,
  InventoryItemUpdateInput,
  InventoryStatementCreateInput,
  InventoryStatementQueryInput,
  InventoryItemQueryInput,
  InventoryLineUpdateInput,
  InventoryStatementStatusInput,
} from "./inventory.validation";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

const STATEMENT_INCLUDE = {
  branch: { select: { id: true, name: true, code: true } },
  submittedBy: { select: { id: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.MonthlyInventoryStatementInclude;

function formatStatement<T extends { statementMonth: Date | string }>(stmt: T): T {
  const statementMonth =
    stmt.statementMonth instanceof Date
      ? stmt.statementMonth.toISOString().slice(0, 7)
      : stmt.statementMonth;
  return { ...stmt, statementMonth } as T;
}

function isManager(user: AuthUser): boolean {
  return user.role === "BRANCH_MANAGER";
}

// ─── Category master ──────────────────────────────────────────────────────────

export async function getCategories(includeInactive = false) {
  return prisma.inventoryCategory.findMany({
    where: includeInactive ? { isDeleted: false } : { isDeleted: false, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      items: {
        where: { isDeleted: false },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });
}

export async function createCategory(payload: InventoryCategoryCreateInput) {
  return prisma.inventoryCategory.create({ data: payload });
}

export async function updateCategory(id: number, payload: InventoryCategoryUpdateInput) {
  const existing = await prisma.inventoryCategory.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory category not found", httpStatus.NOT_FOUND);
  return prisma.inventoryCategory.update({ where: { id }, data: payload });
}

export async function deleteCategory(id: number) {
  const existing = await prisma.inventoryCategory.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory category not found", httpStatus.NOT_FOUND);
  return prisma.inventoryCategory.update({ where: { id }, data: { isDeleted: true } });
}

// ─── Item master ──────────────────────────────────────────────────────────────

export async function getItems(query: InventoryItemQueryInput) {
  const pagination = transformPagination(query);
  const where: Prisma.InventoryItemWhereInput = { isDeleted: false };
  if (query.categoryId) where.categoryId = Number(query.categoryId);

  const [data, total] = await prisma.$transaction([
    prisma.inventoryItem.findMany({
      where,
      ...pagination,
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  return { data, meta: buildMetadata(total, pagination) };
}

export async function createItem(payload: InventoryItemCreateInput) {
  return prisma.inventoryItem.create({ data: payload });
}

export async function updateItem(id: number, payload: InventoryItemUpdateInput) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory item not found", httpStatus.NOT_FOUND);
  return prisma.inventoryItem.update({ where: { id }, data: payload });
}

export async function deleteItem(id: number) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory item not found", httpStatus.NOT_FOUND);
  return prisma.inventoryItem.update({ where: { id }, data: { isDeleted: true } });
}

// ─── Monthly statements ───────────────────────────────────────────────────────

export async function createStatement(payload: InventoryStatementCreateInput, user: AuthUser) {
  const branchId = resolveBranchScope(payload.branchId, user);
  const monthStart = toMonthStart(payload.statementMonth);

  const existing = await prisma.monthlyInventoryStatement.findUnique({
    where: { branchId_statementMonth: { branchId, statementMonth: monthStart } },
    select: { isDeleted: true },
  });
  if (existing && !existing.isDeleted) {
    throw appError("An inventory statement already exists for this branch for this month", httpStatus.CONFLICT);
  }

  const [items, prevStatement] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.monthlyInventoryStatement.findFirst({
      where: { branchId, isDeleted: false, statementMonth: { lt: monthStart } },
      orderBy: { statementMonth: "desc" },
      include: { lines: { select: { itemId: true, closingStock: true } } },
    }),
  ]);

  const prevClosing = new Map(prevStatement?.lines.map((l) => [l.itemId, l.closingStock]) ?? []);

  const statement = await prisma.$transaction((tx) =>
    tx.monthlyInventoryStatement.create({
      data: {
        branchId,
        statementMonth: monthStart,
        submittedByUserId: isManager(user) ? user.id : null,
        lines: {
          create: items.map((item) => ({
            itemId: item.id,
            openingStock: prevClosing.get(item.id) ?? 0,
          })),
        },
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        lines: {
          include: { item: { select: { id: true, name: true, category: { select: { id: true, name: true } } } } },
        },
      },
    }),
  );

  return formatStatement(statement);
}

export async function getPaginatedStatements(query: InventoryStatementQueryInput, user: AuthUser) {
  const pagination = transformPagination(query);
  const where: Prisma.MonthlyInventoryStatementWhereInput = { isDeleted: false };
  if (isManager(user)) where.branchId = user.branchId ?? undefined;
  else if (query.branchId) where.branchId = Number(query.branchId);
  if (query.statementMonth) {
    const monthStart = toMonthStart(query.statementMonth);
    where.statementMonth = { gte: monthStart, lt: toNextMonthStart(query.statementMonth) };
  }
  if (query.status) where.status = query.status;

  const [data, total] = await prisma.$transaction([
    prisma.monthlyInventoryStatement.findMany({ where, ...pagination, include: STATEMENT_INCLUDE }),
    prisma.monthlyInventoryStatement.count({ where }),
  ]);

  return { data: data.map(formatStatement), meta: buildMetadata(total, pagination) };
}

export async function getStatementById(id: number, user: AuthUser) {
  const statement = await prisma.monthlyInventoryStatement.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      submittedBy: { select: { id: true, name: true } },
      lines: {
        include: { item: { select: { id: true, name: true, sortOrder: true, category: { select: { id: true, name: true, sortOrder: true } } } } },
      },
    },
  });
  if (!statement || statement.isDeleted) throw appError("Inventory statement not found", httpStatus.NOT_FOUND);
  if (isManager(user) && statement.branchId !== user.branchId) {
    throw appError("Forbidden: You do not have access to this statement", httpStatus.FORBIDDEN);
  }
  return formatStatement(statement);
}

/** Returns a statement's lines as a flat array with nested item + category. */
export async function getStatementLines(id: number, user: AuthUser) {
  const statement = await getStatementById(id, user);
  return statement.lines;
}

export async function updateStatementLines(id: number, payload: InventoryLineUpdateInput, user: AuthUser) {
  const statement = await prisma.monthlyInventoryStatement.findUnique({
    where: { id },
    include: { lines: { select: { id: true, itemId: true, openingStock: true, added: true, brokenLost: true, reject: true } } },
  });
  if (!statement || statement.isDeleted) throw appError("Inventory statement not found", httpStatus.NOT_FOUND);
  if (statement.status === "LOCKED") throw appError("Locked statements cannot be edited", httpStatus.CONFLICT);
  if (isManager(user) && statement.branchId !== user.branchId) {
    throw appError("Forbidden: You can only edit your own branch's statement", httpStatus.FORBIDDEN);
  }

  const lineByItem = new Map(statement.lines.map((l) => [l.itemId, l]));

  await prisma.$transaction(async (tx) => {
    for (const input of payload.lines) {
      const existing = lineByItem.get(input.itemId);
      if (!existing) continue;

      const added = input.added ?? existing.added;
      const brokenLost = input.brokenLost ?? existing.brokenLost;
      const reject = input.reject ?? existing.reject;
      const closingStock = existing.openingStock + added - brokenLost - reject;

      if (closingStock < 0) {
        throw appError(`Closing stock for item #${input.itemId} cannot be negative`, httpStatus.BAD_REQUEST);
      }

      await tx.monthlyInventoryLine.update({
        where: { id: existing.id },
        data: { added, brokenLost, reject, closingStock },
      });
    }
  });

  return getStatementLines(id, user);
}

export async function updateStatementStatus(id: number, payload: InventoryStatementStatusInput, user: AuthUser) {
  const statement = await prisma.monthlyInventoryStatement.findUnique({ where: { id }, select: { branchId: true, status: true, isDeleted: true } });
  if (!statement || statement.isDeleted) throw appError("Inventory statement not found", httpStatus.NOT_FOUND);

  const data: Prisma.MonthlyInventoryStatementUncheckedUpdateInput = { status: payload.status };

  if (payload.status === "SUBMITTED") {
    if (isManager(user) && statement.branchId !== user.branchId) {
      throw appError("Forbidden: You can only submit your own branch's statement", httpStatus.FORBIDDEN);
    }
    if (statement.status === "LOCKED") throw appError("Locked statements cannot be changed", httpStatus.CONFLICT);
    data.submittedByUserId = user.id;
    data.submittedAt = new Date();
  } else if (payload.status === "LOCKED") {
    if (isManager(user)) throw appError("Forbidden: Only admins can lock statements", httpStatus.FORBIDDEN);
    if (statement.status === "DRAFT") throw appError("Statement must be submitted before it can be locked", httpStatus.CONFLICT);
  }

  const updated = await prisma.monthlyInventoryStatement.update({
    where: { id },
    data,
    include: STATEMENT_INCLUDE,
  });

  return formatStatement(updated);
}
