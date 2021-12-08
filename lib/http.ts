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

import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

import fetch, { Disconnect, context } from './fetch';
import PQueue from 'p-queue';
import debug from 'debug';
import ksuid from 'ksuid';
import typeIs from 'type-is';

import type {
  Body,
  Connection,
  ConnectionRequest,
  IConnectionResponse,
} from './client';
import { WebSocketClient } from './websocket';
import { handleErrors } from './errors';
// Const error = debug("@oada/client:http:error");

import type { Method } from 'fetch-h2';
import { assert as assertOADASocketRequest } from '@oada/types/oada/websockets/request';

const trace = debug('@oada/client:http:trace');

const enum ConnectionStatus {
  Disconnected,
  Connecting,
  Connected,
}

export class HttpClient extends EventEmitter implements Connection {
  #domain: string;
  #token;
  #status;
  #q: PQueue;
  #initialConnection: Promise<void>; // Await on the initial HEAD
  #concurrency;
  #context: { fetch: typeof fetch; disconnectAll?: Disconnect };
  #ws?: WebSocketClient; // Fall-back socket for watches

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(domain: string, token: string, concurrency = 10) {
    super();

    this.#context = context ? context() : { fetch };

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
      this.#token
    );
    this.#initialConnection = this.#context
      .fetch(`${this.#domain}/bookmarks`, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${this.#token}` },
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
    this.#q = new PQueue({ concurrency });
    this.#q.on('active', () => {
      trace(`HTTP Queue. Size: ${this.#q.size} pending: ${this.#q.pending}`);
    });
  }

  /** Disconnect the connection */
  public async disconnect(): Promise<void> {
    this.#status = ConnectionStatus.Disconnected;
    // Close our connections
    await this.#context.disconnectAll?.();
    // Close our ws connection
    await this.#ws?.disconnect();
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

  // TODO: Add support for WATCH via h2 push and/or RFC 8441
  public async request(
    request: ConnectionRequest,
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {}
  ): Promise<IConnectionResponse> {
    trace(request, 'Starting http request');
    // Check for WATCH/UNWATCH
    if (request.method === 'watch' || request.method === 'unwatch') {
      trace(
        'WATCH/UNWATCH not currently supported for http(2), falling-back to ws'
      );
      if (!this.#ws) {
        // Open a WebSocket connection
        const domain = this.#domain.replace(/^https?:\/\//, '');
        this.#ws = new WebSocketClient(domain, this.#concurrency);
        await this.#ws.awaitConnection();
      }

      return this.#ws.request(request, { timeout, signal });
    }

    if (!request.requestId) {
      request.requestId = ksuid.randomSync().string;
    }

    trace('Adding http request w/ id %s to the queue', request.requestId);
    return this.#q.add(async () =>
      handleErrors(this.#doRequest.bind(this), request, timeout)
    );
  }

  /**
   * Send a request to server
   */
  async #doRequest(
    request: ConnectionRequest,
    timeout?: number
  ): Promise<IConnectionResponse> {
    // Send object to the server.
    trace('Pulled request %s from queue, starting on it', request.requestId);
    assertOADASocketRequest(request);
    trace(
      'Req looks like socket request, awaiting race of timeout and fetch to %s%s',
      this.#domain,
      request.path
    );

    let timedout = false;
    let signal: AbortSignal | undefined;
    if (timeout) {
      const controller = new AbortController();
      ({ signal } = controller);
      setTimeout(() => {
        controller.abort();
        timedout = true;
      }, timeout);
    }

    // Assume anything that is not a Buffer should be JSON?
    const body = Buffer.isBuffer(request.data)
      ? request.data
      : JSON.stringify(request.data);
    const result = await this.#context.fetch(
      new URL(request.path, this.#domain).toString(),
      {
        method: request.method.toUpperCase() as Method,
        // @ts-expect-error
        signal,
        timeout,
        body,
        // We are not explicitly sending token in each request
        // because parent library sends it
        headers: request.headers,
      }
    );
    if (timedout) {
      throw new Error('Request timeout');
    }

    trace('Fetch did not throw, checking status of %s', result.status);

    // This is the same test as in ./websocket.ts
    if (!result.ok) {
      trace('result.status %s is not 2xx, throwing', result.status);
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw result;
    }

    trace('result.status ok, pulling headers');
    // Have to construct the headers ourselves:
    const headers: Record<string, string> = {};
    for (const [key, value] of result.headers.entries()) {
      headers[key] = value;
    }

    // Const length = +(result.headers.get("content-length") || 0);
    let data: Body | undefined;
    if (request.method.toUpperCase() !== 'HEAD') {
      data = typeIs.is(result.headers.get('content-type')!, ['json', '+json'])
        ? await result.json()
        : Buffer.from(await result.arrayBuffer());
    }

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
  }
}
