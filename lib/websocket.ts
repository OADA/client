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

import debug from "debug";
import { EventEmitter } from "eventemitter3";
import { setTimeout } from "isomorphic-timers-promises";
import WebSocket from "isomorphic-ws";
import PQueue from "p-queue";
import _ReconnectingWebSocket from "reconnecting-websocket";
import { generate as ksuid } from "xksuid";

import { assert as assertOADAChangeV2 } from "@oada/types/oada/change/v2.js";
import { is as isOADASocketChange } from "@oada/types/oada/websockets/change.js";
import type WebSocketRequest from "@oada/types/oada/websockets/request.js";
import { assert as assertOADASocketRequest } from "@oada/types/oada/websockets/request.js";
import { is as isOADASocketResponse } from "@oada/types/oada/websockets/response.js";

import { on, once } from "#event-iterator";

import type {
  Connection,
  ConnectionChange,
  ConnectionRequest,
  ConnectionResponse,
  IConnectionResponse,
} from "./client.js";
import { handleErrors } from "./errors.js";
import type { Change } from "./index.js";
import { TimeoutError, fixError } from "./utils.js";

// HACK: Fix for default export types in esm
// eslint-disable-next-line @typescript-eslint/naming-convention
const ReconnectingWebSocket =
  _ReconnectingWebSocket as unknown as typeof _ReconnectingWebSocket.default;

const trace = debug("@oada/client:ws:trace");
const error = debug("@oada/client:ws:error");

interface ResponseEmitter extends EventEmitter {
  on(
    event: `response:${string}`,
    listener: (response: Readonly<ConnectionResponse>) => void,
  ): this;
  on(
    event: `change:${string}`,
    listener: (response: Readonly<ConnectionChange>) => void,
  ): this;
}

declare module "#event-iterator" {
  // @ts-expect-error type bs
  // eslint-disable-next-line @typescript-eslint/no-shadow
  export function once(
    emitter: ResponseEmitter,
    event: `response:${string}`,
  ): Promise<[ConnectionResponse]>;
  // @ts-expect-error type bs
  export function once(
    emitter: _ReconnectingWebSocket.default,
    event: "error",
  ): Promise<[Error]>;
  // @ts-expect-error type bs
  export function once(
    emitter: _ReconnectingWebSocket.default,
    event: "open",
  ): Promise<void>;
  // @ts-expect-error type bs
  // eslint-disable-next-line @typescript-eslint/no-shadow
  export function on(
    emitter: ResponseEmitter,
    event: `change:${string}`,
    options?: { signal?: AbortSignal },
  ): AsyncIterableIterator<[ConnectionChange]>;
}

enum ConnectionStatus {
  Disconnected = 0,
  Connecting = 1,
  Connected = 2,
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
    { maxPayload = 0, ...rest } = {},
  ) {
    super(url, protocols, { maxPayload, ...rest });
  }
}

export class WebSocketClient extends EventEmitter implements Connection {
  readonly #ws: Promise<_ReconnectingWebSocket.default>;
  readonly #domain;
  #status;
  readonly #requests: ResponseEmitter = new EventEmitter();
  readonly #q;
  readonly #userAgent;

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(
    domain: string,
    { concurrency = 10, userAgent }: { concurrency: number; userAgent: string },
  ) {
    super();
    this.#userAgent = userAgent;
    this.#domain = domain.replace(/^http/, "ws");
    this.#status = ConnectionStatus.Connecting;
    // Create websocket connection
    const ws = new ReconnectingWebSocket(this.#domain, [], {
      // Not sure why it needs so long, but 30s is the ws timeout
      connectionTimeout: 30 * 1000,
      WebSocket: BetterWebSocket,
    });
    // eslint-disable-next-line github/no-then
    const openP = once(ws, "open").then(() => ws);
    // eslint-disable-next-line github/no-then
    const errorP = once(ws, "error").then(([wsError]) => {
      throw wsError;
    });
    this.#ws = Promise.race([openP, errorP]);

    // Register handlers
    ws.addEventListener("open", () => {
      trace("Connection opened");
      this.#status = ConnectionStatus.Connected;
      this.emit("open");
    });

    ws.addEventListener("close", () => {
      trace("Connection closed");
      this.#status = ConnectionStatus.Disconnected;
      this.emit("close");
    });

    ws.addEventListener("error", (wsError) => {
      trace(wsError, "Connection error");
      // This.#status = ConnectionStatus.Disconnected;
      // this.emit("error");
    });

    ws.addEventListener("message", (message) => {
      trace(
        { message: { ...message, data: message.data, origin: message.origin } },
        "Websocket message received",
      );
      this.#receive(message);
    });

    this.#q = new PQueue({ concurrency });
    this.#q.on("active", () => {
      trace("WS Queue. Size: %d pending: %d", this.#q.size, this.#q.pending);
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
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
  ) {
    return this.#q.add(
      async () =>
        handleErrors(this.#doRequest.bind(this), request, { timeout, signal }),
      { throwOnTimeout: true },
    );
  }

  /** Send a request to server */
  async #doRequest(
    request: ConnectionRequest,
    { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<IConnectionResponse> {
    const ws = await this.#ws;
    // Send object to the server.
    const requestId = request.requestId ?? ksuid();
    request.requestId = requestId;
    assertOADASocketRequest(request);

    const { headers, watch, method } = request;

    // Start listening for response before sending the request so we don't miss it
    const responsePs = [once(this.#requests, `response:${requestId}`)];
    const socketRequest: WebSocketRequest = {
      ...request,
      headers: {
        "user-agent": this.#userAgent,
        ...headers,
      },
      method: watch
        ? method === "head"
          ? "watch"
          : `${method}-watch`
        : method,
    };
    ws.send(JSON.stringify(socketRequest));
    if (timeout) {
      responsePs.push(
        // eslint-disable-next-line github/no-then
        setTimeout(timeout).then(() => {
          throw new TimeoutError(request);
        }),
      );
    }

    const [response] = await Promise.race(responsePs);

    if (response.status >= 200 && response.status < 300) {
      if (watch) {
        const changes = on(this.#requests, `change:${requestId}`, { signal });
        return [response, changes];
      }

      return [response];
    }

    throw await fixError(response);
  }

  #receive(m: MessageEvent) {
    try {
      const message = JSON.parse(String(m.data)) as {
        requestId: string | string[];
        change?: unknown;
        resourceId?: string;
      };
      trace({ message }, "Websocket message parsed");

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
          ({ body, ...rest }) => ({ ...rest, body }) as Change,
        );
        for (const requestId of requestIds) {
          const rChange: ConnectionChange = {
            requestId: [requestId],
            resourceId: message.resourceId,
            change,
          };
          this.#requests.emit(`change:${requestId}`, rChange);
        }
      } else {
        throw new Error("Invalid websocket payload received");
      }
    } catch (cError: unknown) {
      error(
        "[Websocket %s] Received invalid response. Ignoring.",
        this.#domain,
      );
      trace(cError, "[Websocket %s] Received invalid response", this.#domain);
      // No point in throwing here; the promise cannot be resolved because the
      // requestId cannot be retrieved; throwing will just blow up client
    }
  }
}
