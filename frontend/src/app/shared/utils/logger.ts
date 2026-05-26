/**
 * Lightweight logger.
 *
 * - `debug`/`info` are silenced in production builds (so the bundle still
 *   contains them, but they are no-ops to keep console noise out of users'
 *   browsers).
 * - `warn`/`error` always reach the console — these are the ones the support
 *   team needs to see.
 *
 * Wire this through a structured/remote sink (Application Insights,
 * Sentry, etc.) by replacing the implementations once a vendor is chosen.
 */
import { environment } from '../../../environments/environment';

const isProd = environment.production;

export const logger = {
  debug: (...args: unknown[]): void => {
    if (!isProd) {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (!isProd) {
      // eslint-disable-next-line no-console
      console.info(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
};
