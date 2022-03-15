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

import test from 'ava';

import { EventEmitter, once } from 'node:events';

import ksuid from 'ksuid';

import { Change, OADAClient, connect } from '../dist/index.js';
import {
  Nested,
  deleteLinkAxios,
  getAxios,
  putAxios,
  putResourceAxios,
} from './utils';

interface Context {
  testName: string;
}

test.beforeEach('Initialize test name', async (t) => {
  const { string: uid } = await ksuid.random();
  const testName = `test-${uid}`;
  // @ts-expect-error ava context typing is lame
  t.context.testName = testName;
  await putResourceAxios({}, `/bookmarks/${testName}`);
});
test.afterEach('Clean up test', async (t) => {
  const { testName } = t.context as Context;
  // This does not delete resources... oh well.
  await deleteLinkAxios(`/bookmarks/${testName}`);
});

for (const connection of <const>['ws', 'http']) {
  // Client instance
  let client: OADAClient;

  // Initialization
  test.before(`${connection}: Initialize connection`, async () => {
    // Connect
    client = await connect({
      domain,
      token,
      connection,
    });
  });

  // Cleanup
  test.after(`${connection}: Destroy connection`, async () => {
    // Disconnect
    await client?.disconnect();
  });

  test(`${connection}: Should deprecate v2 API`, async (t) => {
    const { testName } = t.context as Context;
    const emitter = new EventEmitter();
    await putResourceAxios({}, `/bookmarks/${testName}/test1`);
    // 1) Get current rev
    const axiosResp = await getAxios(`/bookmarks/${testName}/test1`);
    // 2) Set up watch
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const watch = await client.watch({
      type: 'single',
      path: `/bookmarks/${testName}/test1`,
      async watchCallback(change: Readonly<Change>) {
        try {
          const { data } = axiosResp as { data: Nested };
          // Check
          t.assert(data?._rev);
          const nextRev = Number(axiosResp.data._rev) + 1;
          t.like(change.body, { _rev: nextRev });
          // @ts-expect-error stuff
          t.assert(change.body?.testData1?.abc);

          await client.unwatch(watch);
          emitter.emit('done');
        } catch (error: unknown) {
          emitter.emit('error', error);
        }
      },
    });
    // 3) Make changes
    await putAxios({ abc: 'def' }, `/bookmarks/${testName}/test1/testData1`);
    await once(emitter, 'done');
  });

  test(`${connection}: Should receive the watch change from a single PUT request`, async (t) => {
    const { testName } = t.context as Context;
    await putResourceAxios({}, `/bookmarks/${testName}/test1`);
    // 1) Get current rev
    const axiosResp = await getAxios(`/bookmarks/${testName}/test1`);
    // 2) Set up watch
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes } = await client.watch({
      path: `/bookmarks/${testName}/test1`,
    });
    // 3) Make changes
    await putAxios({ abc: 'def' }, `/bookmarks/${testName}/test1/testData1`);

    // Check
    const { data } = axiosResp as { data: Nested };
    t.assert(data?._rev);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      t.log(change);
      const nextRev = Number(axiosResp.data._rev) + 1;
      t.like(change.body, { _rev: nextRev });
      // @ts-expect-error stuff
      t.assert(change.body?.testData1?.abc);

      break;
    }
  });

  test(`${connection}: Should receive the response to an initial GET request`, async (t) => {
    const { testName } = t.context as Context;
    await putResourceAxios({ a: 1, b: 2 }, `/bookmarks/${testName}/test1`);

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes, data, status } = await client.watch({
      initialMethod: 'get',
      path: `/bookmarks/${testName}/test1`,
    });

    t.is(typeof status, 'number');
    t.assert(changes[Symbol.asyncIterator]);
    t.is(typeof data, 'object');
  });

  test(`${connection}: Should not receive the watch change after unwatch request`, async (t) => {
    const { testName } = t.context as Context;
    await putResourceAxios({}, `/bookmarks/${testName}/test2`);
    // 1) Get current rev
    await getAxios(`/bookmarks/${testName}/test2`);
    // 2) Set up watch
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes } = await client.watch({
      path: `/bookmarks/${testName}/test2`,
    });
    // 3) Unwatch
    await changes.return?.();
    // 4) Make changes
    await putAxios({ abc: 'def' }, `/bookmarks/${testName}/test2/testData`);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      throw new Error(`Received change: ${JSON.stringify(change)}`);
    }

    t.pass();
  });

  test.skip(`${connection}: Should receive the watch change from a single deep PUT request`, async (t) => {
    const { testName } = t.context as Context;
    await putResourceAxios({}, `/bookmarks/${testName}/test3`);
    await putResourceAxios({}, `/bookmarks/${testName}/test3/level1`);
    await putResourceAxios({}, `/bookmarks/${testName}/test3/level1/level2`);
    // 1) Get current rev
    const axiosResp = await getAxios(`/bookmarks/${testName}/test3`);
    // 2) Set up watch
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes } = await client.watch({
      path: `/bookmarks/${testName}/test3`,
    });
    // 3) Make changes
    await putAxios(
      { abc: 'def' },
      `/bookmarks/${testName}/test3/level1/level2/testData`
    );

    // Check
    t.assert(axiosResp.data?._rev);
    // eslint-disable-next-line no-unreachable-loop
    for await (const change of changes) {
      const nextRev = Number(axiosResp.data._rev) + 1;
      t.like(change.body, { _rev: nextRev });
      // @ts-expect-error stuff
      t.assert(change.body?.testData1?.abc);

      break;
    }
  });
}
