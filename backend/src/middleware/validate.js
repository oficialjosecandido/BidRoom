/**
 * Centralised request validation middleware.
 *
 * Usage:
 *
 *   const { z } = require('zod');
 *   const { validate } = require('../middleware/validate');
 *
 *   const schema = z.object({
 *     body: z.object({ amount: z.number().positive() }),
 *     query: z.object({ page: z.coerce.number().int().min(1).default(1) }).optional(),
 *     params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }).optional(),
 *   });
 *
 *   router.post('/listings/:id/bid', validate(schema), handler);
 *
 * On a 400 response we return a stable `{ error, message, details: [...] }`
 * payload so the frontend can show field-level messages without parsing free
 * text.
 */
const { ZodError, z } = require('zod');
const logger = require('../utils/logger');

function formatIssues(zodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * @param {import('zod').ZodTypeAny} schema  Zod schema that may include
 *        body/query/params keys. Anything not present in the schema is left
 *        untouched on the request object.
 * @param {Object} [opts]
 * @param {boolean} [opts.replace=true]  Replace req.body/query/params with the
 *        parsed (and coerced) values. Set to false to keep the raw inputs.
 */
function validate(schema, opts = {}) {
  const { replace = true } = opts;
  return (req, res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      if (replace) {
        if (parsed.body !== undefined) req.body = parsed.body;
        if (parsed.query !== undefined) req.query = parsed.query;
        if (parsed.params !== undefined) req.params = parsed.params;
      }
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = formatIssues(err);
        logger.warn('Validation failed', {
          requestId: req.id,
          path: req.originalUrl,
          method: req.method,
          details,
        });
        return res.status(400).json({
          error: 'Validation failed',
          message: 'One or more fields are invalid.',
          details,
          requestId: req.id,
        });
      }
      return next(err);
    }
  };
}

/** Re-export the Zod namespace so callers don't need to import it separately. */
module.exports = { validate, z };
