import debug from "debug";
import { WebSocketClient, SocketRequest } from "./websocket";

const trace = debug("@oada/client:watchdog:trace");
const error = debug("@oada/client:watchdog:error");

export class Watchdog {
  private _wsClient: WebSocketClient;
  private _callback: () => void;
  private _pingInterval: number;
  private _timeoutTimerID: ReturnType<typeof setTimeout>;
  private _pingTimerID: ReturnType<typeof setTimeout>;

  /**
   * Constructor
   * @param pingInterval Ping message interval to check connection. Default 60000 ms.
   */
  constructor(
    wsClient: WebSocketClient,
    callback: () => void,
    pingInterval: number
  ) {
    this._wsClient = wsClient;
    this._callback = callback;
    this._pingInterval = pingInterval;
    // Set up ping message timer
    this._pingTimerID = setTimeout(
      this._sendPing.bind(this),
      this._pingInterval
    );

    // Set up reconnecting timer
    this._timeoutTimerID = setTimeout(
      this._callback,
      this._pingInterval + 5000
    ); // Reconnect 5 sec after ping if no response

    trace("Watchdog started.");
  }

  /** Reset the reconnect timers. Call this method every time a new message arrives */
  public resetTimer(): void {
    // Reset timers
    clearTimeout(this._timeoutTimerID);
    clearTimeout(this._pingTimerID);
    this._pingTimerID = setTimeout(
      this._sendPing.bind(this),
      this._pingInterval
    );
    this._timeoutTimerID = setTimeout(
      this._callback,
      this._pingInterval + 5000
    ); // Reconnect 5 sec after ping if no response

    trace(
      `Reset reconnect timers. The ping and timeout timer will fire in ${
        this._pingInterval
      } and ${this._pingInterval + 5000} milliseconds, respectively.`
    );
  }

  /** Send a single "ping" message to the server */
  private _sendPing(): void {
    // Construct a ping message
    const pingRequest: SocketRequest = {
      method: "ping",
      headers: { authorization: "" },
      path: "",
    };
    this._wsClient.request(pingRequest);

    trace("Sending a ping message");
  }
}
