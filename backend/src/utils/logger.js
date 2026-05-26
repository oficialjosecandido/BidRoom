/**
 * Centralised structured logger for the BidRoom backend.
 *
 * - Emits JSON lines in production for ingestion by Azure App Service /
 *   Application Insights / Datadog / any log shipper.
 * - In development falls back to plain coloured-ish text via console so the
 *   local experience stays human-readable.
 * - Optionally forwards messages to Application Insights when
 *   APPLICATIONINSIGHTS_CONNECTION_STRING is set (best effort, never throws).
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] || LEVELS.info;
const isProd = process.env.NODE_ENV === 'production';

let appInsights = null;
let appInsightsClient = null;
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  try {
    // eslint-disable-next-line global-require
    appInsights = require('applicationinsights');
    appInsights
      .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
      .setAutoCollectConsole(false, false)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setSendLiveMetrics(false)
      .start();
    appInsightsClient = appInsights.defaultClient;
  } catch (err) {
    // Module not installed yet — keep going with stdout logging only.
    // eslint-disable-next-line no-console
    console.warn('[logger] applicationinsights not available:', err.message);
  }
}

function format(level, msg, fields) {
  if (isProd) {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields,
    });
  }
  const tail = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  return `[${level}] ${msg}${tail}`;
}

function emit(level, args) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const [first, ...rest] = args;
  let msg;
  let fields = {};

  if (first instanceof Error) {
    msg = first.message;
    fields = { stack: first.stack, ...mergeFieldArgs(rest) };
  } else if (typeof first === 'string') {
    msg = first;
    fields = mergeFieldArgs(rest);
  } else {
    msg = '';
    fields = mergeFieldArgs([first, ...rest]);
  }

  const line = format(level, msg, fields);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }

  // Best-effort Application Insights forwarding.
  if (appInsightsClient) {
    try {
      if (level === 'error') {
        if (first instanceof Error) {
          appInsightsClient.trackException({ exception: first, properties: fields });
        } else {
          appInsightsClient.trackTrace({ message: msg, severity: 3, properties: fields });
        }
      } else if (level === 'warn') {
        appInsightsClient.trackTrace({ message: msg, severity: 2, properties: fields });
      } else if (level === 'info') {
        appInsightsClient.trackTrace({ message: msg, severity: 1, properties: fields });
      }
    } catch (_) {
      // Never let observability break the app.
    }
  }
}

function mergeFieldArgs(args) {
  const out = {};
  for (const a of args) {
    if (a == null) continue;
    if (a instanceof Error) {
      out.error = a.message;
      out.stack = a.stack;
    } else if (typeof a === 'object') {
      Object.assign(out, a);
    } else {
      out.detail = out.detail ? `${out.detail} ${a}` : String(a);
    }
  }
  return out;
}

module.exports = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  /** Useful for tagging child loggers with stable context, e.g. logger.child({ requestId }). */
  child(context) {
    return {
      debug: (...args) => emit('debug', [...args, context]),
      info: (...args) => emit('info', [...args, context]),
      warn: (...args) => emit('warn', [...args, context]),
      error: (...args) => emit('error', [...args, context]),
    };
  },
};
