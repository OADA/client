import ksuid from "ksuid";
import deepClone from "deep-clone";
import debug from "debug";
import * as utils from "./utils";
import type { EventEmitter } from "events";
import { WebSocketClient } from "./websocket";
import { HttpClient } from "./http";

import type { Json, Change } from ".";

const trace = debug("@oada/client:client:trace");
const info = debug("@oada/client:client:info");
//const error = debug("@oada/client:client:error");

export interface ConnectionRequest {
  requestId?: string;
  path: string;
  method: "head" | "get" | "put" | "post" | "delete" | "watch" | "unwatch";
  headers: Record<string, string>;
  data?: Json;
}

export interface ConnectionResponse {
  requestId: string | Array<string>;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: Json;
}

export interface ConnectionChange {
  requestId: Array<string>;
  resourceId: string;
  path_leftover: string | Array<string>;
  change: Array<Change>;
}

export interface Connection extends EventEmitter {
  disconnect(): Promise<void>;
  isConnected(): boolean;
  awaitConnection(): Promise<void>;
  request(
    req: ConnectionRequest,
    callback?: (response: Readonly<ConnectionChange>) => void,
    timeout?: number
  ): Promise<ConnectionResponse>;
}

export interface Config {
  domain: string;
  token?: string;
  concurrency?: number;
  connection?: "ws" | "http" | Connection;
}

export type Response = ConnectionResponse;

export interface GETRequest {
  path: string;
  tree?: object;
  watchCallback?: (response: Readonly<Change>) => Promise<void>;
  timeout?: number;
}

export interface PersistConfig {
  name: string;
}

export interface WatchPersist {
  lastRev: number,
  items: object,
  active: boolean,
}

/**
 * Watch whose callback gets single changes
 */
export interface WatchRequestSingle {
  type?: "single";
  path: string;
  rev?: string;
  persist?: PersistConfig;
  watchCallback: (response: Readonly<Change>) => Promise<void>;
  timeout?: number;
}

/**
 * Watch whose callback gets change trees
 */
export interface WatchRequestTree {
  type: "tree";
  path: string;
  rev?: string;
  persist?: PersistConfig;
  watchCallback: (response: readonly Readonly<Change>[]) => void;
  timeout?: number;
}

/**
 * Discriminated union of watch for single changes or watch for change trees
 */
export type WatchRequest = WatchRequestSingle | WatchRequestTree;

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

export interface ENSURERequest {
  path: string;
  timeout?: number;
  tree?: object;
  data: Json;
}

/**
 * @internal
 */
export interface OADATree {
  // @ts-ignore
  _type: string;
  [k: string]: OADATree;
}

/** Main  OADAClient class */
export class OADAClient {
  private _token = "";
  private _domain = "";
  private _concurrency = 1;
  private _ws: Connection;
  private _watchList: Map<string, WatchRequest>; // currentRequestId -> WatchRequest
  private _renewedReqIdMap: Map<string, string>; // currentRequestId -> originalRequestId
  private _persistList: Map<string, WatchPersist>;

  constructor(config: Config) {
    this._domain = config.domain.replace(/^https:\/\//, ""); // help for those who can't remember if https should be there
    this._token = config.token || this._token;
    this._concurrency = config.concurrency || this._concurrency;
    this._watchList = new Map<string, WatchRequest>();
    this._persistList = new Map<string, WatchPersist>();
    this._renewedReqIdMap = new Map<string, string>();
    if (!config.connection || config.connection === "ws") {
      this._ws = new WebSocketClient(this._domain, this._concurrency);
    } else if (config.connection === "http") {
      this._ws = new HttpClient(this._domain, this._token, this._concurrency);
    } else {
      // Otherwise, they gave us a WebSocketClient to use
      this._ws = config.connection as Connection;
    }

    /* Register handler for the "open" event.
       This event is emitted when 1) this is an initial connection, or 2) the websocket is reconnected.
       For the initial connection, no special action is needed.
z      For the reconnection case, we need to re-establish the watches. */
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
      connection: this._ws,
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
      const subTree = utils.getObjectAtPath(
        request.tree,
        arrayPath
      ) as OADATree;

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
    const headers: Record<string, string> = {};

    //TODO: Decide whether this should go after persist to allow it to override the persist rev
    if (typeof request.rev !== "undefined") {
      headers["x-oada-rev"] = request.rev;
    }

    if (request.persist && request.persist.name) {
      const name = request.persist.name;
      const persistPath = request.path+`/_meta/watchPersists/${name}`;
      let lastRev;
      await this.get({
        path: persistPath
      }).then(r => {
        if (typeof r.data === 'object' && !Array.isArray(r.data)) {
          lastRev = r?.data?.rev;
          headers["x-oada-rev"] = lastRev;
        }
        info(`Watch persist found _meta entry for [${name}]. Setting x-oada-rev header to ${lastRev}`);
      }).catch(async () => {
        let rev = await this.get({
          path: request.path+`/_meta`
        }).then(r => {
          if (typeof r.data === 'object' && !Array.isArray(r.data)) {
            return r?.data?._rev
          }
          return;
        })
        lastRev = rev;

        let _id;
        if (typeof lastRev === 'number') {
          _id = await this.post({
            path: `/resources`,
            data: { rev: lastRev }
          }).then(r => {
            if (r.headers && r.headers['content-location']) {
              return r.headers['content-location'].replace(/^\//, '')
            } else return;
          })
        }

        if (_id === undefined) return

        await this.put({
          path: persistPath,
          data: {_id}
        })
        info(`Watch persist did not find _meta entry for [${name}]. Current resource _rev is ${lastRev}. Not setting x-oada-rev header. _meta entry created.`);
      })
      this._persistList.set(persistPath, {lastRev, items: {}, active: false});
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
        if (request.type === "tree") {
          request.watchCallback(deepClone(resp.change))
        }
        let persistEvery : boolean[] = Array(resp.change.length).fill(false);
        for (const [_i, change] of resp.change.entries()) {
          if (!request.type || request.type === "single") {
            request.watchCallback(deepClone(change))
            .then(() => {
              if (request.persist && request.persist.name) {
                persistEvery[_i] = true;

                // Persist the new parent rev 
                if (request.persist && persistEvery.every(i => i)) {
                  const bod = (resp?.change.find(c => c.path === ""))?.body
                  let rev;
                  if (typeof bod === 'object' && bod !== null && !Array.isArray(bod)) {
                    rev = bod._rev;
                  }
          
                  const persistPath = request.path+`/_meta/watchPersists/${request.persist.name}`;
                  let p = this._persistList.get(persistPath)
                  if (p && p.items && typeof rev === 'number') {
                    p.items[rev] = true;
                    this._persistList.set(persistPath, p)
                  }
                  if (p && p.active === false && typeof rev === 'number') {
                    p.active = true;
                    this._persistList.set(persistPath, p)
                    this._persistWatch(persistPath, rev)
                  }
                }
              }
            })
            .catch((err) => {
              if (request.persist && request.persist.name) {
                persistEvery[_i] = true;

              // Persist the new parent rev 
                if (request.persist && persistEvery.every(i => i)) {
                  const bod = (resp?.change.find(c => c.path === ""))?.body
                  let rev;
                  if (typeof bod === 'object' && bod !== null && !Array.isArray(bod)) {
                    rev = bod._rev;
                  }
          
                  const persistPath = request.path+`/_meta/watchPersists/${request.persist.name}`;
                  let p = this._persistList.get(persistPath)
                  if (p && p.items && typeof rev === 'number') {
                    p.items[rev] = true;
                    this._persistList.set(persistPath, p)
                  }
                  if (p && p.active === false && typeof rev === 'number') {
                    p.active = true;
                    this._persistList.set(persistPath, p)
                    this._persistWatch(persistPath, rev)
                  }
                }

              }
              throw err;
            })
          }
          if (change.path === "") {
            const watchRequest = this._watchList.get(resp.requestId[0]!);
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
      ? r.requestId[0]!
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
    subTree: OADATree,
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
        if (data && typeof data[key] === "object") {
          acc.push({ treeKey: "*", dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    } else {
      // Otherwise, get children from the tree provided by the user
      children = Object.keys(subTree || {}).reduce((acc, key) => {
        if (data && typeof data[key] === "object") {
          acc.push({ treeKey: key, dataKey: key });
        }
        return acc;
      }, <Array<any>>[]);
    }

    // initiate recursive calls
    const promises = children.map(async (item) => {
      const childPath = path + "/" + item.dataKey;
      if (!data) {
        return;
      }
      const res = await this._recursiveGet(
        childPath,
        subTree[item.treeKey]!,
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
        const treeObj = utils.getObjectAtPath(
          request.tree,
          partialPathArray
        ) as OADATree;
        if ("_type" in treeObj) {
          // it's a resource
          const contentType = treeObj["_type"]!;
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
                    100 * (retryCount * retryCount + Math.random())
                  );
                  // Reset loop counter and do tree construction again.
                  i = pathArray.length;
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
    const contentType =
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
      // We could go to all the trouble of re-implementing tree puts for posts, but it's much easier to just make
      // a ksuid and do the tree put
      const newkey = (await ksuid.random()).string;
      request.path += `/${newkey}`;
      return await this.put(request);
    }

    // Get content-type
    const contentType =
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

  /**
   * Ensure a particular path with tree exists 
   * @param request ENSURERequest
   */
  public async ensure(request: ENSURERequest): Promise<Response> {
    // return ENSURE response
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
    ).catch(err => {
      if (err.status !== 404) throw err;
      trace('Path to ensure did not exist. Creating')
      return this.put(request);
    })
  }

  /** Attempt to save the latest rev processed, accomodating concurrency */
  private async _persistWatch(
    persistPath: string,
    rev: number
  ): Promise<void> {
    info(`Persisting watch for path ${persistPath} to rev ${rev}`);
    const persist = this._persistList.get(persistPath);
    if (!persist) {
      return;
    }
    let {lastRev, items} = persist;
    if (rev === lastRev+1) {
      console.log(items[lastRev+1])
      while (items[lastRev+1]) {
        lastRev++;
        delete items[lastRev];
        this._persistList.set(persistPath, {lastRev, items, active: false});
      }

      await this.put({
        path: persistPath+`/rev`,
        data: lastRev,
      })
      console.log({items, lastRev});
      info(`Persisted watch: path: [${persistPath}], rev: [${lastRev}]`);
    }
    return;
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
        // 403 is what you get on resources that don't exist (i.e. Forbidden)
        return { status: 404 };
      } else {
        throw new Error(
          `Error: head for resource returned ${msg.statusText || msg}`
        );
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
