import { Role } from "../../../generated/prisma/enums";

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  role: Role;
  branchId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserFilterCriteria {
  search?: string;
  role?: Role;
  isActive?: boolean;
}
