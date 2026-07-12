# AGENTS.md — X-Group Feedback Backend

## Project Overview
REST API for collecting/managing guest feedback across restaurant branches. Express + TypeScript + Prisma + MariaDB.

## Quick Commands
- `npm run dev` — dev server with hot-reload (port 5000)
- `npm run build` — compile to dist/
- `npm run start` — run compiled dist/server.js
- `npm run lint` — `tsc --noEmit` (strict type checking; no ESLint/Prettier)
- `npm run seed` — seed DB with sample data
- `node test-all-endpoints.mjs` — E2E tests (server must be running)

## Architecture
- **Module pattern** (4 files per module): `module.route.ts`, `module.controller.ts`, `module.service.ts`, `module.validation.ts`
- **Routes** export named const (e.g., `export const AuthRoutes = route;`), mounted in `src/app.ts` under `/api/v1`
- **Controllers** extract from `req` and call services — no business logic
- **Services** contain all business logic, throw errors via `appError()`
- **Validation** uses Zod schemas, applied via `validateSchema({ body/query/params: schema })` middleware
- **Auth** uses `authGuard(Role.ADMIN, ...)` middleware on protected routes
- **Response format:** `successResponse(res, "msg", data, statusCode?)` / `errorResponse(res, "msg", errors?, statusCode?)`
- **Paginated responses:** `{ data: [...], meta: { page, limit, totalRecords, totalPages, hasNextPage, hasPreviousPage } }`

## Code Conventions
- ES Modules (`"type": "module"`), named exports only, no default exports (except app/env singletons)
- File names: `kebab-case`, functions: `camelCase`, types/interfaces: `PascalCase`
- Strict TypeScript — no `any`
- Soft deletes on users/branches via `isDeleted` flag (always filter `isDeleted: false`)
- Import path pattern: `../../utils/apiResponse`, `../../../generated/prisma/enums`
- No comments in code unless explaining complex logic

## Error Handling
```ts
import { appError } from "../../utils/appError";
throw appError("message", httpStatus.BAD_REQUEST, [{ field: "email", message: "required" }]);
```

## DB Conventions
- Prisma with MariaDB adapter, snake_case tables (`@@map`) and columns (`@map`) → camelCase in code
- Compound indexes on feedback: `[branchId, submittedAt]`, `[branchId, overallRating]`
- Parallel queries via `Promise.all()` for dashboards

## API Conventions
- Base URL: `/api/v1`
- Auth via HttpOnly cookies OR `Authorization: Bearer <token>` header
- Payload limit: 10kb
- Roles: `SUPER_ADMIN`, `ADMIN`, `BRANCH_MANAGER` (imported from `generated/prisma/enums`)

## Prisma
- Schema split across `prisma/schema/*.prisma` files
- Config: `prisma.config.ts`, migrations in `prisma/migrations/`
- Generate client: `npx prisma generate`, studio: `npx prisma studio`
- Client import: `import prisma from "../../lib/prisma";` (singleton in `src/lib/prisma.ts`)

- Generated types at `../../lib/prisma` or `../../../generated/prisma/enums`
