import fetch from "cross-fetch";
import { EventEmitter } from "events";
import ksuid from "ksuid";
import PQueue from "p-queue";
import debug from "debug";

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
import { delay } from "./utils";

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

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   * @param concurrency Number of allowed in-flight requests. Default 10.
   */
  constructor(domain: string, token: string, concurrency = 10) {
    super();
    this._domain = domain.match(/^http/) ? domain : `https://${domain}`; // ensure leading https://
    this._domain = this._domain.replace(/\/$/, ""); // ensure no trailing slash
    this._token = token;
    this._status = ConnectionStatus.Connecting;
    // "Open" the http connection: just make sure a HEAD succeeds
    trace(
      `Opening the HTTP connection to HEAD ${this._domain}/bookmarks w/ headers authorization: Bearer ${this._token}`
    );
    this.initialConnection = fetch(`${this._domain}/bookmarks`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${this._token}` },
    }).then((result) => {
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

    this._q = new PQueue({ concurrency });
    this._q.on("active", () => {
      trace(`HTTP Queue. Size: ${this._q.size} pending: ${this._q.pending}`);
    });
  }

  /** Disconnect the WebSocket connection */
  public async disconnect(): Promise<void> {
    this._status = ConnectionStatus.Disconnected;
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

  public request(
    req: ConnectionRequest,
    callback?: (response: Readonly<ConnectionChange>) => void,
    timeout?: number
  ): Promise<ConnectionResponse> {
    trace("Starting http request: ", req);
    if (req.method === "watch" || req.method === "unwatch") {
      throw new Error("HTTP (i.e. non-WebSocket) Client cannot do watches");
    }
    if (callback) {
      throw new Error(
        "HTTP (i.e. non-WebSocket) Client cannot handle a watch callback"
      );
    }
    if (!req.requestId) req.requestId = ksuid.randomSync().string;
    trace("Adding http request w/ id ", req.requestId, " to the queue");
    return this._q.add(() => this.doRequest(req, timeout));
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
    if (timeout) {
      setTimeout(() => (timedout = true), timeout);
    }
    const result = await fetch(`${this._domain}${req.path}`, {
      method: req.method.toUpperCase(),
      body: JSON.stringify(req.data),
      headers: req.headers, // We are not explicitly sending token in each request because parent library sends it
    }).then((res) => {
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
    result.headers.forEach((value, key) => (headers[key] = value));
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
