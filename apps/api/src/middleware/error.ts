import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";
import { captureException } from "../lib/sentry.js";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        issues: err.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      },
      400,
    );
  }
  // Anything else is a real bug — log + report. Tags help filter in Sentry
  // without exposing payload details.
  logger.error({ err }, "unhandled error");
  const auth = c.get("auth") as { userId?: string } | undefined;
  const company = c.get("company") as { companyId?: string } | undefined;
  captureException(err, {
    tags: {
      "http.method": c.req.method,
      "http.path": c.req.path,
      ...(auth?.userId && { user_id: auth.userId }),
      ...(company?.companyId && { company_id: company.companyId }),
    },
  });
  return c.json(
    {
      error: "internal",
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : (err as Error).message,
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler = (c) => {
  return c.json({ error: "not_found", path: c.req.path }, 404);
};
