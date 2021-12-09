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

import type { on as onT, once as onceT } from 'node:events';

import { subscribe } from 'event-iterator/lib/dom';

export async function* on(...[target, event, options]: Parameters<typeof onT>) {
  yield* subscribe.call(target as unknown as EventTarget, event, options);
}

export async function* once(...[target, event]: Parameters<typeof onceT>) {
  // TODO: Do I need to make `it` return?
  const it = subscribe.call(target as unknown as EventTarget, event);
  // eslint-disable-next-line no-unreachable-loop
  for await (const value of it) {
    yield value;
    return;
  }
}
