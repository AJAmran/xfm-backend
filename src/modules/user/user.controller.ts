import { Request, Response } from "express";
import httpStatus from "http-status";
import * as userService from "./user.service";
import { successResponse } from "../../utils/apiResponse";
import { UserQueryInput } from "./user.validation";

export async function create(req: Request, res: Response) {
  const user = await userService.createUser(req.body);
  successResponse(res, "User created successfully", user, httpStatus.CREATED);
}

export async function getById(req: Request, res: Response) {
  const user = await userService.getUserById(Number(req.params.id));
  successResponse(res, "User retrieved successfully", user);
}

export async function list(req: Request, res: Response) {
  const query = req.query as unknown as UserQueryInput;
  const result = await userService.getPaginatedUsers(query);
  successResponse(res, "Users retrieved successfully", result);
}

export async function update(req: Request, res: Response) {
  const user = await userService.updateUser(Number(req.params.id), req.body);
  successResponse(res, "User updated successfully", user);
}

export async function remove(req: Request, res: Response) {
  await userService.deleteUser(Number(req.params.id));
  successResponse(res, "User deleted successfully", {});
}

export async function updateStatus(req: Request, res: Response) {
  const user = await userService.setUserStatus(Number(req.params.id), req.body.isActive);
  successResponse(res, "User status updated successfully", user);
}
