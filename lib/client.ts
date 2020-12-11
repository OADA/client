import ksuid from "ksuid";
import debug from "debug";
import * as utils from "./utils";
import { WebSocketClient } from "./websocket";

import { SocketResponse } from "./websocket";

import { Json, Change } from ".";

const trace = debug("@oada/client:client:trace");
const error = debug("@oada/client:client:error");

export interface Config {
  domain: string;
  token?: string;
  concurrency?: number;
  _ws?: WebSocketClient;
}

export type Response = SocketResponse;

export interface GETRequest {
  path: string;
  tree?: object;
  watchCallback?: (response: Readonly<Change>) => void;
  timeout?: number;
}

export interface WatchRequest {
  path: string;
  rev?: string;
  watchCallback: (response: Readonly<Change>) => void;
  timeout?: number;
}

export interface PUTRequest {
  path: string;
  data: Json;
  contentType?: string;
  revIfMatch?: number; // if-match
  tree?: object;
  timeout?: number;
}

export interface POSTRequest {
  path: string;
  data: Json;
  contentType?: string;
  tree?: object;
  timeout?: number;
}

export interface HEADRequest {
  path: string;
  timeout?: number;
}

export interface DELETERequest {
  path: string;
  timeout?: number;
}

/** Main  OADAClient class */
export class OADAClient {
  private _token = "";
  private _domain = "";
  private _concurrency = 1;
  private _ws: WebSocketClient;
  private _watchList: Map<string, WatchRequest>; // currentRequestId -> WatchRequest
  private _renewedReqIdMap: Map<string, string>; // currentRequestId -> originalRequestId

  constructor(config: Config) {
    this._domain = config.domain.replace(/^https:\/\//, ""); // help for those who can't remember if https should be there
    this._token = config.token || this._token;
    this._concurrency = config.concurrency || this._concurrency;
    this._watchList = new Map<string, WatchRequest>();
    this._renewedReqIdMap = new Map<string, string>();
    this._ws = new WebSocketClient(this._domain, this._concurrency);

    /* Register handler for the "open" event.
       This event is emitted when 1) this is an initial connection, or 2) the websocket is reconnected.
       For the initial connection, no special action is needed.
       For the reconnection case, we need to re-establish the watches. */
    this._ws.on("open", async () => {
      const prevWatchList = this._watchList;
      this._watchList = new Map<string, WatchRequest>();
      for (const [oldRequestId, watchRequest] of prevWatchList.entries()) {
        // Re-establish watch
        const newRequestId = await this.watch(watchRequest);
        // If requestId had been already renewed, keep the original requestId so that unwatch() can use that
        const originalRequestId = this._renewedReqIdMap.get(oldRequestId);
        if (originalRequestId) {
          this._renewedReqIdMap.set(newRequestId, originalRequestId);
          this._renewedReqIdMap.delete(oldRequestId);
        } else {
          this._renewedReqIdMap.set(newRequestId, oldRequestId);
        }
        // Debug message
        trace(`Update requestId: ${oldRequestId} -> ${newRequestId}`);
      }
    });
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
    // close
    return this._ws.disconnect();
  }

  /** Wait for the connection to open */
  public awaitConnection(): Promise<void> {
    return this._ws.awaitConnection();
  }

  /**
   * Send GET request
   * @param request request
   */
  public async get(request: GETRequest): Promise<Response> {
    // ===  Top-level GET ===
    const topLevelResponse = await this._ws.request(
      {
        method: "get",
        headers: {
          authorization: `Bearer ${this._token}`,
        },
        path: request.path,
      },
      undefined, // omitting an optional parameter
      request.timeout
    );

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
          if (change.path === "") {
            const watchRequest = this._watchList.get(resp.requestId[0]);
            if (watchRequest) {
              const newRev = change.body?.["_rev"];
              if (newRev) {
                watchRequest.rev = newRev;
                trace(
                  `Updated the rev of request ${resp.requestId[0]} to ${newRev}`
                );
              } else {
                throw new Error("The _rev field is missing.");
              }
            } else {
              throw new Error("The original watch request does not exist.");
            }
          }
        }
      },
      request.timeout
    );

    if (r.status !== 200) {
      throw new Error("Watch request failed!");
    }

    // Get requestId from the response
    const requestId: string = Array.isArray(r.requestId)
      ? r.requestId[0]
      : r.requestId; // server should always return an array requestId

    // Save watch request
    this._watchList.set(requestId, request);

    return requestId;
  }

  public async unwatch(requestId: string): Promise<Response> {
    // Retrieve the original requestId if it had been renewed
    // TODO: better way to do this?
    let activeRequestId = requestId;
    for (const [
      currentRequestId,
      originalRequestId,
    ] of this._renewedReqIdMap.entries()) {
      if (originalRequestId === requestId) {
        activeRequestId = currentRequestId;
      }
    }

    trace(`Unwatch requestId=${requestId}, actual=${activeRequestId}`);

    const response = await this._ws.request({
      path: "",
      headers: {
        authorization: "",
      },
      method: "unwatch",
      requestId: activeRequestId,
    });
    // TODO: add timeout

    // Remove watch state info (this should always exist)
    if (!this._watchList.delete(activeRequestId)) {
      throw new Error("Could not find watch state information.");
    }

    // Remove renewed requestId data (this may not exist if requestId has not been renewed)
    this._renewedReqIdMap.delete(activeRequestId);

    return response;
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
      // Retry counter
      let retryCount = 0;
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
          const resourceCheckResult = await this._resourceExists(partialPath);
          if (resourceCheckResult.exist) {
            // CASE 1: resource exists on server.
            // simply create a link using PUT request
            if (linkObj && newResourcePathArray.length > 0) {
              const linkPutResponse = await this.put({
                path: utils.toStringPath(newResourcePathArray),
                contentType,
                data: linkObj,
                revIfMatch: resourceCheckResult.rev, // Ensure the resource has not been modified (opportunistic lock)
              }).catch((msg) => {
                if (msg.status == 412) {
                  return msg;
                } else {
                  throw new Error(`Error: ${msg.statusText}`);
                }
              });

              // Handle return code 412 (If-Match failed)
              if (linkPutResponse.status == 412) {
                // Retry with exponential backoff
                if (retryCount++ < 5) {
                  await utils.delay(
                    1000 * (retryCount * retryCount + Math.random())
                  );
                  // Reset loop counter and do tree construction again.
                  i = pathArray.length - 1;
                  continue;
                } else {
                  throw Error("If-match failed.");
                }
              }
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
                ? { _id: resourceId, _rev: 0 } // versioned link
                : { _id: resourceId }; // non-versioned link
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
    return this._ws.request(
      {
        method: "put",
        headers: {
          authorization: `Bearer ${this._token}`,
          "content-type": contentType,
          ...(request.revIfMatch && {
            "if-match": request.revIfMatch.toString(),
          }), // Add if-match header if revIfMatch is provided
        },
        path: request.path,
        data: request.data,
      },
      undefined, // omitting an optional parameter
      request.timeout
    );
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
    return this._ws.request(
      {
        method: "post",
        headers: {
          authorization: `Bearer ${this._token}`,
          "content-type": contentType,
        },
        path: request.path,
        data,
      },
      undefined, // omitting an optional parameter
      request.timeout
    );
  }

  /**
   * Send HEAD request
   * @param request HEAD request
   */
  public async head(request: HEADRequest): Promise<Response> {
    // return HEAD response
    return this._ws.request(
      {
        method: "head",
        headers: {
          authorization: `Bearer ${this._token}`,
        },
        path: request.path,
      },
      undefined, // omitting an optional parameter
      request.timeout
    );
  }

  /**
   * Send DELETE request
   * @param request DELETE request
   */
  public async delete(request: DELETERequest): Promise<Response> {
    // return HEAD response
    return this._ws.request(
      {
        method: "delete",
        headers: {
          authorization: `Bearer ${this._token}`,
        },
        path: request.path,
      },
      undefined, // omitting an optional parameter
      request.timeout
    );
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
  private async _resourceExists(
    path: string
  ): Promise<{ exist: boolean; rev?: number }> {
    // In tree put to /resources, the top-level "/resources" should
    // look like it exists, even though oada doesn't allow GET on /resources
    // directly.
    if (path === "/resources") {
      return { exist: true };
    }

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
      return { exist: true, rev: headResponse.headers["x-oada-rev"] };
    } else if (headResponse.status == 404) {
      return { exist: false };
    } else {
      throw Error("Status code is neither 200 nor 404.");
    }
  }
}
