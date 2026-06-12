import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/ErrorCode.js";

import type { AppEnvironment } from "./context.js";
import type { Context } from "hono";
import type { z } from "zod";

type ValidationErrorDetail = {
    field: string;
    message: string;
};

function formatValidationErrors(error: z.ZodError): ValidationErrorDetail[] {
    const detailsByField = new Map<string, ValidationErrorDetail>();

    for (const issue of error.issues) {
        const field = issue.path.map(String).join(".") || "body";

        if (!detailsByField.has(field)) {
            detailsByField.set(field, {
                field,
                message: issue.message,
            });
        }
    }

    return [...detailsByField.values()];
}

export async function parseJsonBody<T>(
    c: Context<AppEnvironment>,
    schema: z.ZodType<T>,
): Promise<T> {
    let body: unknown;

    try {
        body = await c.req.json<unknown>();
    } catch {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Malformed JSON body");
    }

    const result = schema.safeParse(body);

    if (!result.success) {
        throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            "Invalid request body",
            formatValidationErrors(result.error),
        );
    }

    return result.data;
}