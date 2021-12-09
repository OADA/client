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

import type { URL } from 'node:url';

import EventEmitter from 'eventemitter3';
import PQueue from 'p-queue';
import ReconnectingWebSocket from 'reconnecting-websocket';
import WebSocket from 'isomorphic-ws';
import debug from 'debug';
import ksuid from 'ksuid';
import { setTimeout } from 'isomorphic-timers-promises';

import { assert as assertOADAChangeV2 } from '@oada/types/oada/change/v2';
import { assert as assertOADASocketRequest } from '@oada/types/oada/websockets/request';
import { is as isOADASocketChange } from '@oada/types/oada/websockets/change';
import { is as isOADASocketResponse } from '@oada/types/oada/websockets/response';

import { on, once } from './event-iterator';

import type {
  Connection,
  ConnectionChange,
  ConnectionRequest,
  ConnectionResponse,
  IConnectionResponse,
} from './client';
import type { Change } from './';
import { handleErrors } from './errors';

const trace = debug('@oada/client:ws:trace');
const error = debug('@oada/client:ws:error');

interface ResponseEmitter extends EventEmitter {
  on(
    event: `response:${string}`,
    listener: (response: Readonly<ConnectionResponse>) => void
  ): this;
  on(
    event: `change:${string}`,
    listener: (response: Readonly<ConnectionChange>) => void
  ): this;
}

declare module 'events' {
  // eslint-disable-next-line unicorn/no-static-only-class, @typescript-eslint/no-extraneous-class, @typescript-eslint/no-shadow
  class EventEmitter {
    static once(
      emitter: ResponseEmitter,
      event: `response:${string}`
    ): Promise<[ConnectionResponse]>;
    static on(
      emitter: ResponseEmitter,
      event: `change:${string}`,
      options?: { signal?: AbortSignal }
    ): AsyncIterableIterator<[ConnectionChange]>;
  }
}

const enum ConnectionStatus {
  Disconnected,
  Connecting,
  Connected,
}

/**
 * Override defaults for ws in node
 *
 * @todo make sure this does not break in browser
 */
class BetterWebSocket extends WebSocket {
  constructor(
    url: string | URL,
    protocols = [],
    { maxPayload = 0, ...rest } = {}
  ) {
    super(url, protocols, { maxPayload, ...rest });
  }
}

export class WebSocketClient extends EventEmitter implements Connection {
  #ws: Promise<ReconnectingWebSocket>;
  #domain: string;
  #status: ConnectionStatus;
  #requests: ResponseEmitter = new EventEmitter();
  #q: PQueue;

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(domain: string, concurrency = 10) {
    super();
    this.#domain = domain;
    this.#status = ConnectionStatus.Connecting;
    // Create websocket connection
    const ws = new ReconnectingWebSocket(`wss://${this.#domain}`, [], {
      // Not sure why it needs so long, but 30s is the ws timeout
      connectionTimeout: 30 * 1000,
      WebSocket: BetterWebSocket,
    });
    // eslint-disable-next-line github/no-then
    const openP = once(ws, 'open').then(() => ws);
    // eslint-disable-next-line github/no-then
    const errorP = once(ws, 'error').then(([wsError]) => {
      throw wsError;
    });
    this.#ws = Promise.race([openP, errorP]);

    // Register handlers
    ws.addEventListener('open', () => {
      trace('Connection opened');
      this.#status = ConnectionStatus.Connected;
      this.emit('open');
    });

    ws.addEventListener('close', () => {
      trace('Connection closed');
      this.#status = ConnectionStatus.Disconnected;
      this.emit('close');
    });

    ws.addEventListener('error', (wsError) => {
      trace(wsError, 'Connection error');
      // This.#status = ConnectionStatus.Disconnected;
      // this.emit("error");
    });

    ws.addEventListener('message', this.#receive.bind(this)); // Explicitly pass the instance

    this.#q = new PQueue({ concurrency });
    this.#q.on('active', () => {
      trace('WS Queue. Size: %d pending: %d', this.#q.size, this.#q.pending);
    });
  }

  /** Disconnect the WebSocket connection */
  public async disconnect(): Promise<void> {
    if (this.#status === ConnectionStatus.Disconnected) {
      return;
    }

    // eslint-disable-next-line unicorn/no-await-expression-member
    (await this.#ws).close();
  }

  /** Return true if connected, otherwise false */
  public isConnected(): boolean {
    return this.#status === ConnectionStatus.Connected;
  }

  /** Wait for the connection to open */
  public async awaitConnection(): Promise<void> {
    // Wait for _ws to resolve and return
    await this.#ws;
  }

  public async request(
    request: ConnectionRequest,
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {}
  ) {
    return this.#q.add(async () =>
      handleErrors(this.#doRequest.bind(this), request, { timeout, signal })
    );
  }

  /** Send a request to server */
  async #doRequest(
    request: ConnectionRequest,
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {}
  ): Promise<IConnectionResponse> {
    // Send object to the server.
    // eslint-disable-next-line unicorn/no-await-expression-member
    const requestId = request.requestId ?? (await ksuid.random()).string;
    request.requestId = requestId;
    assertOADASocketRequest(request);

    // Start listening for response before sending the request so we don't miss it
    const responsePs = [once(this.#requests, `response:${requestId}`)];
    // eslint-disable-next-line unicorn/no-await-expression-member
    (await this.#ws).send(JSON.stringify(request));
    if (timeout) {
      responsePs.push(
        // eslint-disable-next-line github/no-then
        setTimeout(timeout).then(() => {
          throw new Error('Request timeout');
        })
      );
    }

    const [response] = await Promise.race(responsePs);

    if (response.status >= 200 && response.status < 300) {
      if (request.method === 'watch') {
        const watch = on(this.#requests, `change:${requestId}`, { signal });
        return [response, watch];
      }

      return [response];
    }

    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw response.status ? response : new Error('Request failed');
  }

  #receive(m: MessageEvent<unknown>) {
    try {
      const message = JSON.parse(String(m.data)) as Record<string, unknown>;

      const requestIds: readonly string[] = Array.isArray(message.requestId)
        ? message.requestId
        : [message.requestId];

      if (isOADASocketResponse(message)) {
        for (const requestId of requestIds) {
          this.#requests.emit(`response:${requestId}`, message);
        }
      } else if (isOADASocketChange(message)) {
        assertOADAChangeV2(message.change);

        const change = message.change.map(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          ({ body, ...rest }) => ({ ...rest, body } as Change)
        );
        for (const requestId of requestIds) {
          // TODO: Would be nice if @oad/types know "unknown" as Json
          const rChange: ConnectionChange = {
            requestId: [requestId],
            resourceId: message.resourceId,
            path_leftover: message.path_leftover,
            change,
          };
          this.#requests.emit(`change:${requestId}`, rChange);
        }
      } else {
        throw new Error('Invalid websocket payload received');
      }
    } catch (cError: unknown) {
      error(
        '[Websocket %s] Received invalid response. Ignoring.',
        this.#domain
      );
      trace(cError, '[Websocket %s] Received invalid response', this.#domain);
      // No point in throwing here; the promise cannot be resolved because the
      // requestId cannot be retrieved; throwing will just blow up client
    }
  }
}
