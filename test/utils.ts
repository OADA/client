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

import { domain, token } from "./config.js";

import { generate as ksuid } from "xksuid";

import type Tree from "@oada/types/oada/tree/v1.js";
import { Agent, type HeadersInit, fetch, setGlobalDispatcher } from "undici";
import { handleErrors } from "../dist/errors.js";

export type Nested =
  | {
      [k: string]: Nested;
    }
  | undefined;

setGlobalDispatcher(
  new Agent({
    connect: {
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    },
  }),
);

async function _request(
  uri: string | URL,
  {
    headers = {},
    body,
    ...rest
  }: Omit<RequestInit, "body"> & {
    // eslint-disable-next-line @typescript-eslint/ban-types
    body?: Record<string, unknown> | null;
  } = {},
) {
  const url = new URL(uri, domain);
  const response = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : undefined),
      ...headers,
    },
    body: typeof body === "object" ? JSON.stringify(body) : body,
  });

  if (!response.ok) {
    throw Object.assign(new Error(response.statusText), {
      response,
      code: `${response.status}`,
    });
  }

  return response;
}

export const request = (async (...rest) =>
  handleErrors(_request, ...rest)) satisfies typeof _request;

export async function getResource(uri: string | URL, headers?: HeadersInit) {
  return request(uri, {
    method: "get",
    headers,
  });
}

export async function putResource(
  body: Record<string, unknown>,
  uri: string | URL,
  headers?: HeadersInit,
) {
  return request(uri, {
    method: "put",
    headers,
    body,
  });
}

export async function putResourceEnsureLink(
  body: Record<string, unknown>,
  uri: string | URL,
) {
  const _id = `resources/${ksuid()}`;
  const resource = await request(`/${_id}`, {
    method: "put",
    body,
  });
  const link = await request(uri, {
    method: "put",
    body: { _id, _rev: 0 },
  });

  return { resource, link, resource_id: _id };
}

export async function deleteLink(uri: string | URL) {
  const link = await request(uri, {
    method: "delete",
    headers: {
      "Content-Type": "application/json",
    },
    // eslint-disable-next-line unicorn/no-null
    body: null,
  });

  return { link };
}

export function getTreeWithTestName(testName: string): Tree {
  return {
    bookmarks: {
      _type: "application/json",
      _rev: 0,
      [testName]: {
        _type: "application/json",
        _rev: 0,
        aaa: {
          _type: "application/json",
          _rev: 0,
          bbb: {
            _type: "application/json",
            _rev: 0,
            "index-one": {
              "*": {
                _type: "application/json",
                _rev: 0,
                "index-two": {
                  "*": {
                    _type: "application/json",
                    _rev: 0,
                    "index-three": {
                      "*": {
                        _type: "application/json",
                        test: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "concurrent-put": {
          _type: "application/json",
          _rev: 0,
          "*": {
            _type: "application/json",
            _rev: 0,
          },
        },
      },
    },
  } as unknown as Tree;
}
