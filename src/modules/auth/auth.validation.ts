import { z } from "zod";

export const loginValidationSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});
