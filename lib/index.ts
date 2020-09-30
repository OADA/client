import { OADAClient, Config } from "./client";

/** Create a new instance of OADAClient */
export function createInstance(config: Config): OADAClient {
  return new OADAClient(config);
}

/** Create a new instance and wrap it with Promise */
export async function connect(config: Config): Promise<OADAClient> {
  return new OADAClient(config);
}

export {
  OADAClient,
  Config,
  GETRequest,
  PUTRequest,
  HEADRequest,
  WatchRequest,
} from "./client";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [prop: string]: Json };

export type JsonCompatible<T> = {
  [P in keyof T]: T[P] extends Json
    ? T[P]
    : Pick<T, P> extends Required<Pick<T, P>>
    ? never
    : T[P] extends (() => unknown) | undefined
    ? never
    : JsonCompatible<T[P]>;
};

export interface Change {
  type: "merge" | "delete";
  body: Json;
  path: string;
  resource_id: string;
  watchPath?: string;
}
