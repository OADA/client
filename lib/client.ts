import * as utils from "./utils";
import { WebSocketClient, Request, Response } from "./websocket";

export interface GETRequest {
  path: string;
  tree?: object;
  watchCallback?: (response: Response) => void;
}

export interface WatchRequest {
  path: string;
  watchCallback: (response: Response) => void;
}

/** Main  OADAClient class */
export class OADAClient {
  private _token: string;
  private _ws?: WebSocketClient;

  constructor() {
    this._token = "";
  }

  /**
   * Connect to OADA-compliant server
   * @param domain Domain. E.g., www.example.com
   * @param token Token.
   */
  public connect(domain: string, token: string): Promise<void> {
    if (this._ws && this._ws.isConnected()) {
      throw new Error("Already connected");
    }
    this._ws = new WebSocketClient(domain);
    this._token = token;
    return this._ws.connect();
  }

  /** Disconnect from server */
  public disconnect(): void {
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected");
    }
    // close
    this._ws.disconnect();
  }

  /**
   * Send GET request
   * @param request request
   */
  public async get(request: GETRequest): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    // ===  Top-level GET ===
    const topLevelResponse = await this._ws.request({
      method: "get",
      headers: {
        authorization: "Bearer " + this._token
      },
      path: request.path
    });

    // ===  Recursive GET  ===
    if (request.tree) {
      // Get subtree
      const arrayPath = utils.toArrayPath(request.path);
      const subTree = utils.getObjectAtPath(request.tree, arrayPath);

      // Replace "data" with the recursive GET result
      topLevelResponse.data = await this._recursiveGet(
        request.path,
        subTree,
        topLevelResponse.data
      );
    }

    // ===  Register Watch  ===
    if (request.watchCallback) {
      const watchResponse = await this.watch({
        path: request.path,
        watchCallback: request.watchCallback
      });
    }

    // Return top-level response
    return topLevelResponse;
  }

  /**
   * Set up watch
   * @param request watch request
   */
  public async watch(request: WatchRequest): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    // define a wrapper callback function
    const callback = response => {
      // ignore if the "change" field is not included in the message
      if (!response.change) {
        return;
      }
      // call user-defined callback function
      request.watchCallback(response);
    };

    const wsReq: Request = {
      method: "watch",
      headers: {
        authorization: "Bearer " + this._token
      },
      path: request.path
    };
    return await this._ws.request(wsReq, callback);
  }

  // GET resource recursively
  private async _recursiveGet(
    path: string,
    subTree: object,
    data: object
  ): Promise<object> {
    // If either subTree or data does not exist, there's mismatch between
    // the provided tree and the actual data stored on the server
    if (!subTree || !data) {
      throw new Error("Path mismatch.");
    }

    // if the object is a link to another resource (i.e., contains "_type"),
    // then perform GET
    if (subTree["_type"]) {
      data = (await this.get({ path })).data || {};
    }

    // select children to traverse
    let children: Array<any>; // FIXME: don't use 'any'
    if (subTree["*"]) {
      // If "*" is specified in the tree provided by the user,
      // get all children from the server
      children = Object.keys(data || {}).reduce(
        (acc, key) => {
          if (typeof data[key] == "object") {
            acc.push({ treeKey: "*", dataKey: key });
          }
          return acc;
        },
        <Array<any>>[]
      );
    } else {
      // Otherwise, get children from the tree provided by the user
      children = Object.keys(subTree || {}).reduce(
        (acc, key) => {
          if (typeof data[key] == "object") {
            acc.push({ treeKey: key, dataKey: key });
          }
          return acc;
        },
        <Array<any>>[]
      );
    }

    // initiate recursive calls
    let promises = children.map(async item => {
      const childPath = path + "/" + item.dataKey;
      const res = await this._recursiveGet(
        childPath,
        subTree[item.treeKey],
        data[item.dataKey]
      );
      data[item.dataKey] = res;
      return;
    });
    return await Promise.all(promises).then(() => {
      return data; // return object at "path"
    });
  }
}
