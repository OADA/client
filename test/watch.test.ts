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

import { domain, token } from './config.js';

import ava, { type TestFn } from 'ava';

import { EventEmitter, once } from 'node:events';

import { generate as ksuid } from 'xksuid';

// eslint-disable-next-line node/no-extraneous-import
import { type Change, type OADAClient, connect } from '@oada/client';
import {
  type Nested,
  deleteLink,
  getResource,
  putResource,
  putResourceEnsureLink,
} from './utils.js';

interface Context {
  testName: string;
  client: Record<'ws' | 'http', OADAClient>;
}

const test = ava as TestFn<Context>;

test.beforeEach('Initialize test name', async (t) => {
  const uid = ksuid();
  const testName = `test-${uid}`;
  t.context.testName = testName;
  await putResourceEnsureLink({}, `/bookmarks/${testName}`);
});
test.afterEach.always('Clean up test', async (t) => {
  const { testName } = t.context;
  // This does not delete resources... oh well.
  await deleteLink(`/bookmarks/${testName}`);
});

for (const connection of ['ws', 'http'] as const) {
  // Initialization
  test.before(`${connection}: Initialize connection`, async (t) => {
    // @ts-expect-error stuff
    t.context.client ??= {};
    // Connect
    t.context.client[connection] = await connect({
      domain,
      token,
      connection,
    });
  });

  // Cleanup
  test.after.always(`${connection}: Destroy connection`, async (t) => {
    // Disconnect
    await t.context.client[connection]?.disconnect();
  });

  test(`${connection}: Should deprecate v2 API`, async (t) => {
    const { testName } = t.context;
    // eslint-disable-next-line unicorn/prefer-event-target
    const emitter = new EventEmitter();
    await putResourceEnsureLink({}, `/bookmarks/${testName}/test1`);
    // 1) Get current rev
    const getResp = await getResource(`/bookmarks/${testName}/test1`);
    // 2) Set up watch
    const watch = await t.context.client[connection].watch({
      type: 'single',
      path: `/bookmarks/${testName}/test1`,
      async watchCallback(change: Readonly<Change>) {
        try {
          const data = (await getResp.json()) as Nested;
          // Check
          t.assert(data?._rev);
          const nextRev = Number(data?._rev) + 1;
          t.like(change.body, { _rev: nextRev });
          // @ts-expect-error stuff
          t.assert(change.body?.testData1?.abc);

          await t.context.client[connection].unwatch(watch);
          emitter.emit('done');
        } catch (error: unknown) {
          emitter.emit('error', error);
        }
      },
    });
    // 3) Make changes
    await putResource({ abc: 'def' }, `/bookmarks/${testName}/test1/testData1`);
    await once(emitter, 'done');
  });

  test(`${connection}: Should receive the watch change from a single PUT request`, async (t) => {
    const { testName } = t.context;
    await putResourceEnsureLink({}, `/bookmarks/${testName}/test1`);
    // 1) Get current rev
    const getResp = await getResource(`/bookmarks/${testName}/test1`);
    // 2) Set up watch
    const { changes } = await t.context.client[connection].watch({
      path: `/bookmarks/${testName}/test1`,
    });
    // 3) Make changes
    await putResource({ abc: 'def' }, `/bookmarks/${testName}/test1/testData1`);

    // Check
    const data = (await getResp.json()) as Nested;
    t.assert(data?._rev);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      t.log(change);
      const nextRev = Number(data?._rev) + 1;
      t.like(change.body, { _rev: nextRev });
      // @ts-expect-error stuff
      t.assert(change.body?.testData1?.abc);

      break;
    }
  });

  test(`${connection}: Should receive the response to an initial GET request`, async (t) => {
    const { testName } = t.context;
    await putResourceEnsureLink({ a: 1, b: 2 }, `/bookmarks/${testName}/test1`);

    const { changes, data, status } = await t.context.client[connection].watch({
      initialMethod: 'get',
      path: `/bookmarks/${testName}/test1`,
    });

    t.is(typeof status, 'number');
    t.assert(changes[Symbol.asyncIterator]);
    t.is(typeof data, 'object');
  });

  test(`${connection}: Should not receive the watch change after unwatch request`, async (t) => {
    const { testName } = t.context;
    await putResourceEnsureLink({}, `/bookmarks/${testName}/test2`);
    // 1) Get current rev
    await getResource(`/bookmarks/${testName}/test2`);
    // 2) Set up watch

    const { changes } = await t.context.client[connection].watch({
      path: `/bookmarks/${testName}/test2`,
    });
    // 3) Unwatch
    await changes.return?.();
    // 4) Make changes
    await putResource({ abc: 'def' }, `/bookmarks/${testName}/test2/testData`);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      throw new Error(`Received change: ${JSON.stringify(change)}`);
    }

    t.pass();
  });

  test.skip(`${connection}: Should receive the watch change from a single deep PUT request`, async (t) => {
    const { testName } = t.context;
    await putResourceEnsureLink({}, `/bookmarks/${testName}/test3`);
    await putResourceEnsureLink({}, `/bookmarks/${testName}/test3/level1`);
    await putResourceEnsureLink(
      {},
      `/bookmarks/${testName}/test3/level1/level2`,
    );
    // 1) Get current rev
    const getResp = await getResource(`/bookmarks/${testName}/test3`);
    // 2) Set up watch
    const { changes } = await t.context.client[connection].watch({
      path: `/bookmarks/${testName}/test3`,
    });
    // 3) Make changes
    await putResource(
      { abc: 'def' },
      `/bookmarks/${testName}/test3/level1/level2/testData`,
    );

    // Check
    const data = (await getResp.json()) as Nested;
    t.assert(data?._rev);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      const nextRev = Number(data?._rev) + 1;
      t.like(change.body, { _rev: nextRev });
      // @ts-expect-error sadsadds
      t.assert(change.body?.testData1?.abc);

      break;
    }
  });
}
