import httpStatus from "http-status";
import { appError } from "./appError";

interface AuthUserScope {
  role: string;
  branchId: number | null;
}

/**
 * Resolves which branch a mutation applies to.
 * - BRANCH_MANAGER is always forced to their own branch.
 * - ADMIN / SUPER_ADMIN must provide branchId explicitly.
 */
export function resolveBranchScope(branchId: number | undefined, user: AuthUserScope): number {
  if (user.role === "BRANCH_MANAGER") {
    if (!user.branchId) throw appError("No branch is assigned to your account", httpStatus.FORBIDDEN);
    if (branchId && branchId !== user.branchId) {
      throw appError("Forbidden: You can only operate on your own branch", httpStatus.FORBIDDEN);
    }
    return user.branchId;
  }
  if (!branchId) throw appError("branchId is required", httpStatus.BAD_REQUEST);
  return branchId;
}

/** Rounds a value to 2 decimal places (money precision). */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
