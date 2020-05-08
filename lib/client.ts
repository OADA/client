import ksuid from "ksuid";
import * as utils from "./utils";
import { WebSocketClient } from "./websocket";

import SocketResponse from "@oada/types/oada/websockets/response";
import { Change, is as isChangeV2 } from "@oada/types/oada/change/v2";

export interface Config {
  domain: string;
  options?: {
    redirect: string;
    metadata: string;
    scope: string;
  };
  token?: string;
}

export interface GETRequest {
  path: string;
  tree?: object;
  token?: string;
  watchCallback?: (response: WatchResponse) => void;
}

export interface WatchRequest {
  path: string;
  token?: string;
  watchCallback: (response: WatchResponse) => void;
}

export interface PUTRequest {
  path: string;
  data: object;
  contentType?: string;
  tree?: object;
  token?: string;
}

export interface HEADRequest {
  path: string;
  token?: string;
}

export interface DELETERequest {
  path: string;
  token?: string;
}

export type Response = SocketResponse;
export type WatchResponse = Change;

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
  public connect(config: Config): Promise<void> {
    if (this._ws && this._ws.isConnected()) {
      throw new Error("Already connected");
    }
    if (!config.token) {
      throw new Error("Token is required."); // FIXME
    }

    this._ws = new WebSocketClient(config.domain);
    this._token = config.token;
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
        authorization: "Bearer " + request.token || this._token,
      },
      path: request.path,
    });

    // ===  Recursive GET  ===
    if (request.tree) {
      // Get subtree
      const arrayPath = utils.toArrayPath(request.path);
      const subTree = utils.getObjectAtPath(request.tree, arrayPath);

      // Replace "data" with the recursive GET result
      // @ts-ignore
      topLevelResponse.data = await this._recursiveGet(
        request.path,
        subTree,
        topLevelResponse.data || {}
      );
    }

    // ===  Register Watch  ===
    if (request.watchCallback) {
      await this.watch({
        path: request.path,
        watchCallback: request.watchCallback,
      });
    }

    // Return top-level response
    return topLevelResponse;
  }

  /**
   * Set up watch
   * @param request watch request
   */
  public async watch(request: WatchRequest): Promise<string> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    const wsReq = {
      method: "watch",
      headers: {
        authorization: `Bearer ${request.token || this._token}`,
      },
      path: request.path,
    };

    const r = await this._ws.request(wsReq, (resp) => {
      if (isChangeV2(resp.change)) {
        for (const change of resp.change) {
          request.watchCallback(change);
        }
      }
    });

    if (r.status !== 200) {
      throw new Error("Watch request failed!");
    }

    return r.requestId[0];
  }

  public async unwatch(requestId: string): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    return await this._ws.request({
      method: "unwatch",
      requestId: requestId,
    });
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
      children = Object.keys(data || {}).reduce((acc, key) => {
        if (typeof data[key] == "object") {
          acc.push({ treeKey: "*", dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    } else {
      // Otherwise, get children from the tree provided by the user
      children = Object.keys(subTree || {}).reduce((acc, key) => {
        if (typeof data[key] == "object") {
          acc.push({ treeKey: key, dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    }

    // initiate recursive calls
    let promises = children.map(async (item) => {
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

  /**
   * Send PUT request
   * @param request PUT request
   */
  public async put(request: PUTRequest): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    // convert string path to array (e.g., /bookmarks/abc/def -> ['bookmarks', 'abc', 'def'])
    const pathArray = utils.toArrayPath(request.path);

    if (request.tree) {
      // link object (eventually substituted by an actual link object)
      let linkObj: object | undefined;
      let newResourcePathArray: Array<string> = [];
      for (let i = pathArray.length - 1; i >= 0; i--) {
        // get current path
        const partialPathArray = pathArray.slice(0, i + 1);
        // get corresponding data definition from the provided tree
        const treeObj = utils.getObjectAtPath(request.tree, partialPathArray);
        if ("_type" in treeObj) {
          // it's a resource
          const contentType = treeObj["_type"];
          const partialPath = utils.toStringPath(partialPathArray);
          // check if resource already exists on the remote server
          if (await this._resourceExists(partialPath, request.token)) {
            // CASE 1: resource exists on server.
            // simply create a link using PUT request
            if (linkObj && newResourcePathArray.length > 0) {
              await this.put({
                path: utils.toStringPath(newResourcePathArray),
                contentType,
                data: linkObj,
              });
            }
            // We hit a resource that already exists. No need to further traverse the tree.
            break;
          } else {
            // CASE 2: resource does NOT exist on server.
            // create a new nested object containing a link
            const relativePathArray = newResourcePathArray.slice(i + 1);
            const newResource = linkObj
              ? utils.createNestedObject(linkObj, relativePathArray)
              : undefined;
            // create a new resource
            const resourceId = await this._createResource(
              contentType,
              newResource,
              request.token
            );
            // save a link
            linkObj =
              "_rev" in treeObj
                ? { _id: resourceId, _type: contentType, _rev: 0 } // versioned link
                : { _id: resourceId, _type: contentType }; // non-versioned link
            newResourcePathArray = partialPathArray.slice(); // clone
          }
        }
      }
    }

    // Get content-type
    let contentType =
      request.contentType || // 1) get content-type from the argument
      request.data["_type"] || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree!, pathArray)["_type"] // 3) get content-type from the tree
        : undefined);
    if (!contentType) {
      throw new Error("Content type is not specified.");
    }

    // return PUT response
    return this._ws.request({
      method: "put",
      headers: {
        authorization: "Bearer " + request.token || this._token,
        "content-type": contentType,
      },
      path: request.path,
      data: request.data,
    });
  }

  /**
   * Send HEAD request
   * @param request HEAD request
   */
  public async head(request: HEADRequest): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    // return HEAD response
    return this._ws.request({
      method: "head",
      headers: {
        authorization: "Bearer " + request.token || this._token,
      },
      path: request.path,
    });
  }

  /**
   * Send DELETE request
   * @param request DELETE request
   */
  public async delete(request: DELETERequest): Promise<Response> {
    // ensure connection
    if (!this._ws || !this._ws.isConnected()) {
      throw new Error("Not connected.");
    }

    // return HEAD response
    return this._ws.request({
      method: "delete",
      headers: {
        authorization: "Bearer " + request.token || this._token,
      },
      path: request.path,
    });
  }

  /** Create a new resource. Returns resource ID */
  private async _createResource(
    contentType: string,
    data?: object,
    token?: string
  ): Promise<string> {
    // Create unique resource ID
    const resourceId = "resources/" + ksuid.randomSync().string;
    // append resource ID and content type to object
    const fullData = { _id: resourceId, _type: contentType, ...data };
    // send PUT request
    await this.put({
      path: "/" + resourceId,
      data: fullData,
      token,
      contentType,
    });
    // return resource ID
    return resourceId;
  }

  /** check if the specified path exists. Returns boolean value. */
  private async _resourceExists(
    path: string,
    token?: string
  ): Promise<boolean> {
    // send HEAD request
    const headResponse = await this.head({ path, token }).catch((msg) => {
      if (msg.status == 404) {
        return msg;
      } else {
        throw new Error("Error");
      }
    });
    // check status value
    if (headResponse.status == 200) {
      return true;
    } else if (headResponse.status == 404) {
      return false;
    } else {
      throw Error("Status code is neither 200 nor 404.");
    }
  }
}
