/**
 * Shared validation primitives. Compose these from route-specific schemas so
 * the same rules (ObjectId shape, paginated lists, …) are enforced everywhere.
 */
const { z } = require('zod');

/** Mongo ObjectId — 24 hex characters. */
const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex string');

/** ObjectId OR slug (lowercase letters, digits, dashes, 1–80 chars). */
const objectIdOrSlug = z
  .string()
  .regex(/^([a-f\d]{24}|[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?)$/i, 'Must be a valid id or slug');

/** Standard paginated query params with safe defaults. */
const paginationQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .partial({ page: true, limit: true });

const trimmedString = (min = 1, max = 500) =>
  z.string().trim().min(min).max(max);

/** Money amount in EUR cents-safe form (decimal allowed, max 2 decimals). */
const positiveAmount = z.number().positive().multipleOf(0.01).max(1_000_000);

module.exports = {
  objectId,
  objectIdOrSlug,
  paginationQuery,
  trimmedString,
  positiveAmount,
};
