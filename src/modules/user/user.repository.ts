import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CreateUserInput, UpdateUserInput } from "./user.validation";
import { UserFilterCriteria } from "./user.types";
import { PrismaPaginationPayload } from "../../utils/queryBuilder";

export function createUser(data: CreateUserInput & { password: string }) {
  return prisma.user.create({ data });
}

export function findUserById(id: number) {
  return prisma.user.findUnique({ where: { id, isDeleted: false } });
}

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email, isDeleted: false } });
}

export async function findAllUsers(
  filters: UserFilterCriteria,
  pagination: PrismaPaginationPayload,
) {
  const where: Prisma.UserWhereInput = { isDeleted: false };

  if (filters.role) where.role = filters.role;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search } },
      { email: { contains: filters.search } },
    ];
  }

  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({ where, ...pagination }),
    prisma.user.count({ where }),
  ]);

  return { data, total };
}

export function updateUser(id: number, data: UpdateUserInput) {
  return prisma.user.update({ where: { id }, data });
}

/**
 * Soft-deletes a user. Throws P2025 if not found (caught by global error handler).
 */
export function softDeleteUser(id: number) {
  return prisma.user.update({ where: { id, isDeleted: false }, data: { isDeleted: true } });
}

/**
 * Updates user active status. Throws P2025 if not found (caught by global error handler).
 */
export function updateUserStatus(id: number, isActive: boolean) {
  return prisma.user.update({ where: { id, isDeleted: false }, data: { isActive } });
}
