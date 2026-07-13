import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { appError } from "../../utils/appError";
import * as userRepo from "./user.repository";
import { CreateUserInput, UpdateUserInput, UserQueryInput } from "./user.validation";
import { UserFilterCriteria } from "./user.types";
import { transformPagination, buildMetadata } from "../../utils/queryBuilder";
import env from "../../config/env";

/** Strips the password field from a user record before returning to the client. */
function omitPassword<T extends { password: string }>(user: T): Omit<T, "password"> {
  const { password: _, ...rest } = user;
  return rest;
}

export async function createUser(payload: CreateUserInput) {
  const existing = await userRepo.findUserByEmail(payload.email);
  if (existing) throw appError("A user with this email already exists", httpStatus.CONFLICT);

  const password = await bcrypt.hash(payload.password, env.salt_rounds);
  const user = await userRepo.createUser({ ...payload, password });
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

export async function updateUser(id: number, payload: UpdateUserInput) {
  const existing = await userRepo.findUserById(id);
  if (!existing) throw appError("User not found", httpStatus.NOT_FOUND);

  if (payload.email && payload.email !== existing.email) {
    const dup = await userRepo.findUserByEmail(payload.email);
    if (dup) throw appError("A user with this email already exists", httpStatus.CONFLICT);
  }

  const updateData = { ...payload };
  if (updateData.password) {
    updateData.password = await bcrypt.hash(updateData.password, env.salt_rounds);
  }

  const user = await userRepo.updateUser(id, updateData);
  return omitPassword(user);
}

/**
 * Soft-deletes a user using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function deleteUser(id: number) {
  await userRepo.softDeleteUser(id);
}

/**
 * Toggles user active status using a single UPDATE query.
 * Relies on the global error handler to catch P2025 (record not found).
 */
export async function setUserStatus(id: number, isActive: boolean) {
  const user = await userRepo.updateUserStatus(id, isActive);
  return omitPassword(user);
}
