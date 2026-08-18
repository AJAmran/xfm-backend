import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { toMonthStart, toNextMonthStart, getTodayString } from "../../utils/dateHelpers";
import { resolveBranchScope } from "../../utils/accessScope";
import { publishDataChanged } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";
import * as notificationService from "../notification/notification.service";
import { NotificationType } from "../../../generated/prisma/enums";
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
  InventoryReportQueryInput,
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

// Statement list reads hit a remote, high-latency DB on every render +
// realtime refresh. Statements change only when a manager edits/submits, so a
// short cache avoids re-round-tripping; mutations invalidate the prefix.
const STATEMENTS_LIST_PREFIX = "inventoryStatements_";
const STATEMENTS_LIST_TTL = 20;

function statementsListKey(query: InventoryStatementQueryInput, user: AuthUser): string {
  const scope = isManager(user) ? `bm_${user.branchId ?? "none"}` : "all";
  return `${STATEMENTS_LIST_PREFIX}${scope}:${JSON.stringify(query)}`;
}

async function invalidateStatementsListCaches(): Promise<void> {
  await invalidateByPrefix(STATEMENTS_LIST_PREFIX);
}

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

/**
 * A statement is the branch's "opening" one when no earlier month has a
 * statement yet. Only then is `openingStock` editable (initial physical count);
 * for every later month it is carried over from the previous closing stock.
 */
async function isOpeningStatement(branchId: number, statementMonth: Date): Promise<boolean> {
  const earlier = await prisma.monthlyInventoryStatement.findFirst({
    where: { branchId, isDeleted: false, statementMonth: { lt: statementMonth } },
    select: { id: true },
  });
  return !earlier;
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
  const category = await prisma.inventoryCategory.create({ data: payload });
  publishDataChanged("inventory.category-created", { type: "global" });
  return category;
}

export async function updateCategory(id: number, payload: InventoryCategoryUpdateInput) {
  const existing = await prisma.inventoryCategory.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory category not found", httpStatus.NOT_FOUND);
  const category = await prisma.inventoryCategory.update({ where: { id }, data: payload });
  publishDataChanged("inventory.category-updated", { type: "global" });
  return category;
}

export async function deleteCategory(id: number) {
  const existing = await prisma.inventoryCategory.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory category not found", httpStatus.NOT_FOUND);
  const category = await prisma.inventoryCategory.update({ where: { id }, data: { isDeleted: true } });
  publishDataChanged("inventory.category-deleted", { type: "global" });
  return category;
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
  const item = await prisma.inventoryItem.create({ data: payload });
  publishDataChanged("inventory.item-created", { type: "global" });
  return item;
}

export async function updateItem(id: number, payload: InventoryItemUpdateInput) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory item not found", httpStatus.NOT_FOUND);
  const item = await prisma.inventoryItem.update({ where: { id }, data: payload });
  publishDataChanged("inventory.item-updated", { type: "global" });
  return item;
}

export async function deleteItem(id: number) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id, isDeleted: false } });
  if (!existing) throw appError("Inventory item not found", httpStatus.NOT_FOUND);
  const item = await prisma.inventoryItem.update({ where: { id }, data: { isDeleted: true } });
  publishDataChanged("inventory.item-deleted", { type: "global" });
  return item;
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

  publishDataChanged("inventory.statement-created", { type: "branch", branchId });
  await invalidateStatementsListCaches();
  return formatStatement(statement);
}

export async function getPaginatedStatements(query: InventoryStatementQueryInput, user: AuthUser) {
  return withCache(statementsListKey(query, user), async () => {
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

    return {
      data: data.map(formatStatement),
      meta: buildMetadata(total, pagination),
    };
  }, STATEMENTS_LIST_TTL);
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

  const openingStockEditable = await isOpeningStatement(statement.branchId, statement.statementMonth);
  return {
    ...formatStatement(statement),
    openingStockEditable,
    lines: statement.lines.map((line) => ({ ...line, openingStockEditable })),
  };
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

  // Opening stock is only settable on the branch's first statement. For every
  // later month it is locked to the carried-over value from the previous
  // month's closing stock.
  const openingEditable = await isOpeningStatement(statement.branchId, statement.statementMonth);

  const lineByItem = new Map(statement.lines.map((l) => [l.itemId, l]));

  const updates = payload.lines.flatMap((input) => {
    const existing = lineByItem.get(input.itemId);
    if (!existing) return [];

    let openingStock = existing.openingStock;
    if (input.openingStock !== undefined) {
      if (!openingEditable) {
        throw appError(
          `Opening stock is locked for this statement (carried from the previous month's closing).`,
          httpStatus.CONFLICT,
        );
      }
      openingStock = input.openingStock;
    }

    const added = input.added ?? existing.added;
    const brokenLost = input.brokenLost ?? existing.brokenLost;
    const reject = input.reject ?? existing.reject;
    const closingStock = openingStock + added - brokenLost - reject;

    if (closingStock < 0) {
      throw appError(`Closing stock for item #${input.itemId} cannot be negative`, httpStatus.BAD_REQUEST);
    }

    if (
      openingStock === existing.openingStock &&
      added === existing.added &&
      brokenLost === existing.brokenLost &&
      reject === existing.reject
    ) {
      return [];
    }

    return [{ id: existing.id, openingStock, added, brokenLost, reject, closingStock }];
  });

  await prisma.$transaction(
    async (tx) => {
      for (const update of updates) {
        await tx.monthlyInventoryLine.update({
          where: { id: update.id },
          data: {
            openingStock: update.openingStock,
            added: update.added,
            brokenLost: update.brokenLost,
            reject: update.reject,
            closingStock: update.closingStock,
          },
        });
      }
    },
    { timeout: 30_000 },
  );

  publishDataChanged("inventory.lines-updated", { type: "branch", branchId: statement.branchId });
  await invalidateStatementsListCaches();
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

  publishDataChanged("inventory.statement-status", { type: "branch", branchId: statement.branchId });
  await invalidateStatementsListCaches();
  if (isManager(user) && payload.status === "SUBMITTED") {
    const month = new Date(updated.statementMonth).toISOString().slice(0, 7);
    await notificationService.createSubmissionNotification({
      type: NotificationType.INVENTORY_STATEMENT_SUBMITTED,
      title: "Inventory statement submitted",
      message: `${updated.submittedBy?.name ?? "A branch manager"} submitted the ${month} inventory statement for ${updated.branch.name}`,
      branchId: statement.branchId,
      entityId: updated.id,
      actorUserId: user.id,
    });
  }
  return formatStatement(updated);
}

interface InventoryTotals {
  openingStock: number;
  added: number;
  brokenLost: number;
  reject: number;
  closingStock: number;
}

function emptyTotals(): InventoryTotals {
  return { openingStock: 0, added: 0, brokenLost: 0, reject: 0, closingStock: 0 };
}

function sumTotals(target: InventoryTotals, source: InventoryTotals): void {
  target.openingStock += source.openingStock;
  target.added += source.added;
  target.brokenLost += source.brokenLost;
  target.reject += source.reject;
  target.closingStock += source.closingStock;
}

/**
 * Builds a monthly inventory report: per-branch submission status with totals
 * plus a category-level aggregate across all included statements.
 * Always bounded to a single month.
 */
export async function getInventoryReport(query: InventoryReportQueryInput, user: AuthUser) {
  const monthKey = query.statementMonth ?? getTodayString().slice(0, 7);
  const monthStart = toMonthStart(monthKey);

  const statementWhere: Prisma.MonthlyInventoryStatementWhereInput = {
    isDeleted: false,
    statementMonth: { gte: monthStart, lt: toNextMonthStart(monthKey) },
  };
  const branchWhere: Prisma.BranchWhereInput = { isDeleted: false };

  if (isManager(user)) {
    statementWhere.branchId = user.branchId ?? undefined;
    branchWhere.id = user.branchId ?? undefined;
  } else if (query.branchId) {
    statementWhere.branchId = Number(query.branchId);
    branchWhere.id = Number(query.branchId);
  }

  const [branches, statements] = await Promise.all([
    prisma.branch.findMany({
      where: branchWhere,
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    prisma.monthlyInventoryStatement.findMany({
      where: statementWhere,
      include: {
        branch: { select: { id: true, name: true, code: true } },
        submittedBy: { select: { id: true, name: true } },
        lines: {
          include: {
            item: { select: { id: true, name: true, category: { select: { id: true, name: true, sortOrder: true } } } },
          },
        },
      },
    }),
  ]);

  const stmtByBranch = new Map(statements.map((s) => [s.branchId, s]));

  const branchRows = branches.map((branch) => {
    const stmt = stmtByBranch.get(branch.id);
    if (!stmt) {
      return {
        branch,
        status: "MISSING" as const,
        submittedAt: null,
        submittedBy: null,
        lineCount: 0,
        totals: emptyTotals(),
      };
    }
    const totals = stmt.lines.reduce((acc, line) => {
      acc.openingStock += line.openingStock;
      acc.added += line.added;
      acc.brokenLost += line.brokenLost;
      acc.reject += line.reject;
      acc.closingStock += line.closingStock;
      return acc;
    }, emptyTotals());
    return {
      branch,
      status: stmt.status,
      submittedAt: stmt.submittedAt,
      submittedBy: stmt.submittedBy,
      lineCount: stmt.lines.length,
      totals,
    };
  });

  const categoryMap = new Map<number, { id: number; name: string; sortOrder: number; totals: InventoryTotals }>();
  for (const stmt of statements) {
    for (const line of stmt.lines) {
      const cat = line.item.category;
      let entry = categoryMap.get(cat.id);
      if (!entry) {
        entry = { id: cat.id, name: cat.name, sortOrder: cat.sortOrder, totals: emptyTotals() };
        categoryMap.set(cat.id, entry);
      }
      sumTotals(entry.totals, {
        openingStock: line.openingStock,
        added: line.added,
        brokenLost: line.brokenLost,
        reject: line.reject,
        closingStock: line.closingStock,
      });
    }
  }

  const categoryTotals = [...categoryMap.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ id, name, totals }) => ({ id, name, totals }));

  const nonDraft = statements.filter((s) => s.status !== "DRAFT").length;

  return {
    month: monthKey,
    summary: {
      totalBranches: branches.length,
      branchesWithStatement: statements.length,
      submitted: nonDraft,
      locked: statements.filter((s) => s.status === "LOCKED").length,
      missing: branches.length - statements.length,
    },
    branches: branchRows,
    categoryTotals,
  };
}
