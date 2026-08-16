import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { CreateBranchInput, UpdateBranchInput, BranchQueryInput } from "./branch.validation";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import { publishDataChanged } from "../../lib/realtime";
import { withCache, invalidateByPrefix } from "../../lib/cache";

// Branch list reads are hot (every dashboard page fills its filter bar from
// them) and branches change rarely, so a short TTL cache avoids a remote-DB
// round-trip on every render. Mutations below invalidate the prefix.
const BRANCH_LIST_PREFIX = "branchList_";
const BRANCH_LIST_TTL = 60;

async function invalidateBranchListCaches(): Promise<void> {
  await invalidateByPrefix(BRANCH_LIST_PREFIX);
}

function formatBranch<T extends Record<string, unknown> | null>(branch: T): T {
  if (!branch) return branch;
  return {
    ...branch,
    latitude: Number(branch.latitude),
    longitude: Number(branch.longitude),
  } as T;
}

export async function createBranch(payload: CreateBranchInput) {
  const existing = await prisma.branch.findUnique({ where: { code: payload.code } });
  if (existing) throw appError("A branch with this code already exists", httpStatus.CONFLICT);
  const branch = await prisma.branch.create({ data: payload });
  publishDataChanged("branch.created", { type: "branch", branchId: Number(branch.id) });
  await invalidateBranchListCaches();
  return formatBranch(branch);
}

export async function getBranchById(id: number) {
  const branch = await prisma.branch.findUnique({ where: { id, isDeleted: false } });
  if (!branch) throw appError("Branch not found", httpStatus.NOT_FOUND);
  return formatBranch(branch);
}

export async function getPaginatedBranches(query: BranchQueryInput) {
  const cacheKey = `${BRANCH_LIST_PREFIX}paged:${JSON.stringify(query)}`;
  return withCache(cacheKey, async () => {
    const pagination = transformPagination(query);
    const where: Prisma.BranchWhereInput = { isDeleted: false };

    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { code: { contains: query.search } },
      ];
    }

    const [data, total] = await prisma.$transaction([
      prisma.branch.findMany({ where, ...pagination }),
      prisma.branch.count({ where }),
    ]);

    return { data: data.map(formatBranch), meta: buildMetadata(total, pagination) };
  }, BRANCH_LIST_TTL);
}

export async function updateBranch(id: number, payload: UpdateBranchInput) {
  const existing = await prisma.branch.findUnique({
    where: { id, isDeleted: false },
    select: { code: true },
  });
  if (!existing) throw appError("Branch not found", httpStatus.NOT_FOUND);

  if (payload.code && payload.code !== existing.code) {
    const dup = await prisma.branch.findUnique({ where: { code: payload.code } });
    if (dup) throw appError("A branch with this code already exists", httpStatus.CONFLICT);
  }

  const branch = await prisma.branch.update({ where: { id }, data: payload });
  publishDataChanged("branch.updated", { type: "branch", branchId: Number(branch.id) });
  await invalidateBranchListCaches();
  return formatBranch(branch);
}

/**
 * Soft-deletes a branch using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function deleteBranch(id: number) {
  const branch = await prisma.branch.update({
    where: { id, isDeleted: false },
    data: { isDeleted: true },
  });
  publishDataChanged("branch.deleted", { type: "branch", branchId: Number(branch.id) });
  await invalidateBranchListCaches();
  return branch;
}

/**
 * Toggles branch active status using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function setBranchStatus(id: number, isActive: boolean) {
  const branch = await prisma.branch.update({
    where: { id, isDeleted: false },
    data: { isActive },
  });
  publishDataChanged("branch.status", { type: "branch", branchId: Number(branch.id) });
  await invalidateBranchListCaches();
  return branch;
}

export async function getAllActiveBranches() {
  return withCache(`${BRANCH_LIST_PREFIX}active`, async () => {
    const branches = await prisma.branch.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, name: true, code: true, address: true, phone: true, latitude: true, longitude: true },
    });
    return branches.map(formatBranch);
  }, BRANCH_LIST_TTL);
}
