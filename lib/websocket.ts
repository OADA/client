import WebSocket = require("isomorphic-ws");
import ksuid from "ksuid";

import SocketResponse, {
  is as isSocketResponse,
} from "@oada/types/oada/websockets/response";
import SocketRequest from "@oada/types/oada/websockets/request";
import SocketChange, {
  is as isSocketChange,
} from "@oada/types/oada/websockets/change";

interface ActiveRequest {
  resolve: Function;
  reject: Function;
  callback?: (response: Readonly<SocketChange>) => void;
  persistent: boolean;
  settled: boolean;
}

export class WebSocketClient {
  private _ws: WebSocket;
  private _domain: string;
  private _connected: boolean;
  private _requests: Map<string, ActiveRequest>;

  /**
   * Constructor
   * @param domain Domain. E.g., www.example.com
   */
  constructor(domain: string) {
    this._connected = false;
    this._domain = domain;
    this._requests = new Map();
  }

  /** Connect to server. Returns Promise. */
  public connect(): Promise<void> {
    // throw if connection exists
    if (this._connected) {
      throw new Error("Already connected to server.");
    }

    // create new promise
    return new Promise<void>((resolve) => {
      // create websocket connection
      this._ws = new WebSocket("wss://" + this._domain, {
        origin: "https://" + this._domain,
      });

      // register handlers
      this._ws.onopen = () => {
        this._connected = true;
        resolve();
      };
      this._ws.onclose = () => {
        this._connected = false;
      };
      this._ws.onmessage = this._receive.bind(this); // explicitly pass the instance
    });
  }

  /** Disconnect the WebSocket connection */
  public disconnect(): void {
    if (!this._connected) {
      return;
    }
    this._ws.close();
  }

  /** Return true if connected, otherwise false */
  public isConnected(): boolean {
    return this._connected;
  }

  /** send a request to server */
  public request(
    req: Omit<SocketRequest, "RequestId">,
    callback?: (response: Readonly<SocketChange>) => void
  ): Promise<SocketResponse> {
    // throw if not connected
    if (!this._connected) {
      throw new Error("Not connected to server.");
    }

    // User should not provide request ID
    if (req.requestId) {
      throw new Error("Request ID exists.");
    }

    // Send object to the server.
    const requestId = ksuid.randomSync().string;
    req.requestId = requestId;
    this._ws.send(JSON.stringify(req));

    // return Promise
    return new Promise<SocketResponse>((resolve, reject) => {
      // save request
      this._requests.set(requestId, {
        resolve,
        reject,
        settled: false,
        persistent: callback ? true : false,
        callback,
      });
    });
  }

  private _receive(e: any) {
    // parse message
    let msg = JSON.parse(e.data);

    if (!msg.requestId) {
      return;
    }

    if (!Array.isArray(msg.requestId)) {
      msg.requestId = [msg.requestId];
    }

    for (const requestId of msg.requestId) {
      // find original request
      let request = this._requests.get(requestId);
      if (request) {
        if (isSocketResponse(msg)) {
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

          // run callback function
        } else if (request.callback && isSocketChange(msg)) {
          request.callback(msg);
        }
      }
    }
  }
}
