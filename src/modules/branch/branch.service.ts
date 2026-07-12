import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { appError } from "../../utils/appError";
import { CreateBranchInput, UpdateBranchInput, BranchQueryInput } from "./branch.validation";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";

const formatBranch = (branch: any) => {
  if (!branch) return branch;
  return {
    ...branch,
    ...(branch.latitude !== undefined ? { latitude: Number(branch.latitude) } : {}),
    ...(branch.longitude !== undefined ? { longitude: Number(branch.longitude) } : {}),
  };
};

export async function createBranch(payload: CreateBranchInput) {
  const existing = await prisma.branch.findUnique({ where: { code: payload.code } });
  if (existing) throw appError("A branch with this code already exists", httpStatus.CONFLICT);
  return formatBranch(await prisma.branch.create({ data: payload }));
}

export async function getBranchById(id: number) {
  const branch = await prisma.branch.findUnique({ where: { id, isDeleted: false } });
  if (!branch) throw appError("Branch not found", httpStatus.NOT_FOUND);
  return formatBranch(branch);
}

export async function getPaginatedBranches(query: BranchQueryInput) {
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

  return formatBranch(await prisma.branch.update({ where: { id }, data: payload }));
}

/**
 * Soft-deletes a branch using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function deleteBranch(id: number) {
  return prisma.branch.update({
    where: { id, isDeleted: false },
    data: { isDeleted: true },
  });
}

/**
 * Toggles branch active status using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function setBranchStatus(id: number, isActive: boolean) {
  return prisma.branch.update({
    where: { id, isDeleted: false },
    data: { isActive },
  });
}

export async function getAllActiveBranches() {
  return prisma.branch.findMany({
    where: { isActive: true, isDeleted: false },
    select: { id: true, name: true, code: true, address: true, phone: true },
  });
}
