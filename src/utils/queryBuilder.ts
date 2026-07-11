/** Maximum number of records that can be requested per page. */
const MAX_LIMIT = 100;

/** Maximum page number to prevent deep-offset attacks. */
const MAX_PAGE = 1000;

export interface PaginationParameters {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResultMetadata {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PrismaPaginationPayload {
  skip: number;
  take: number;
  orderBy: Record<string, "asc" | "desc">;
}

/**
 * Parses and sanitizes pagination/sort query params into a Prisma-ready
 * payload. Enforces hard limits on `limit` and `page` to prevent full
 * table dumps and deep-offset performance issues.
 */
export function transformPagination(params: PaginationParameters): PrismaPaginationPayload {
  const page = Math.min(Math.max(parseInt(params.page ?? "1", 10), 1), MAX_PAGE);
  const limit = Math.min(Math.max(parseInt(params.limit ?? "10", 10), 1), MAX_LIMIT);
  const sortBy = params.sortBy ?? "createdAt";
  const sortOrder = params.sortOrder === "asc" ? "asc" : "desc";

  return {
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { [sortBy]: sortOrder },
  };
}

export function buildMetadata(
  totalRecords: number,
  paginationArgs: PrismaPaginationPayload,
): PaginatedResultMetadata {
  const limit = paginationArgs.take;
  const page = Math.floor(paginationArgs.skip / limit) + 1;
  const totalPages = Math.ceil(totalRecords / limit) || 1;

  return {
    page,
    limit,
    totalRecords,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
