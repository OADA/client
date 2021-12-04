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

import type { OADATree } from './client';

export function toStringPath(path: string[]): string {
  return `/${path.join('/')}`;
}

export function toArrayPath(path: string): string[] {
  const arrayPath = path.split('/');
  if (arrayPath.length > 0 && arrayPath[0] === '') {
    arrayPath.shift();
  }

  if (arrayPath.length > 0 && arrayPath[arrayPath.length - 1] === '') {
    arrayPath.pop();
  }

  return arrayPath;
}

export function getObjectAtPath(tree: OADATree, path: string[]): OADATree {
  let result = tree;
  for (const key of path) {
    if (key in result) {
      result = result[key]!;
    } else if ('*' in result) {
      result = result['*']!;
    } else {
      throw new Error(
        `Specified path /${path.join('/')} does not exist in the tree.`
      );
    }
  }

  return result;
}

export function toTreePath(tree: OADATree, path: string[]): string[] {
  const treePath: string[] = [];

  let current = tree;
  for (const key of path) {
    if (key in current) {
      treePath.push(key);
      current = current[key]!;
    } else if ('*' in current) {
      treePath.push('*');
      current = current['*']!;
    } else {
      throw new Error(
        `Specified path /${path.join('/')} does not exist in the tree.`
      );
    }
  }

  return treePath;
}

export function isResource(tree: OADATree, path: string[]): boolean {
  const object = getObjectAtPath(tree, path);
  if ('_id' in object) {
    return true;
  }

  return false;
}

export function createNestedObject(
  object: Record<string, unknown>,
  nestPath: string[]
): Record<string, unknown> {
  const reversedArray = nestPath.slice().reverse();

  let result = object;
  for (const key of reversedArray) {
    result = { [key]: result };
  }

  return result;
}
