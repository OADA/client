import ksuid from "ksuid";
import * as utils from "./utils";
import { WebSocketClient } from "./websocket";

import { SocketResponse } from "./websocket";

import { Json, Change } from ".";

export interface Config {
  domain: string;
  token?: string;
  concurrency?: number;
  _ws?: WebSocketClient;
}

export type Response<Data = Json> = SocketResponse<Data>;

export interface GETRequest {
  path: string;
  tree?: object;
  watchCallback?: (response: Readonly<Change>) => void;
}

export interface WatchRequest {
  path: string;
  rev?: string;
  watchCallback: (response: Readonly<Change>) => void;
}

export interface PUTRequest {
  path: string;
  data: Json;
  contentType?: string;
  tree?: object;
}

export interface POSTRequest {
  path: string;
  data: Json;
  contentType?: string;
  tree?: object;
}

export interface HEADRequest {
  path: string;
}

export interface DELETERequest {
  path: string;
}

/** Main  OADAClient class */
export class OADAClient {
  private _token = "";
  private _domain = "";
  private _concurrency = 1;
  private _ws: WebSocketClient;

  constructor(config: Config) {
    this._domain = config.domain.replace(/^https:\/\//,''); // help for those who can't remember if https should be there
    this._token = config.token || this._token;
    this._concurrency = config.concurrency || this._concurrency;
    this._ws = new WebSocketClient(this._domain, this._concurrency);
  }

  /**
   * Repurpose a existing connection to OADA-compliant server with a new token
   * @param token New token.
   */
  public clone(token: string): OADAClient {
    const c = new OADAClient({
      domain: this._domain,
      token: token,
      concurrency: this._concurrency,
      // Reuse existing WS connection
      _ws: this._ws,
    });

    return c;
  }

  /**
   * Get the connection token
   */
  public getToken(): string {
    return this._token;
  }

  /**
   * Get the connection domain
   */
  public getDomain(): string {
    return this._domain;
  }

  /** Disconnect from server */
  public disconnect(): Promise<void> {
    if (!this._ws.isConnected()) {
      throw new Error("Not connected");
    }
    // close
    return this._ws.disconnect();
  }

  /**
   * Send GET request
   * @param request request
   */
  public async get<Data = Json>(request: GETRequest): Promise<Response<Data>> {
    // ===  Top-level GET ===
    const topLevelResponse = await this._ws.request<Data>({
      method: "get",
      headers: {
        authorization: `Bearer ${this._token}`,
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
      const rev = topLevelResponse.headers
        ? topLevelResponse.headers["x-oada-rev"]
        : undefined;

      await this.watch({
        path: request.path,
        rev,
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
    let headers = {};

    if (request.rev) {
      headers["x-oada-rev"] = request.rev;
    }

    const r = await this._ws.request(
      {
        method: "watch",
        headers: {
          authorization: `Bearer ${this._token}`,
          ...headers,
        },
        path: request.path,
      },
      (resp) => {
        for (const change of resp.change) {
          request.watchCallback(change);
        }
      }
    );

    if (r.status !== 200) {
      throw new Error("Watch request failed!");
    }

    return Array.isArray(r.requestId) ? r.requestId[0] : r.requestId; // server should always return an array requestId
  }

  public async unwatch(requestId: string): Promise<Response> {
    return await this._ws.request({
      path: "",
      headers: {
        authorization: "",
      },
      method: "unwatch",
      requestId: requestId,
    });
  }

  // GET resource recursively
  private async _recursiveGet(
    path: string,
    subTree: object,
    data: Json
  ): Promise<Json> {
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
      children = Object.keys(data).reduce((acc, key) => {
        if (data && typeof data[key] == "object") {
          acc.push({ treeKey: "*", dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    } else {
      // Otherwise, get children from the tree provided by the user
      children = Object.keys(subTree || {}).reduce((acc, key) => {
        if (data && typeof data[key] == "object") {
          acc.push({ treeKey: key, dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    }

    // initiate recursive calls
    let promises = children.map(async (item) => {
      const childPath = path + "/" + item.dataKey;
      if (!data) {
        return;
      }
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
    // convert string path to array (e.g., /bookmarks/abc/def -> ['bookmarks', 'abc', 'def'])
    const pathArray = utils.toArrayPath(request.path);

    if (request.tree) {
      // link object (eventually substituted by an actual link object)
      let linkObj: Json = null;
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
          if (await this._resourceExists(partialPath)) {
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
              : {};
            // create a new resource
            const resourceId = await this._createResource(
              contentType,
              newResource
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
      (request.data && request.data["_type"]) || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree!, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    // return PUT response
    return this._ws.request({
      method: "put",
      headers: {
        authorization: `Bearer ${this._token}`,
        "content-type": contentType,
      },
      path: request.path,
      data: request.data,
    });
  }

  /**
   * Send POST request
   * @param request PUT request
   */
  public async post(request: POSTRequest): Promise<Response> {
    // convert string path to array (e.g., /bookmarks/abc/def -> ['bookmarks', 'abc', 'def'])
    const pathArray = utils.toArrayPath(request.path);

    const data = request.data;
    if (request.tree) {
      // TODO: Is a tree POST really just a tree PUT followed by a POST to that
      // path?
      request.data = {};
      await this.put(request);
    }

    // Get content-type
    let contentType =
      request.contentType || // 1) get content-type from the argument
      (request.data && request.data["_type"]) || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree!, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    // return PUT response
    return this._ws.request({
      method: "post",
      headers: {
        authorization: `Bearer ${this._token}`,
        "content-type": contentType,
      },
      path: request.path,
      data,
    });
  }

  /**
   * Send HEAD request
   * @param request HEAD request
   */
  public async head(request: HEADRequest): Promise<Response> {
    // return HEAD response
    return this._ws.request({
      method: "head",
      headers: {
        authorization: `Bearer ${this._token}`,
      },
      path: request.path,
    });
  }

  /**
   * Send DELETE request
   * @param request DELETE request
   */
  public async delete(request: DELETERequest): Promise<Response> {
    // return HEAD response
    return this._ws.request({
      method: "delete",
      headers: {
        authorization: `Bearer ${this._token}`,
      },
      path: request.path,
    });
  }

  /** Create a new resource. Returns resource ID */
  private async _createResource(
    contentType: string,
    data: Json
  ): Promise<string> {
    // Create unique resource ID
    const resourceId = "resources/" + ksuid.randomSync().string;
    // append resource ID and content type to object
    // const fullData = { _id: resourceId, _type: contentType, ...data };
    // send PUT request
    await this.put({
      path: "/" + resourceId,
      data,
      contentType,
    });
    // return resource ID
    return resourceId;
  }

  /** check if the specified path exists. Returns boolean value. */
  private async _resourceExists(path: string): Promise<boolean> {
    // In tree put to /resources, the top-level "/resources" should
    // look like it exists, even though oada doesn't allow GET on /resources
    // directly.
    if (path === '/resources') return true;

    // Otherwise, send HEAD request for resource
    const headResponse = await this.head({
      path,
    }).catch((msg) => {
      if (msg.status == 404) {
        return msg;
      } else if (msg.status == 403 && path.match(/^\/resources/)) {
        return { status: 404 }; // 403 is what you get on resources that don't exist (i.e. Forbidden)
      } else {
        throw new Error(`Error: ${msg.statusText}`);
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
