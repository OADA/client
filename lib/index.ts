import { OADAClient, Config } from "./client";

/** Create a new instance of OADAClient */
export function createInstance(config: Config): OADAClient {
  return new OADAClient(config);
}

/** Create a new instance and wrap it with Promise */
export async function connect(config: Config): Promise<OADAClient> {
  // Create an instance of client and start connection
  const client = new OADAClient(config);
  // Wait for the connection to open
  await client.awaitConnection();
  // Return the instance
  return client;
}

export {
  OADAClient,
  Config,
  GETRequest,
  PUTRequest,
  HEADRequest,
  WatchRequest,
  // These are for developing an external connection (like google apps script):
  ConnectionRequest,
  ConnectionResponse,
  ConnectionChange,
  Connection
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
}
