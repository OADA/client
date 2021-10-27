import ksuid from "ksuid";
import deepClone from "deep-clone";
import debug from "debug";
import { Buffer } from "buffer";
import { fromBuffer } from "file-type";

import * as utils from "./utils";
import type { EventEmitter } from "events";
import { WebSocketClient } from "./websocket";
import { HttpClient } from "./http";

import type { Json, Change, JsonObject } from ".";

const trace = debug("@oada/client:client:trace");
const info = debug("@oada/client:client:info");
//const error = debug("@oada/client:client:error");

/**
 * @todo Support more than just Buffer?
 */
export type Body = Json | Buffer;

export interface ConnectionRequest {
  requestId?: string;
  path: string;
  method: "head" | "get" | "put" | "post" | "delete" | "watch" | "unwatch";
  headers: Record<string, string>;
  data?: Body;
}

export interface ConnectionResponse {
  requestId: string | Array<string>;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data?: Body;
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
  /** @default 1 */
  concurrency?: number;
  /** @default "http" */
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
  items: {[key: string]: boolean};
}

/**
 * Watch whose callback gets single changes
 */
export interface WatchRequestSingle {
  type?: "single";
  path: string;
  rev?: number | string;
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
  data: Body;
  contentType?: string;
  revIfMatch?: number; // if-match
  tree?: object;
  timeout?: number;
}

export interface POSTRequest {
  path: string;
  data: Body;
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
  _type?: string;
  [k: string]: OADATree;
}

/** Main  OADAClient class */
export class OADAClient {
  #token;
  #domain;
  #concurrency;
  #ws: Connection;
  #watchList: Map<string, WatchRequest>; // currentRequestId -> WatchRequest
  #renewedReqIdMap: Map<string, string>; // currentRequestId -> originalRequestId
  #persistList: {[key: string]: WatchPersist};

  constructor({
    domain,
    token = "",
    concurrency = 1,
    connection = "http",
  }: Config) {
    // help for those who can't remember if https should be there
    this.#domain = domain.replace(/^https:\/\//, "");
    this.#token = token;
    this.#concurrency = concurrency;
    this.#watchList = new Map<string, WatchRequest>();
    this.#persistList = {};
    this.#renewedReqIdMap = new Map<string, string>();
    if (connection === "ws") {
      this.#ws = new WebSocketClient(this.#domain, this.#concurrency);
    } else if (connection === "http") {
      this.#ws = new HttpClient(this.#domain, this.#token, this.#concurrency);
    } else {
      // Otherwise, they gave us a WebSocketClient to use
      this.#ws = connection;
    }

    /* Register handler for the "open" event.
       This event is emitted when 1) this is an initial connection, or 2) the websocket is reconnected.
       For the initial connection, no special action is needed.
z      For the reconnection case, we need to re-establish the watches. */
    this.#ws.on("open", async () => {
      const prevWatchList = this.#watchList;
      this.#watchList = new Map<string, WatchRequest>();
      for (const [oldRequestId, watchRequest] of prevWatchList.entries()) {
        // Re-establish watch
        const newRequestId = await this.watch(watchRequest);
        // If requestId had been already renewed, keep the original requestId so that unwatch() can use that
        const originalRequestId = this.#renewedReqIdMap.get(oldRequestId);
        if (originalRequestId) {
          this.#renewedReqIdMap.set(newRequestId, originalRequestId);
          this.#renewedReqIdMap.delete(oldRequestId);
        } else {
          this.#renewedReqIdMap.set(newRequestId, oldRequestId);
        }
        // Debug message
        trace("Update requestId: %s -> %s", oldRequestId, newRequestId);
      }
    });
  }

  /**
   * Repurpose a existing connection to OADA-compliant server with a new token
   * @param token New token.
   */
  public clone(token: string): OADAClient {
    const c = new OADAClient({
      domain: this.#domain,
      token: token,
      concurrency: this.#concurrency,
      // Reuse existing WS connection
      connection: this.#ws,
    });

    return c;
  }

  /**
   * Get the connection token
   */
  public getToken(): string {
    return this.#token;
  }

  /**
   * Get the connection domain
   */
  public getDomain(): string {
    return this.#domain;
  }

  /** Disconnect from server */
  public disconnect(): Promise<void> {
    // close
    return this.#ws.disconnect();
  }

  /** Wait for the connection to open */
  public awaitConnection(): Promise<void> {
    return this.#ws.awaitConnection();
  }

  /**
   * Send GET request
   * @param request request
   */
  public async get(request: GETRequest): Promise<Response> {
    // ===  Top-level GET ===
    const topLevelResponse = await this.#ws.request(
      {
        method: "get",
        headers: {
          authorization: `Bearer ${this.#token}`,
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
        request.tree as OADATree,
        arrayPath
      ) as OADATree;

      // Replace "data" with the recursive GET result
      topLevelResponse.data = await this.#recursiveGet(
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
      headers["x-oada-rev"] = request.rev + "";
    }

    if (request.persist && request.persist.name) {
      const name = request.persist.name;
      const persistPath = request.path+`/_meta/watchPersists/${name}`;
      let lastRev : any;

      let rev = await this.get({
        path: request.path+`/_meta`
      }).then(r => {
        if (typeof r.data === 'object' && !Buffer.isBuffer(r.data) && !Array.isArray(r.data)) {
          return r?.data?._rev
        }
        return;
      })

      await this.get({
        path: persistPath
      }).then(async r => {
        if (typeof r.data === 'object' && !Buffer.isBuffer(r.data) && !Array.isArray(r.data)) {
          lastRev = r?.data?.rev;
          headers["x-oada-rev"] = lastRev;
          info(`Watch persist found _meta entry for [${name}]. Setting x-oada-rev header to ${lastRev}`);
        }
        if (!lastRev) {
          info(`Watch persist found _meta entry for [${name}], but 'rev' is undefined. Writing 'rev' as ${rev}`);
          await this.put({
            path: persistPath+`/rev`,
            data: rev!
          })
        }
      }).catch(async () => {
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
      this.#persistList[persistPath] = {lastRev, items: {}}
    }

    const r = await this.#ws.request(
      {
        method: "watch",
        headers: {
          authorization: `Bearer ${this.#token}`,
          ...headers,
        },
        path: request.path,
      },
      (resp) => {
        let parentRev: number | string;
        if (request.persist) {
          const bod = (resp?.change.find(c => c.path === ""))?.body
          if (typeof bod === 'object' && bod !== null && !Array.isArray(bod)) {
            parentRev = bod._rev;
            console.log({parentRev})
          }
        }
        if (request.type === "tree") {
          request.watchCallback(deepClone(resp.change))
        }
        let persistProms : Promise<void>[] = [];
        for (const [_i, change] of resp.change.entries()) {
          if (!request.type || request.type === "single") {
            persistProms.push(request.watchCallback(deepClone(change)))
          }
          if (change.path === "") {
            const watchRequest = this.#watchList.get(resp.requestId[0]!);
            if (watchRequest) {
              const newRev = change.body?.["_rev"];
              if (newRev) {
                watchRequest.rev = newRev;
                trace(
                  "Updated the rev of request %s to %s",
                  resp.requestId[0],
                  newRev
                );
              } else {
                throw new Error("The _rev field is missing.");
              }
            } else {
              throw new Error("The original watch request does not exist.");
            }
          }
        }

        if (request.persist) {
          Promise.allSettled(persistProms).then(() => {
          // Persist the new parent rev 
            const bod = (resp?.change.find(c => c.path === ""))?.body
            let rev;
            if (typeof bod === 'object' && bod !== null && !Array.isArray(bod)) {
              rev = bod._rev;
            }
      
            let persistPath;
            if (request.persist && request.persist.name) {
              persistPath = request.path+'/_meta/watchPersists/'+request.persist.name;
              if (typeof rev === 'number' && this.#persistList[persistPath] !== undefined) {
                this._persistWatch(persistPath, rev)
              }
            }
          })
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
    this.#watchList.set(requestId, request);

    return requestId;
  }

  public async unwatch(requestId: string): Promise<Response> {
    // Retrieve the original requestId if it had been renewed
    // TODO: better way to do this?
    let activeRequestId = requestId;
    for (const [
      currentRequestId,
      originalRequestId,
    ] of this.#renewedReqIdMap.entries()) {
      if (originalRequestId === requestId) {
        activeRequestId = currentRequestId;
      }
    }

    trace("Unwatch requestId=%s, actual=%s", requestId, activeRequestId);

    const response = await this.#ws.request({
      path: "",
      headers: {
        authorization: "",
      },
      method: "unwatch",
      requestId: activeRequestId,
    });
    // TODO: add timeout

    // Remove watch state info (this should always exist)
    if (!this.#watchList.delete(activeRequestId)) {
      throw new Error("Could not find watch state information.");
    }

    // Remove renewed requestId data
    // (this may not exist if requestId has not been renewed)
    this.#renewedReqIdMap.delete(activeRequestId);

    return response;
  }

  // GET resource recursively
  async #recursiveGet(
    path: string,
    subTree: OADATree | undefined,
    data: Body | undefined
  ): Promise<Body> {
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

    // TODO: should this error?
    if (Buffer.isBuffer(data)) {
      return data;
    }

    // select children to traverse
    const children: { treeKey: string; dataKey: string }[] = [];
    if (subTree["*"]) {
      // If "*" is specified in the tree provided by the user,
      // get all children from the server
      for (const key of Object.keys(data)) {
        if (typeof data[key as keyof typeof data] === "object") {
          children.push({ treeKey: "*", dataKey: key });
        }
      }
    } else {
      // Otherwise, get children from the tree provided by the user
      for (const key of Object.keys(subTree || {})) {
        if (typeof data[key as keyof typeof data] === "object") {
          children.push({ treeKey: key, dataKey: key });
        }
      }
    }

    // initiate recursive calls
    const promises = children.map(async (item) => {
      const childPath = path + "/" + item.dataKey;
      if (!data) {
        return;
      }
      const res = await this.#recursiveGet(
        childPath,
        subTree[item.treeKey],
        (data as JsonObject)[item.dataKey]
      );
      // @ts-ignore
      (data as JsonObject)[item.dataKey] = res;
      return;
    });

    await Promise.all(promises);
    return data; // return object at "path"
  }

  /**
   * Send PUT request
   * @param request PUT request
   */
  public async put(request: PUTRequest): Promise<Response> {
    // convert string path to array
    // (e.g., /bookmarks/abc/def -> ['bookmarks', 'abc', 'def'])
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
          request.tree as OADATree,
          partialPathArray
        ) as OADATree;
        if ("_type" in treeObj) {
          // it's a resource
          const contentType = treeObj["_type"]!;
          const partialPath = utils.toStringPath(partialPathArray);
          // check if resource already exists on the remote server
          const resourceCheckResult = await this.#resourceExists(partialPath);
          if (resourceCheckResult.exist) {
            // CASE 1: resource exists on server.
            // simply create a link using PUT request
            if (linkObj && newResourcePathArray.length > 0) {
              const linkPutResponse = await this.put({
                path: utils.toStringPath(newResourcePathArray),
                contentType,
                data: linkObj,
                // Ensure the resource has not been modified (opportunistic lock)
                revIfMatch: resourceCheckResult.rev,
              }).catch((msg) => {
                if (msg.status == 412) {
                  return msg;
                } else {
                  throw new Error(msg.statusText);
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
            // We hit a resource that already exists.
            // No need to further traverse the tree.
            break;
          } else {
            // CASE 2: resource does NOT exist on server.
            // create a new nested object containing a link
            const relativePathArray = newResourcePathArray.slice(i + 1);
            const newResource = linkObj
              ? utils.createNestedObject(linkObj, relativePathArray)
              : {};
            // create a new resource
            const resourceId: string = await this.#createResource(
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
      (Buffer.isBuffer(request.data) &&
        (await fromBuffer(request.data))?.mime) ||
      (request.data as JsonObject)?.["_type"] || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree as OADATree, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    // return PUT response
    return this.#ws.request(
      {
        method: "put",
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": contentType as string,
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
    // convert string path to array
    // (e.g., /bookmarks/abc/def -> ['bookmarks', 'abc', 'def'])
    const pathArray = utils.toArrayPath(request.path);

    const data = request.data;
    if (request.tree) {
      // We could go to all the trouble of re-implementing tree puts for posts,
      // but it's much easier to just make a ksuid and do the tree put
      const newkey = (await ksuid.random()).string;
      request.path += `/${newkey}`;
      return await this.put(request);
    }

    // Get content-type
    const contentType =
      request.contentType || // 1) get content-type from the argument
      (Buffer.isBuffer(request.data) &&
        (await fromBuffer(request.data))?.mime) ||
      (request.data as JsonObject)?.["_type"] || // 2) get content-type from the resource body
      (request.tree
        ? utils.getObjectAtPath(request.tree, pathArray)["_type"] // 3) get content-type from the tree
        : "application/json"); // 4) Assume application/json

    // return PUT response
    return this.#ws.request(
      {
        method: "post",
        headers: {
          authorization: `Bearer ${this.#token}`,
          "content-type": contentType as string,
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
    return this.#ws.request(
      {
        method: "head",
        headers: {
          authorization: `Bearer ${this.#token}`,
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
    return this.#ws.request(
      {
        method: "delete",
        headers: {
          authorization: `Bearer ${this.#token}`,
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
    return this.#ws.request(
      {
        method: "head",
        headers: {
          authorization: `Bearer ${this.#token}`,
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
    console.log(rev, this.#persistList[persistPath] !== undefined)
    if (this.#persistList[persistPath] !== undefined) {
      let {lastRev, items} = this.#persistList[persistPath]!;
      items[rev] = true;
      console.log('check 2', rev, lastRev, rev === lastRev+1)
      if (rev === lastRev+1) {
        console.log('items', rev, items[lastRev+1], items)
        while (items[lastRev+1]) {
          lastRev++;
          this.#persistList[persistPath]!.lastRev = lastRev;
          delete items[lastRev];
        }

        await this.put({
          path: persistPath+`/rev`,
          data: lastRev,
        })
        console.log({items, lastRev});
        info(`Persisted watch: path: [${persistPath}], rev: [${lastRev}]`);
      }
    }
    return;
  }


  /** Create a new resource. Returns resource ID */
  async #createResource(contentType: string, data: Json): Promise<string> {
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
  async #resourceExists(
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
