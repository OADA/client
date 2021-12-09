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

import resolveALPN from 'resolve-alpn';
import debug from 'debug';

import { HttpClient } from './http';
import { WebSocketClient } from './websocket';

const error = debug('@oada/client:auto:error');

function tryDomain(domain: string): {
  port: number;
  host: string;
  protocols: string[];
} {
  const { port, host, protocol } = new URL(domain);
  switch (protocol) {
    case 'http2:':
      return {
        port: Number(port) || 443,
        host,
        protocols: ['h2'],
      };

    case 'https:':
      return {
        port: Number(port) || 443,
        host,
        protocols: ['h2', 'http/1.1', 'http/1.0'],
      };

    case 'http:':
      return {
        port: Number(port) || 80,
        host,
        protocols: ['http/1.1', 'http/1.0'],
      };

    default:
      throw new Error(`Unsupported domain protocol: ${protocol}`);
  }
}

function parseDomain(domain: string) {
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
}: {
  domain: string;
  token: string;
  concurrency?: number;
}) {
  try {
    const { host, port, protocols } = parseDomain(domain);

    const { alpnProtocol } = await resolveALPN({
      host,
      servername: host,
      port,
      rejectUnauthorized: false,
      ALPNProtocols: protocols,
    });
    switch (alpnProtocol) {
      // Prefer HTTP/2
      case 'h2':
        return new HttpClient(domain, token, concurrency);

      // If no HTTP/2, use a WebSocket
      case 'http/1.1':
      case 'http/1.0':
        return new WebSocketClient(domain, concurrency);
      default:
        throw new Error(`Unsupported ALPN protocol: ${alpnProtocol}`);
    }
  } catch (cError: unknown) {
    // Fallback to HTTP on error
    error(cError, 'Failed to auto pick connection type, falling back to HTTP');
    return new HttpClient(domain, token, concurrency);
  }
}
