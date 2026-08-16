import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { Prisma, Role } from "../../../generated/prisma/client";
import { appError } from "../../utils/appError";
import * as userRepo from "./user.repository";
import { CreateUserInput, UpdateUserInput, UserQueryInput } from "./user.validation";
import { UserFilterCriteria } from "./user.types";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import env from "../../config/env";
import { publishDataChanged } from "../../lib/realtime";
import { invalidateUserSession } from "../../lib/cache";

interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
}

/** Strips the password field from a user record before returning to the client. */
function omitPassword<T extends { password: string }>(user: T): Omit<T, "password"> {
  const { password: _, ...rest } = user;
  return rest;
}

export async function createUser(payload: CreateUserInput, caller: AuthUser) {
  if (payload.role === Role.SUPER_ADMIN && caller.role !== Role.SUPER_ADMIN) {
    throw appError("Only Super Admin accounts can create Super Admin users", httpStatus.FORBIDDEN);
  }

  const existing = await userRepo.findUserByEmail(payload.email);
  if (existing) throw appError("A user with this email already exists", httpStatus.CONFLICT);

  const password = await bcrypt.hash(payload.password, env.salt_rounds);
  const user = await userRepo.createUser({ ...payload, password });
  publishDataChanged("user.created", { type: "global" });
  return omitPassword(user);
}

export async function getUserById(id: number) {
  const user = await userRepo.findUserById(id);
  if (!user) throw appError("User not found", httpStatus.NOT_FOUND);
  return omitPassword(user);
}

export async function getPaginatedUsers(query: UserQueryInput) {
  const pagination = transformPagination(query);
  const filters: UserFilterCriteria = {};
  if (query.search) filters.search = query.search;
  if (query.role) filters.role = query.role;
  if (query.isActive !== undefined) filters.isActive = query.isActive;

  const { data, total } = await userRepo.findAllUsers(filters, pagination);
  return { data: data.map(omitPassword), meta: buildMetadata(total, pagination) };
}

export async function updateUser(id: number, payload: UpdateUserInput, caller: AuthUser) {
  const existing = await userRepo.findUserById(id);
  if (!existing) throw appError("User not found", httpStatus.NOT_FOUND);

  // Only a Super Admin may modify a Super Admin account.
  if (existing.role === Role.SUPER_ADMIN && caller.role !== Role.SUPER_ADMIN) {
    throw appError("Only Super Admin accounts can modify Super Admin accounts", httpStatus.FORBIDDEN);
  }
  if (payload.role === Role.SUPER_ADMIN && caller.role !== Role.SUPER_ADMIN) {
    throw appError("Only Super Admin accounts can grant the Super Admin role", httpStatus.FORBIDDEN);
  }

  // Prevent a Super Admin from locking themselves out of the system.
  if (caller.id === existing.id && existing.role === Role.SUPER_ADMIN) {
    if (payload.role && payload.role !== Role.SUPER_ADMIN) {
      throw appError("You cannot demote your own Super Admin account", httpStatus.FORBIDDEN);
    }
    if (payload.isActive === false) {
      throw appError("You cannot deactivate your own account", httpStatus.FORBIDDEN);
    }
  }

  if (payload.email && payload.email !== existing.email) {
    const dup = await userRepo.findUserByEmail(payload.email);
    if (dup) throw appError("A user with this email already exists", httpStatus.CONFLICT);
  }

  const updateData = { ...payload };
  if (updateData.password) {
    updateData.password = await bcrypt.hash(updateData.password, env.salt_rounds);
  }

  // Password or role changes invalidate all outstanding sessions for the user.
  if (updateData.password || (payload.role && payload.role !== existing.role)) {
    await userRepo.incrementTokenVersion(id);
  }

  const user = await userRepo.updateUser(id, updateData);
  publishDataChanged("user.updated", { type: "global" });
  // Drop the cached authGuard snapshot so role/password/status changes apply
  // to the very next request instead of lingering for the TTL window.
  await invalidateUserSession(id);
  return omitPassword(user);
}

/**
 * Soft-deletes a user using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function deleteUser(id: number) {
  const existing = await userRepo.findUserById(id);
  if (!existing) throw appError("User not found", httpStatus.NOT_FOUND);
  if (existing.role === Role.SUPER_ADMIN) {
    throw appError("Super Admin accounts cannot be deleted", httpStatus.FORBIDDEN);
  }
  await userRepo.softDeleteUser(id);
  publishDataChanged("user.deleted", { type: "global" });
  await invalidateUserSession(id);
}

/**
 * Toggles user active status using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function setUserStatus(id: number, isActive: boolean, caller: AuthUser) {
  const existing = await userRepo.findUserById(id);
  if (!existing) throw appError("User not found", httpStatus.NOT_FOUND);

  // Only a Super Admin may change another Super Admin's status.
  if (existing.role === Role.SUPER_ADMIN && caller.role !== Role.SUPER_ADMIN) {
    throw appError("Only Super Admin accounts can modify Super Admin accounts", httpStatus.FORBIDDEN);
  }
  if (caller.id === existing.id && !isActive) {
    throw appError("You cannot deactivate your own account", httpStatus.FORBIDDEN);
  }

  const user = await userRepo.updateUserStatus(id, isActive);
  publishDataChanged("user.status", { type: "global" });
  await invalidateUserSession(id);
  return omitPassword(user);
}
