import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1, "Required string must not be empty");

export const stringRecordSchema = z.record(z.string(), z.string());

export const metadataSchema = z.record(z.string(), z.unknown());

export const isoDateTimeStringSchema = z.string().datetime({ offset: true });
