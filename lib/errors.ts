/**
 * @license
 * Copyright 2021 Open Ag Data Alliance
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Stuff for having client handle "recoverable" errors
 * rather than passing everything up to the user
 *
 * @packageDocumentation
 */

import { setTimeout } from 'isomorphic-timers-promises';

// eslint-disable-next-line node/no-extraneous-import -- hack for skypack?
import { Headers } from '@oada/client/dist/fetch.js';
import debug from 'debug';

import type { IConnectionResponse } from './client.js';
import { fixError } from './utils.js';

const warn = debug('@oada/client:errors:warn');
const trace = debug('@oada/client:errors:trace');

/**
 * Wait 5 minutes if 429 with no Retry-After header
 *
 * @todo add override for this in client config?
 */
const DEFAULT_RETRY_TIMEOUT = 5 * 60 * 10_000;

/**
 * Handle rate limit errors
 *
 * Wait the length specified by Retry-After header,
 * or `DEFAULT_RETRY_TIMEOUT` if the header is not present.
 */
async function handleRatelimit<R extends unknown[]>(
  error: unknown,
  request: (...arguments_: R) => Promise<IConnectionResponse>,
  ...rest: R
) {
  // @ts-expect-error stupid errors
  const headers = new Headers(error.headers);

  // Figure out how many ms to wait
  // Header is either number of seconds, or a date/time
  const retry = headers.get('Retry-After');
  const timeout = retry
    ? Number(retry) * 1000 || Number(new Date(retry)) - Date.now()
    : DEFAULT_RETRY_TIMEOUT;

  // @ts-expect-error stupid errors
  warn('Received %s, retrying in %d ms', error.status, timeout);
  await setTimeout(timeout);

  return handleErrors(request, ...rest);
}

/**
 * Handle connection reset
 *
 * Wait a while then try to connect again.
 */
async function handleReset<R extends unknown[]>(
  error: unknown,
  request: (...arguments_: R) => Promise<IConnectionResponse>,
  ...rest: R
) {
  warn(error, 'Connection reset, retrying in 10000 ms');
  await setTimeout(10_000);

  return handleErrors(request, ...rest);
}

/**
 * Handle any errors that client can deal with,
 * otherwise reject with original error.
 */
export async function handleErrors<R extends unknown[]>(
  request: (...arguments_: R) => Promise<IConnectionResponse>,
  ...rest: R
): Promise<IConnectionResponse> {
  try {
    return await request(...rest);
  } catch (cError: unknown) {
    // FIXME: WTF why is error an array sometimes???
    // @ts-expect-error stupid error handling
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const error = cError?.[0]?.error ?? cError?.[0] ?? cError?.error ?? cError;
    trace(error, 'Attempting to handle error');
    // @ts-expect-error stupid error handling
    switch (`${error.status ?? cError?.code}`) {
      case '429':
        return await handleRatelimit(error, request, ...rest);
      // Some servers use 503 for rate limit...
      case '503': {
        const headers = new Headers(error.headers);
        if (headers.has('Retry-After')) {
          return await handleRatelimit(error, request, ...rest);
        }

        // If no Retry-After, don't assume rate-limit?
        break;
      }

      case 'ECONNRESET':
        return await handleReset(error, request, ...rest);

      default:
      // Do nothing
    }

    // Pass error up
    throw await fixError(cError as Error);
  }
}
