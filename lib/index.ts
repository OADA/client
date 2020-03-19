import { OADAClient } from "./client";

/** Create a new instance of OADAClient */
export function createInstance(): OADAClient {
  return new OADAClient();
}

/** Create a new instance and wrap it with Promise */
export function connect(): Promise<OADAClient> {
  return Promise.resolve(createInstance());
}

export {OADAClient, GETRequest, WatchRequest} from "./client"
