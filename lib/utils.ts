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

/**
 * @packageDocumentation
 * Some useful functions
 */

import { JsonPointer } from "json-ptr";
import objectAssignDeep from "object-assign-deep";
import { TimeoutError as PTimeoutError } from "p-timeout";

import type { Tree, TreeKey } from "@oada/types/oada/tree/v1.js";

import type { Change, Json, JsonObject } from "./index.js";

// Typescript sucks at figuring out Array.isArray on its own
function isArray<A extends unknown[] | readonly unknown[]>(
  value: unknown,
): value is A {
  return Array.isArray(value);
}

export function toArray<E extends unknown[] | readonly unknown[]>(
  itemOrArray: E | E[0],
): E {
  return isArray<E>(itemOrArray) ? itemOrArray : ([itemOrArray] as E);
}

export function toStringPath(path: readonly string[]): string {
  return `/${path.join("/")}`;
}

export function toArrayPath(path: string): string[] {
  const arrayPath = path.split("/");
  if (arrayPath.length > 0 && arrayPath[0] === "") {
    arrayPath.shift();
  }

  if (arrayPath.length > 0 && arrayPath.at(-1) === "") {
    arrayPath.pop();
  }

  return arrayPath;
}

export function getObjectAtPath(tree: Tree, path: readonly string[]): Tree {
  let result = tree;
  for (const key of path) {
    if (key in result) {
      result = result[key as TreeKey]!;
    } else if ("*" in result) {
      result = result["*"]!;
    } else {
      throw new Error(
        `Specified path /${path.join("/")} does not exist in the tree.`,
      );
    }
  }

  return result;
}

export function toTreePath(tree: Tree, path: string[]): string[] {
  const treePath: string[] = [];

  let current = tree;
  for (const key of path) {
    if (key in current) {
      treePath.push(key);
      current = current[key as TreeKey]!;
    } else if ("*" in current) {
      treePath.push("*");
      current = current["*"]!;
    } else {
      throw new Error(
        `Specified path /${path.join("/")} does not exist in the tree.`,
      );
    }
  }

  return treePath;
}

export function isResource(tree: Tree, path: string[]): boolean {
  const object = getObjectAtPath(tree, path);
  return "_id" in object;
}

export function createNestedObject(
  object: Record<string, unknown>,
  nestPath: string[],
): Record<string, unknown> {
  const reversedArray = nestPath.slice().reverse();

  let result = object;
  for (const key of reversedArray) {
    result = { [key]: result };
  }

  return result;
}

/**
 * Use an Error class for timed out requests
 */
export class TimeoutError extends PTimeoutError {
  public get code() {
    return "REQUEST_TIMEDOUT" as const;
  }

  public override readonly name = "TimeoutError" as const;

  constructor(request: unknown) {
    super("Request timed out");
    Object.assign(this, request);
  }
}

/**
 * Ensure we throw real `Error`s
 */
export async function fixError<
  E extends {
    message?: string;
    code?: string;
    status?: string | number;
    statusCode?: string | number;
    statusText?: string;
  },
>(error: E): Promise<E & Error> {
  // Try to normalize the various ways of sending the error codes
  const code = `${error.code ?? error.status ?? error.statusCode}`;
  error.code ??= code;
  error.status ??= Number(code);
  error.statusCode ??= Number(code);

  if (error instanceof Error) {
    return error;
  }

  // TODO: Clean up this mess
  let body: { message?: string } = {};
  try {
    // @ts-expect-error try to get error body?
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    body = (await error.json?.()) ?? error.data;
  } catch {}

  const message =
    error.message ??
    body?.message ??
    (error.statusText
      ? `${error.status} ${error.statusText}`
      : `${error.status}`);
  const ret = new Error(message, { cause: error }) as E & Error;
  ret.code = code;
  for (const key in error) {
    // @ts-expect-error HACK: just do it
    ret[key] = error[key];
  }

  return ret;
}

export const changeSym = Symbol("change");
/**
 * @internal
 */
export type ChangeBody<T> = T & {
  [changeSym]?: Array<Readonly<Change>>;
};

/**
 * Tell TS we should never reach here (i.e., this should never be called)
 * @internal
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Bad value: ${value}`);
}

/**
 * Replace `null` values in delete changes with `undefined`
 * @internal
 */
export function translateDelete(body: Json): Json | undefined {
  if (body === null) {
    return undefined;
  }

  if (typeof body !== "object") {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map((item) => translateDelete(item) as Json);
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      translateDelete(value!) as Json,
    ]),
  );
}

/**
 * Construct object representing the change tree
 * @internal
 */
export function buildChangeObject(rootChange: Change, ...children: Change[]) {
  const changeBody: ChangeBody<unknown> = {
    [changeSym]: [rootChange],
    ...(rootChange.type === "delete"
      ? (translateDelete(rootChange.body as Json) as JsonObject)
      : rootChange.body),
  };
  for (const change of children) {
    const ptr = JsonPointer.create(change.path);
    const old = ptr.get(changeBody) as ChangeBody<unknown>;

    const changes = old?.[changeSym] ?? [];
    const body =
      change.type === "delete"
        ? translateDelete(change.body as Json)
        : change.body;
    const merged = objectAssignDeep(old ?? {}, body);

    merged[changeSym] = [...changes, change];
    ptr.set(changeBody, merged, true);
  }

  return changeBody;
}

/**
 * @internal
 */
export interface Result<T, P = unknown> {
  value: T;
  path: string;
  pointer: string;
  parent: P;
  parentProperty: string;
}
