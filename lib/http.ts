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

import { EventEmitter } from 'eventemitter3';
import PQueue from 'p-queue';
import debug from 'debug';
import { fromString } from 'media-type';
import { generate as ksuid } from 'xksuid';

import { assert as assertOADASocketRequest } from '@oada/types/oada/websockets/request.js';

import { AbortController, Agent, type Response, fetch } from '#fetch';
import type {
  Body,
  Connection,
  ConnectionRequest,
  IConnectionResponse,
} from './client.js';
import { TimeoutError, fixError } from './utils.js';

import type { Json } from './index.js';
import { WebSocketClient } from './websocket.js';
import { handleErrors } from './errors.js';

const trace = debug('@oada/client:http:trace');
const error = debug('@oada/client:http:error');

const enum ConnectionStatus {
  Disconnected,
  Connecting,
  Connected,
}

export interface HTTPTimeouts {
  /** @default 60e3 */
  connect?: number;
  body?: number;
  headers?: number;
  keepAlive?: number;
}

function isJson(contentType: string) {
  const media = fromString(contentType);
  return [media.subtype, media.suffix].includes('json');
}

async function getBody(result: Response): Promise<Body> {
  return isJson(result.headers.get('content-type') ?? '')
    ? ((await result.json()) as Json)
    : new Uint8Array(await result.arrayBuffer());
}

export class HttpClient extends EventEmitter implements Connection {
  readonly #domain: string;
  readonly #token;
  #status;
  readonly #q: PQueue;
  readonly #initialConnection: Promise<void>; // Await on the initial HEAD
  readonly #concurrency;
  readonly #userAgent;
  readonly #agent?;
  #ws?: WebSocketClient; // Fall-back socket for watches

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(
    domain: string,
    token: string,
    {
      concurrency = 10,
      userAgent,
      timeouts,
    }: { concurrency: number; userAgent: string; timeouts: HTTPTimeouts },
  ) {
    super();

    // Ensure leading https://
    this.#domain = domain.startsWith('http') ? domain : `https://${domain}`;
    // Ensure no trailing slash
    this.#domain = this.#domain.replace(/\/$/, '');
    this.#token = token;
    this.#status = ConnectionStatus.Connecting;
    // "Open" the http connection: just make sure a HEAD succeeds
    trace(
      'Opening HTTP connection to HEAD %s/bookmarks w/authorization: Bearer %s',
      this.#domain,
      this.#token,
    );
    this.#agent =
      Agent &&
      new Agent({
        keepAliveTimeout: timeouts.keepAlive,
        bodyTimeout: timeouts.body,
        headersTimeout: timeouts.headers,
        connect: {
          timeout: timeouts.connect,
          rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
        },
      });
    this.#initialConnection = fetch(`${this.#domain}/bookmarks`, {
      dispatcher: this.#agent,
      method: 'HEAD',
      headers: {
        'user-agent': userAgent,
        'authorization': `Bearer ${this.#token}`,
      },
    })
      // eslint-disable-next-line github/no-then
      .then((result) => {
        trace('Initial HEAD returned status: ', result.status);
        // eslint-disable-next-line promise/always-return
        if (result.status < 400) {
          trace('Initial HEAD succeeded, emitting "open"');
          this.#status = ConnectionStatus.Connected;
          this.emit('open');
        } else {
          trace('Initial HEAD failed, emitting "close"');
          this.#status = ConnectionStatus.Disconnected;
          this.emit('close');
        }
      });

    this.#concurrency = concurrency;
    this.#userAgent = userAgent;
    this.#q = new PQueue({ concurrency });
    this.#q.on('active', () => {
      trace('HTTP Queue. Size: %d pending: %d', this.#q.size, this.#q.pending);
    });
  }

  /** Disconnect the connection */
  public async disconnect(): Promise<void> {
    this.#status = ConnectionStatus.Disconnected;

    await Promise.all([
      // Close fetch agent
      this.#agent?.close(),

      // Close our ws connection
      this.#ws?.disconnect(),
    ]);

    this.emit('close');
  }

  /** Return true if connected, otherwise false */
  public isConnected(): boolean {
    return this.#status === ConnectionStatus.Connected;
  }

  /** Wait for the connection to open */
  public async awaitConnection(): Promise<void> {
    // Wait for the initial HEAD request to return
    await this.#initialConnection;
  }

  public async request(
    request: ConnectionRequest,
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<IConnectionResponse> {
    trace(request, 'Starting http request');
    try {
      // Check for WATCH/UNWATCH
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      if (request.watch || request.method === 'unwatch') {
        trace(
          'WATCH/UNWATCH not currently supported for http(2), falling-back to ws',
        );
        if (!this.#ws) {
          // Open a WebSocket connection
          this.#ws = new WebSocketClient(this.#domain, {
            concurrency: this.#concurrency,
            userAgent: this.#userAgent,
          });
          await this.#ws.awaitConnection();
        }

        return await this.#ws.request(request, { timeout, signal });
      }

      request.requestId ||= ksuid();

      trace('Adding http request w/ id %s to the queue', request.requestId);
      return await this.#q.add(
        async () => handleErrors(this.#doRequest.bind(this), request, timeout),
        { throwOnTimeout: true },
      );
    } catch (cError: unknown) {
      // @ts-expect-error stupid errors
      const code = `${cError?.code}`;
      throw Object.assign(
        new Error((cError as Error)?.message ?? 'HTTP request failed', {
          cause: cError,
        }),
        cError as Error,
        { request, code },
      );
    }
  }

  /**
   * Send a request to server
   */
  async #doRequest(
    request: ConnectionRequest,
    timeout?: number,
  ): Promise<IConnectionResponse> {
    // Send object to the server.
    trace('Pulled request %s from queue, starting on it', request.requestId);
    assertOADASocketRequest(request);
    trace(
      'Req looks like socket request, awaiting race of timeout and fetch to %s%s',
      this.#domain,
      request.path,
    );

    let done = false;
    let timedout = false;
    let controller: AbortController | undefined;
    if (timeout) {
      controller = new AbortController();
      setTimeout(() => {
        if (!done) {
          timedout = true;
          controller!.abort();
        }
      }, timeout);
    }

    // Assume anything that is not a Uint8Array should be JSON?
    const body =
      request.data instanceof Uint8Array
        ? request.data
        : JSON.stringify(request.data);
    try {
      const result = await fetch(new URL(request.path, this.#domain), {
        dispatcher: this.#agent,
        method: request.method.toUpperCase(),
        signal: controller?.signal,
        body,
        // We are not explicitly sending token in each request
        // because parent library sends it
        headers: {
          'user-agent': this.#userAgent,
          ...request.headers,
        },
      });
      done = true;

      trace('Fetch did not throw, checking status of %s', result.status);

      // This is the same test as in ./websocket.ts
      if (!result.ok) {
        trace('result.status %s is not 2xx, throwing', result.status);
        throw await fixError(result);
      }

      trace('result.status ok, pulling headers');
      // Have to construct the headers as a regular object
      const headers = Object.fromEntries(result.headers.entries());

      const data: Body | undefined =
        request.method.toUpperCase() === 'HEAD'
          ? undefined
          : await getBody(result);

      // Trace("length = %d, result.headers = %O", length, headers);
      return [
        {
          requestId: request.requestId,
          status: result.status,
          statusText: result.statusText,
          headers,
          data,
        },
      ];
    } catch (cError: unknown) {
      if (timedout) {
        throw new TimeoutError(request);
      }

      // @ts-expect-error stupid error handling
      switch (cError?.code) {
        // Happens when the HTTP/2 session is killed
        case 'ERR_HTTP2_INVALID_SESSION': {
          error(cError, 'HTTP/2 session was killed, reconnecting');
          return this.#doRequest(request, timeout);
        }

        default: {
          throw cError as Error;
        }
      }
    }
  }
}
