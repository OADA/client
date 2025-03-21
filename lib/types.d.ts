/**
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

declare module "isomorphic-timers-promises" {
  export * from "node:timers/promises";
}

declare module "resolve-alpn" {
  function resolve(options: {
    host: string;
    port?: number;
    readonly ALPNProtocols: string[];
    servername?: string;
    /** @default false */
    rejectUnauthorized?: boolean;
    /** @default false */
    resolveSocket?: boolean;
  }): Promise<{ alpnProtocol: string; timeout: boolean }>;
  export = resolve;
}

declare module "media-type" {
  export interface MediaType {
    type: string;
    subtype: string;
    suffix: string;
    hasSuffix(): boolean;
    asString(): string;
  }
  export function fromString(contentType: string): MediaType;
}
