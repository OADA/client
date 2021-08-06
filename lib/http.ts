import fetch, { context, Disconnect } from "./fetch";
import { EventEmitter } from "events";
import ksuid from "ksuid";
import PQueue from "p-queue";
import debug from "debug";

import { WebSocketClient } from "./websocket";
import { handleErrors } from "./errors";

const trace = debug("@oada/client:http:trace");
const warn = debug("@oada/client:http:warn");
//const error = debug("@oada/client:http:error");

import {
  ConnectionRequest,
  ConnectionResponse,
  ConnectionChange,
  Connection,
} from "./client";

import { assert as assertOADASocketRequest } from "@oada/types/oada/websockets/request";

enum ConnectionStatus {
  Disconnected,
  Connecting,
  Connected,
}

export class HttpClient extends EventEmitter implements Connection {
  private _domain: string;
  private _token: string;
  private _status: ConnectionStatus;
  private _q: PQueue;
  private initialConnection: Promise<void>; // await on the initial HEAD
  private concurrency: number;
  private context: { fetch: typeof fetch; disconnectAll?: Disconnect };
  private ws?: WebSocketClient; // Fall-back socket for watches

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(domain: string, token: string, concurrency = 10) {
    super();

    this.context = context ? context() : { fetch };

    this._domain = domain.match(/^http/) ? domain : `https://${domain}`; // ensure leading https://
    this._domain = this._domain.replace(/\/$/, ""); // ensure no trailing slash
    this._token = token;
    this._status = ConnectionStatus.Connecting;
    // "Open" the http connection: just make sure a HEAD succeeds
    trace(
      `Opening the HTTP connection to HEAD ${this._domain}/bookmarks w/ headers authorization: Bearer ${this._token}`
    );
    this.initialConnection = this.context
      .fetch(`${this._domain}/bookmarks`, {
        method: "HEAD",
        headers: { authorization: `Bearer ${this._token}` },
      })
      .then((result) => {
        trace("Initial HEAD returned status: ", result.status);
        if (result.status < 400) {
          trace('Initial HEAD succeeded, emitting "open"');
          this._status = ConnectionStatus.Connected;
          this.emit("open");
        } else {
          trace('Initial HEAD failed, emitting "close"');
          this._status = ConnectionStatus.Disconnected;
          this.emit("close");
        }
      });

    this.concurrency = concurrency;
    this._q = new PQueue({ concurrency });
    this._q.on("active", () => {
      trace(`HTTP Queue. Size: ${this._q.size} pending: ${this._q.pending}`);
    });
  }

  /** Disconnect the connection */
  public async disconnect(): Promise<void> {
    this._status = ConnectionStatus.Disconnected;
    // Close our connections
    await this.context.disconnectAll?.();
    // Close our ws connection
    await this.ws?.disconnect();
    this.emit("close");
  }

  /** Return true if connected, otherwise false */
  public isConnected(): boolean {
    return this._status == ConnectionStatus.Connected;
  }

  /** Wait for the connection to open */
  public async awaitConnection(): Promise<void> {
    // Wait for the initial HEAD request to return
    await this.initialConnection;
  }

  // TODO: Add support for WATCH via h2 push and/or RFC 8441
  public async request(
    req: ConnectionRequest,
    callback?: (response: Readonly<ConnectionChange>) => void,
    timeout?: number
  ): Promise<ConnectionResponse> {
    trace("Starting http request: ", req);
    // Check for WATCH/UNWATCH
    if (req.method === "watch" || req.method === "unwatch" || callback) {
      warn(
        "WATCH/UNWATCH not currently supported for http(2), falling-back to ws"
      );
      if (!this.ws) {
        // Open a WebSocket connection
        const domain = this._domain.replace(/^https?:\/\//, "");
        this.ws = new WebSocketClient(domain, this.concurrency);
        await this.ws.awaitConnection();
      }
      return this.ws?.request(req, callback, timeout);
    }
    if (!req.requestId) req.requestId = ksuid.randomSync().string;
    trace("Adding http request w/ id ", req.requestId, " to the queue");
    return this._q.add(() =>
      handleErrors(this.doRequest.bind(this), req, timeout)
    );
  }

  /** send a request to server */
  private async doRequest(
    req: ConnectionRequest,
    timeout?: number
  ): Promise<ConnectionResponse> {
    // Send object to the server.
    trace("Pulled request ", req.requestId, " from queue, starting on it");
    assertOADASocketRequest(req);
    trace(
      `Req looks like a socket request, awaiting race between timeout and fetch to ${this._domain}${req.path}`
    );

    let timedout = false;
    let signal: AbortSignal | undefined = undefined;
    if (timeout) {
      const controller = new AbortController();
      ({ signal } = controller);
      setTimeout(() => {
        controller.abort();
        timedout = true;
      }, timeout);
    }
    const result = await this.context
      .fetch(new URL(req.path, this._domain).toString(), {
        // @ts-ignore
        method: req.method.toUpperCase(),
        // @ts-ignore
        signal,
        timeout,
        body: JSON.stringify(req.data),
        headers: req.headers, // We are not explicitly sending token in each request because parent library sends it
      })
      .then((res) => {
        if (timedout) throw new Error("Request timeout");
        return res;
      });
    trace(`Fetch did not throw, checking status of ${result.status}`);

    // This is the same test as in ./websocket.ts
    if (result.status < 200 || result.status >= 300) {
      trace(`result.status (${result.status}) is not 2xx, throwing`);
      throw result;
    }
    trace(`result.status ok, pulling headers`);
    // have to construct the headers ourselves:
    const headers: Record<string, string> = {};
    if (Array.isArray(result.headers)) {
      // In browser they are an array?
      result.headers.forEach((value, key) => (headers[key] = value));
    } else {
      for (const [key, value] of result.headers.entries()) {
        headers[key] = value;
      }
    }
    const length = +(result.headers.get("content-length") || 0);
    let data: any = null;
    if (req.method.toUpperCase() !== "HEAD") {
      const isJSON = (result.headers.get("content-type") || "").match(/json/);
      if (!isJSON) {
        data = await result.arrayBuffer();
      } else {
        // this json() function is really finicky, have to do all these tests prior to get it to work
        data = await result.json();
      }
    }
    trace(`length = ${length}, result.headers = `, headers);
    return {
      requestId: req.requestId,
      status: result.status,
      statusText: result.statusText,
      headers,
      data,
    };
  }
}
