/**
 * Stuff for having client handle "recoverable" errors
 * rather than passing everything up to the user
 *
 * @packageDocumentation
 */

import debug from "debug";
import { Headers } from "./fetch";

import type { ConnectionResponse } from "./client";
import { delay } from "./utils";

const warn = debug("@oada/client:errors:warn");
const trace = debug("@oada/client:errors:trace");

/**
 * Wait 5 minutes if 429 with no Retry-After header
 *
 * @todo add override for this in client config?
 */
const DEFAULT_RETY_TIMEOUT = 5 * 60 * 10000;

/**
 * Handle rate limit errors
 *
 * Wait the length specified by Retry-After header,
 * or `DEFAULT_RETY_TIMEOUT` if the header is not present.
 */
async function handleRatelimit<R extends unknown[]>(
  err: any,
  req: (...args: R) => Promise<ConnectionResponse>,
  ...args: R
) {
  const headers = new Headers(err.headers);

  // Figure out how many ms to wait
  // Header is either number of seconds, or a date/time
  const retry = headers.get("Retry-After");
  const timeout = retry
    ? +retry * 1000 || +new Date(retry) - Date.now()
    : DEFAULT_RETY_TIMEOUT;

  warn("Received %s, retrying in %d ms", err.status, timeout);
  await delay(timeout);

  return await handleErrors(req, ...args);
}

/**
 * Handle any errors that client can deal with,
 * otherwise reject with original error.
 */
export async function handleErrors<R extends unknown[]>(
  req: (...args: R) => Promise<ConnectionResponse>,
  ...args: R
): Promise<ConnectionResponse> {
  try {
    return await req(...args);
  } catch (err) {
    // TODO: WTF why is error an array sometimes???
    const e = err?.[0]?.error ?? err?.[0] ?? err?.error ?? err;
    trace(e, "Attempting to handle error");
    switch (e.status) {
      case 429:
        return await handleRatelimit(e, req, ...args);
      // Some servers use 503 for rate limit...
      case 503: {
        const headers = new Headers(e.headers);
        if (headers.has("Retry-After")) {
          return await handleRatelimit(e, req, ...args);
        }
        // If no Retry-After, don't assume rate-limit?
      }
    }
    // Pass error up
    throw err;
  }
}
