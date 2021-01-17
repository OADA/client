import WebSocket = require("isomorphic-ws");
import ReconnectingWebSocket from "reconnecting-websocket";
import { EventEmitter } from "events";
import ksuid from "ksuid";
import PQueue from "p-queue";
import debug from "debug";

const trace = debug("@oada/client:ws:trace");
const error = debug("@oada/client:ws:error");

import {
  ConnectionRequest,
  ConnectionResponse,
  ConnectionChange,
  Connection,
} from "./client";

import { assert as assertOADASocketRequest } from "@oada/types/oada/websockets/request";
import { is as isOADASocketResponse } from "@oada/types/oada/websockets/response";
import { is as isOADASocketChange } from "@oada/types/oada/websockets/change";
import { assert as assertOADAChangeV2 } from "@oada/types/oada/change/v2";

import { Json, Change } from ".";

interface ActiveRequest {
  resolve: Function;
  reject: Function;
  callback?: (response: Readonly<ConnectionChange>) => void;
  persistent: boolean;
  settled: boolean;
}

enum ConnectionStatus {
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
  private _ws: Promise<ReconnectingWebSocket>;
  private _domain: string;
  private _status: ConnectionStatus;
  private _requests: Map<string, ActiveRequest>;
  private _q: PQueue;

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(domain: string, concurrency = 10) {
    super();
    this._domain = domain;
    this._requests = new Map();
    this._status = ConnectionStatus.Connecting;
    this._ws = new Promise<ReconnectingWebSocket>((resolve) => {
      // create websocket connection
      const ws = new ReconnectingWebSocket("wss://" + this._domain, [], {
        WebSocket: BetterWebSocket,
      });

      // register handlers
      ws.onopen = () => {
        trace("Connection opened.");
        this._status = ConnectionStatus.Connected;
        resolve(ws);
        this.emit("open");
      };
      ws.onclose = () => {
        trace("Connection closed.");
        this._status = ConnectionStatus.Disconnected;
        this.emit("close");
      };
      ws.onmessage = this._receive.bind(this); // explicitly pass the instance
    });

    this._q = new PQueue({ concurrency });
    this._q.on("active", () => {
      trace(`WS Queue. Size: ${this._q.size} pending: ${this._q.pending}`);
    });
  }

  /** Disconnect the WebSocket connection */
  public async disconnect(): Promise<void> {
    if (this._status == ConnectionStatus.Disconnected) {
      return;
    }
    (await this._ws).close();
  }

  /** Return true if connected, otherwise false */
  public isConnected(): boolean {
    return this._status == ConnectionStatus.Connected;
  }

  /** Wait for the connection to open */
  public async awaitConnection(): Promise<void> {
    // Wait for _ws to resolve and return
    await this._ws;
  }

  public request(
    req: ConnectionRequest,
    callback?: (response: Readonly<ConnectionChange>) => void,
    timeout?: number
  ): Promise<ConnectionResponse> {
    return this._q.add(() => this.doRequest(req, callback, timeout));
  }

  /** send a request to server */
  private async doRequest(
    req: ConnectionRequest,
    callback?: (response: Readonly<ConnectionChange>) => void,
    timeout?: number
  ): Promise<ConnectionResponse> {
    // Send object to the server.
    const requestId = req.requestId || ksuid.randomSync().string;
    req.requestId = requestId;
    assertOADASocketRequest(req);
    (await this._ws).send(JSON.stringify(req));

    // Promise for request
    const request_promise = new Promise<ConnectionResponse>(
      (resolve, reject) => {
        // save request
        this._requests.set(requestId, {
          resolve,
          reject,
          settled: false,
          /* If this is a watch request, set "persistent" flag to true so
           this request will not get deleted after the first response */
          persistent: callback ? true : false,
          callback,
        });
      }
    );

    if (timeout && timeout > 0) {
      // If timeout is specified, create another promise and use Promise.race
      const timeout_promise = new Promise<ConnectionResponse>(
        (resolve, reject) => {
          setTimeout(() => {
            // If the original request is still pending, delete it.
            // This is necessary to kill "zombie" requests.
            const request = this._requests.get(requestId);
            if (request && !request.settled) {
              request.reject("Request timeout"); // reject request promise
              this._requests.delete(requestId);
            }
            reject("Request timeout"); // reject timeout promise
          }, timeout);
        }
      );
      return Promise.race([request_promise, timeout_promise]);
    } else {
      // If timeout is not specified, simply return the request promise
      return request_promise;
    }
  }

  private _receive(m: any) {
    try {
      const msg = JSON.parse(m.data.toString());

      let requestIds: Array<string>;
      if (Array.isArray(msg.requestId)) {
        requestIds = msg.requestId;
      } else {
        requestIds = [msg.requestId];
      }

      for (const requestId of requestIds) {
        // find original request
        let request = this._requests.get(requestId);
        if (request) {
          if (isOADASocketResponse(msg)) {
            if (!request.persistent) {
              this._requests.delete(requestId);
            }

            // if the request is not settled, resolve/reject the corresponding promise
            if (!request.settled) {
              request.settled = true;

              if (msg.status && msg.status >= 200 && msg.status < 300) {
                request.resolve(msg);
              } else if (msg.status) {
                request.reject(msg);
              } else {
                throw new Error("Request failed");
              }
            }
          } else if (request.callback && isOADASocketChange(msg)) {
            assertOADAChangeV2(msg.change);

            // TODO: Would be nice if @oad/types know "unkown" as Json
            const m: ConnectionChange = {
              requestId: [requestId],
              resourceId: msg.resourceId,
              path_leftover: msg.path_leftover,
              change: msg.change.map(({ body, ...rest }) => {
                return { ...rest, body: body as Json };
              }),
            };

            request.callback(m);
          } else {
            throw new Error("Invalid websocket payload received");
          }
        }
      }
    } catch (e) {
      error(`[Websocket ${this._domain}] Received invalid response. Ignoring.`);
      trace(`[Websocket ${this._domain}] Received invalid response. %O`, e);
    }
  }
}
