import WebSocket = require("isomorphic-ws");
import { v4 as uuid } from "uuid";

export interface Request {
  method: string;
  headers: { [key: string]: string };
  path: string;
  data?: object;
  requestId?: string;
}

export interface Response {
  headers: object;
  status: number;
  data: object;
}

interface ActiveRequest {
  resolve: Function;
  reject: Function;
  callback?: (response: Response) => void;
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
    return new Promise<void>((resolve, reject) => {
      // create websocket connection
      this._ws = new WebSocket("wss://" + this._domain, {
        origin: "https://" + this._domain
      });

      // register handlers
      this._ws.onopen = (e: any) => {
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
    req: Request,
    callback?: (response: Response) => void
  ): Promise<Response> {
    // throw if not connected
    if (!this._connected) {
      throw new Error("Not connected to server.");
    }

    // User should not provide request ID
    if (req.requestId) {
      throw new Error("Request ID exists.");
    }

    // Send object to the server.
    const requestId = uuid();
    req.requestId = requestId;
    this._ws.send(JSON.stringify(req));

    // return Promise
    return new Promise<Response>((resolve, reject) => {
      // save request
      this._requests.set(requestId, {
        resolve,
        reject,
        settled: false,
        persistent: callback ? true : false,
        callback
      });
    });
  }

  private _receive(e: any) {
    // parse message
    let msg = JSON.parse(e.data);

    // ignore if the message is not a valid response
    if (!msg.requestId) {
      return;
    }

    // find original request
    let request = this._requests.get(msg.requestId);
    if (request) {
      // if the request is not settled, resolve/reject the corresponding promise
      if (!request.settled) {
        request.settled = true;

        // FIXME: This is obviously a hack. The server should return integer status.
        if (msg.status && msg.status == "success") {
          msg.status = 200;
        }

        if (msg.status && msg.status >= 200 && msg.status < 300) {
          const response: Response = {
            headers: msg.headers,
            status: msg.status,
            data: msg.data
          };
          request.resolve(response);
        } else if (msg.status) {
          request.reject(
            new Error("Request failed with status code " + msg.status)
          );
        } else {
          request.reject(new Error("Request failed"));
        }
      }

      // run callback function
      if (request.callback) {
        request.callback(msg);
      }
    }
  }
}
