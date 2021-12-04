/**
 * @license
 * Copyright 2021 Open Ag Data Alliance
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Config, OADAClient } from './client';

/** Create a new instance of OADAClient */
export function createInstance(config: Config): OADAClient {
  return new OADAClient(config);
}

/** @deprecated ws is deprecated, use http */
export async function connect(
  config: Config & { connection: 'ws' }
): Promise<OADAClient>;
/** Create a new instance and wrap it with Promise */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export async function connect(config: Config): Promise<OADAClient>;
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
  Connection,
} from './client';

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = Json[];
export type JsonObject = { [property in string]?: Json };
export type Json = JsonPrimitive | JsonObject | JsonArray;

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
  type: 'merge' | 'delete';
  body: JsonObject & { _rev: number | string };
  path: string;
  resource_id: string;
}
