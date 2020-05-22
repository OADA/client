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

export type Response = SocketResponse;

export type RequestHeaders = {
  authorization?: string,
  'content-type'?: string,
  [x: string]: any, // other headers we don't know about
};

export interface GETRequest {
  path: string;
  tree?: object;
  headers?: RequestHeaders;
  watchCallback?: (response: Readonly<Change>) => void;
  maxretries?: number; // defaults to 10, or you can specify
}

export interface WatchRequest {
  path: string;
  rev?: string;
  headers?: RequestHeaders;
  watchCallback: (response: Readonly<Change>) => void;
}

export interface PUTRequest {
  path: string;
  data: Json;
  contentType?: string;
  tree?: object;
  headers?: RequestHeaders;
  maxretries?: number; // defaults to 10, or you can specify
}

export interface POSTRequest {
  path: string;
  data: Json;
  contentType?: string;
  headers?: RequestHeaders;
  tree?: object;
  maxretries?: number; // defaults to 10, or you can specify
}

export interface HEADRequest {
  path: string;
  headers?: RequestHeaders;
  maxretries?: number; // defaults to 10, or you can specify
}

export interface DELETERequest {
  path: string;
  headers?: RequestHeaders;
}

type Request = GETRequest | PUTRequest | POSTRequest | HEADRequest; // Cannot retry DELETEs yet, not sure if it makes sense "retry" WATCH
export interface RetryRequest {
  request: Request;
  method: 'get' | 'put' | 'post' | 'head';
  retries?: number;
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
   * Send GET request, with exponential backoff up to 10 retries
   * @param request request
   */
  public async get(request: GETRequest): Promise<Response> {
    // ===  Top-level GET ===
    const topLevelResponse = await this.getRetry(request);

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
              await this.putRetry({
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
    request.contentType =
      request.contentType || // 1) get content-type from the argument
      (request.data && request.data["_type"]) || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree!, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    // return PUT response
    return this.putRetry(request);
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
    request.contentType =
      request.contentType || // 1) get content-type from the argument
      (request.data && request.data["_type"]) || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree!, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    return this.postRetry(request);
  }


  /**
   * Send HEAD request
   * @param request HEAD request
   */
  public async head(request: HEADRequest): Promise<Response> {
    return this.headRetry(request);  
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
    // send HEAD request
    const headResponse = await this.head({
      path,
    }).catch((msg) => {
      if (msg.status == 404) {
        return msg;
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

  public async  getRetry(request:  GETRequest): Promise<Response> { return this.requestRetry({ request, method: 'get' }); }
  public async  putRetry(request:  PUTRequest): Promise<Response> { return this.requestRetry({ request, method: 'put' }); }
  public async postRetry(request: POSTRequest): Promise<Response> { return this.requestRetry({ request, method: 'post' }); }
  public async headRetry(request: HEADRequest): Promise<Response> { return this.requestRetry({ request, method: 'head' }); }

  public async requestRetry(rreq: RetryRequest): Promise<Response> {
    let { request, method, retries } = rreq;
    request.headers  = request.headers || {};
    if (!request.headers['authorization'] && !request.headers['Authorization']) {
      request.headers['authorization'] = `Bearer ${this._token}`;
    }
    if (typeof request.contentType !== 'undefined') request.headers['content-type'] = request.contentType;
    if (typeof request.maxretries !== 'number') {
      request.maxretries = 10; // default retries to 10
    }
    if (typeof retries === 'undefined') retries = 0;

    return this._ws.request({
      method,
      headers: request.headers,
      path: request.path,
      data: request.data,

    // Do the retry algorithm:
    }).catch (e => {
      if (!e.status) throw e; // not a web error
      if (e.status !== 401 && e.status !== 403 && e.status < 500) {
        throw e; // failed due to reason unrelated to load
      }
      // Otherwise, 401, 403, or 500 COULD be load-related, try again
      if (retries++ >= request.maxretries) {
        trace(`Finished retrying failed request ${request.maxretries} times, request still failed, giving up`);
        throw e;
      }
      return new Promise((resolve, reject) => {
        // Exponential backoff (half-seconds): .5, 2, 4.5, 8, ...
        setTimeout((retries * retries)*500, () => { // exponential backup (x^2 half-seconds)
          try { 
            const result = await requestRetry({method, request, retries });
            return resolve(result);
          } catch (e) { 
            return reject(e); 
          }
        });
      });
    }); // end catch

  }

}


