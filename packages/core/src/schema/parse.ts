import type { ZodError, ZodType } from "zod";

export class SchemaValidationError extends Error {
  readonly issues: ZodError["issues"];

  constructor(label: string, error: ZodError) {
    super(formatZodError(label, error));
    this.name = "SchemaValidationError";
    this.issues = error.issues;
  }
}

export function formatZodError(label: string, error: ZodError): string {
  const formattedIssues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `- ${path}: ${issue.message}`;
  });

  return [`Invalid ${label}:`, ...formattedIssues].join("\n");
}

export function parseWithSchema<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new SchemaValidationError(label, result.error);
  }

  return result.data;
}
