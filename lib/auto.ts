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

import debug from 'debug';
import resolveALPN from 'resolve-alpn';

import { HttpClient } from './http.js';
import { WebSocketClient } from './websocket.js';
import { HTTPTimeouts } from './http.js';

const error = debug('@oada/client:auto:error');

function tryDomain(domain: string) {
  const url = new URL(domain);
  switch (url.protocol) {
    case 'http2:': {
      return Object.assign(url, {
        port: Number(url.port) || 80,
        protocols: ['h2'],
      });
    }

    case 'https:': {
      return Object.assign(url, {
        port: Number(url.port) || 443,
        protocols: ['h2', 'http/1.1', 'http/1.0'],
      });
    }

    case 'http:': {
      return Object.assign(url, {
        port: Number(url.port) || 80,
        protocols: ['http/1.1', 'http/1.0'],
      });
    }

    default: {
      throw new Error(`Unsupported domain protocol: ${url.protocol}`);
    }
  }
}

export function parseDomain(domain: string) {
  try {
    return tryDomain(domain);
  } catch {
    // Assume https?
    return tryDomain(`https://${domain}`);
  }
}

/**
 * Try to pick most appropriate connection type.
 */
export async function autoConnection({
  domain,
  token,
  concurrency,
  userAgent,
  timeouts,
}: {
  domain: string;
  token: string;
  concurrency: number;
  userAgent: string;
  timeouts: HTTPTimeouts;
}) {
  try {
    const { hostname, port, protocols } = parseDomain(domain);

    const { alpnProtocol } = await resolveALPN({
      host: hostname,
      servername: hostname,
      port,
      rejectUnauthorized: false,
      ALPNProtocols: protocols,
    });
    switch (alpnProtocol) {
      // Prefer HTTP/2
      case 'h2': {
        return new HttpClient(domain, token, { concurrency, userAgent, timeouts });
      }

      // If no HTTP/2, use a WebSocket
      case 'http/1.1':
      case 'http/1.0': {
        return new WebSocketClient(domain, { concurrency, userAgent });
      }

      default: {
        throw new Error(`Unsupported ALPN protocol: ${alpnProtocol}`);
      }
    }
  } catch (cError: unknown) {
    // Fallback to HTTP on error
    error(cError, 'Failed to auto pick connection type, falling back to HTTP');
    return new HttpClient(domain, token, { concurrency, userAgent, timeouts });
  }
}
