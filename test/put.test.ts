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

import { generate as ksuid } from 'xksuid';

import type { Tree } from '@oada/types/oada/tree/v1.js';

import {
  type Nested,
  deleteLink,
  getResource,
  getTreeWithTestName,
  putResource,
  putResourceEnsureLink,
} from './utils.js';

// eslint-disable-next-line node/no-extraneous-import
import { type OADAClient, TimeoutError, connect } from '@oada/client';

interface Context {
  testName: string;
  testTree: Tree;
  client: Record<'ws' | 'http', OADAClient>;
}

const test = ava as TestFn<Context>;

test.beforeEach('Initialize test name', async (t) => {
  const uid = ksuid();
  const testName = `test-${uid}`;
  t.context.testName = testName;
  const testTree = getTreeWithTestName(testName);
  t.context.testTree = testTree;
  await putResourceEnsureLink({}, `/bookmarks/${testName}`);
});
test.afterEach('Clean up test', async (t) => {
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
      concurrency: 1,
    });
  });

  // Cleanup
  test.after.always(`${connection}: Destroy connection`, async (t) => {
    // Disconnect
    await t.context.client[connection]?.disconnect();
  });

  test(`${connection}: Shouldn't error when the Content-Type header can be derived from the _type key in the PUT body`, async (t) => {
    const { testName, client } = t.context;
    const response = await client[connection].put({
      path: `/bookmarks/${testName}/sometest`,
      data: { _type: 'application/json' },
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test(`${connection}: Shouldn't error when the Content-Type header can be derived from the contentType key`, async (t) => {
    const { testName, client } = t.context;
    const response = await client[connection].put({
      path: `/bookmarks/${testName}/somethingnew`,
      data: `"abc123"`,
      contentType: 'application/json',
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test(`${connection}: Shouldn't error when 'Content-Type' header (_type) can be derived from the 'tree'`, async (t) => {
    const { testName, testTree, client } = t.context;
    const response = await client[connection].put({
      path: `/bookmarks/${testName}/aaa/bbb/index-one/sometest`,
      tree: testTree,
      data: `"abc123"`,
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test(`${connection}: Shouldn't error when the 'X-OADA-Ensure-Link' header is a supported value`, async (t) => {
    const { testName } = t.context;
    const response = await putResource(
      { _type: 'application/json' },
      `/bookmarks/${testName}/sometest`,
      { 'X-OADA-Ensure-Link': 'versioned' },
    );
    t.is(response.status, 201);
    t.assert(response.headers.get('content-location'));
    t.assert(response.headers.get('x-oada-rev'));
  });

  // TODO: Check the rejection reason
  test.skip(`${connection}: Should error when _type cannot be derived from the above tested sources`, async (t) => {
    const { testName, client } = t.context;
    await t.throwsAsync(
      client[connection].put({
        path: `/bookmarks/${testName}/sometest`,
        data: `"abc123"`,
      }),
    );
  });

  test(`${connection}: Should error when using a contentType parameter for which your token does not have access to read/write`, async (t) => {
    const { testName, client } = t.context;
    await t.throwsAsync(
      client[connection].put({
        path: `/bookmarks/${testName}/sometest2`,
        data: { anothertest: 123 },
        contentType: 'application/vnd.oada.foobar.1+json',
      }),
      {
        code: '403',
        message: 'Token does not have required scope',
      },
    );
  });

  test(`${connection}: Should error when timeout occurs during a PUT request`, async (t) => {
    const { testName, client } = t.context;
    await t.throwsAsync(
      client[connection].put({
        path: `/bookmarks/${testName}/sometest3`,
        data: { anothertest: 123 },
        contentType: 'application/json',
        timeout: 1,
      }),
      {
        name: TimeoutError.name,
        code: TimeoutError.prototype.code,
      },
    );
  });

  test(`${connection}: Should error when 'X-OADA-Ensure-Link' contains an unsupported value`, async (t) => {
    const { testName } = t.context;
    await t.throwsAsync(
      putResource({ somedata: 456 }, `/bookmarks/${testName}/sometest4`, {
        'X-OADA-Ensure-Link': 'unsupportedValue',
      }),
      {
        code: '400',
        // Message: 'Unsupported value for X-OADA-Ensure-Link',
      },
    );
  });

  test(`${connection}: Should create the proper resource breaks on the server when a tree parameter is supplied to a deep endpoint`, async (t) => {
    const { testName, testTree, client } = t.context;
    const putResp = await client[connection].put({
      path: `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`,
      tree: testTree,
      data: { test: 'some test' },
    });
    t.is(putResp.status, 201);
    t.assert(putResp.headers['content-location']);
    t.assert(putResp.headers['x-oada-rev']);

    // Path: aaa
    const response1 = await getResource(`/bookmarks/${testName}/aaa`);
    t.is(response1.status, 200);
    t.assert(response1.headers.get('content-location'));
    t.assert(response1.headers.get('x-oada-rev'));
    const data1 = (await response1.json()) as Nested;
    t.assert(data1?._id);
    t.assert(data1?._rev);
    t.assert(data1?.bbb?._id);
    t.assert(data1?.bbb?._rev);
    t.falsy(data1?.bbb?.['index-one']);

    // Path: aaa/bbb
    const response2 = await getResource(`/bookmarks/${testName}/aaa/bbb`);
    t.is(response2.status, 200);
    t.assert(response2.headers.get('content-location'));
    t.assert(response2.headers.get('x-oada-rev'));
    const data2 = (await response2.json()) as Nested;
    t.assert(data2?._id);
    t.assert(data2?._rev);
    t.falsy(data2?.['index-one']?._id);
    t.falsy(data2?.['index-one']?._rev);
    t.assert(data2?.['index-one']?.ccc);

    // Path: aaa/bbb/index-one
    const response3 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one`,
    );
    t.is(response3.status, 200);
    t.assert(response3.headers.get('content-location'));
    t.assert(response3.headers.get('x-oada-rev'));
    const data3 = (await response3.json()) as Nested;
    t.falsy(data3?._id);
    t.falsy(data3?._rev);
    t.assert(data3?.ccc?._id);
    t.assert(data3?.ccc?._rev);

    // Path: aaa/bbb/index-one/ccc
    const response4 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc`,
    );
    t.is(response4.status, 200);
    t.assert(response4.headers.get('content-location'));
    t.assert(response4.headers.get('x-oada-rev'));
    const data4 = (await response4.json()) as Nested;
    t.assert(data4?._id);
    t.assert(data4?._rev);
    t.assert(data4?._type);
    t.falsy(data4?.['index-two']?._id);
    t.falsy(data4?.['index-two']?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two
    const response5 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two`,
    );
    t.is(response5.status, 200);
    t.assert(response5.headers.get('content-location'));
    t.assert(response5.headers.get('x-oada-rev'));
    const data5 = (await response5.json()) as Nested;
    t.falsy(data5?._id);
    t.falsy(data5?._rev);
    t.assert(data5?.ddd?._id);
    t.assert(data5?.ddd?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd
    const response6 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd`,
    );
    t.is(response6.status, 200);
    t.assert(response6.headers.get('content-location'));
    t.assert(response6.headers.get('x-oada-rev'));
    const data6 = (await response6.json()) as Nested;
    t.assert(data6?._id);
    t.assert(data6?._type);
    t.assert(data6?._rev);
    t.falsy(data6?.['index-three']?._id);
    t.falsy(data6?.['index-three']?._rev);
    t.assert(data6?.['index-three']?.eee);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three
    const response7 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three`,
    );
    t.is(response7.status, 200);
    t.assert(response7.headers.get('content-location'));
    t.assert(response7.headers.get('x-oada-rev'));
    const data7 = (await response7.json()) as Nested;
    t.falsy(data7?._id);
    t.falsy(data7?._rev);
    t.assert(data7?.eee?._id);
    t.falsy(data7?.eee?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee
    const response8 = await getResource(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`,
    );
    t.is(response8.status, 200);
    t.assert(response8.headers.get('content-location'));
    t.assert(response8.headers.get('x-oada-rev'));
    const data8 = (await response8.json()) as Nested;
    t.assert(data8?._id);
    t.assert(data8?._rev);
    t.assert(data8?.test);
    t.falsy(data8?.test?._id);
    t.falsy(data8?.test?._rev);
  });

  test(`${connection}: Should create the proper trees from simultaneous PUT requests`, async (t) => {
    const { testName, testTree, client } = t.context;
    // Adjust timeout because concurrent PUTs usually result in if-match errors and
    // the client tries to resolve the conflicts using the exponential backoff algorithm
    // t.timeout(10_000);
    // Do concurrent PUTs
    const paths = ['a', 'b', 'c'];
    const promises = paths.map(async (v) =>
      client[connection].put({
        path: `/bookmarks/${testName}/concurrent-put/${v}`,
        tree: testTree,
        data: { foo: 'bar' },
      }),
    );
    await Promise.all(promises);

    // Check
    for await (const v of paths) {
      const response = await getResource(
        `/bookmarks/${testName}/concurrent-put/${v}`,
      );
      const data = (await response.json()) as Nested;
      t.is(response.status, 200);
      t.assert(response.headers.get('content-location'));
      t.assert(response.headers.get('x-oada-rev'));
      t.assert(data?._id);
      t.assert(data?._rev);
      t.assert(data?.foo);
    }
  });
}
