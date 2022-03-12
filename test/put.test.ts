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

/* eslint-disable sonarjs/no-duplicate-string */

import { domain, token } from './config.js';

import test from 'ava';

import ksuid from 'ksuid';

// eslint-disable-next-line import/no-namespace
import * as oada from '../dist/index.js';
import {
  Nested,
  deleteLinkAxios,
  getAxios,
  getTreeWithTestName,
  putResourceAxios,
} from './utils';

interface Context {
  testName: string;
  testTree: Record<string, unknown>;
}

for (const connection of <const>['ws', 'http']) {
  // Client instance
  let client: oada.OADAClient;

  // Initialization
  test.before(`${connection}: Initialize connection`, async () => {
    // Connect
    client = await oada.connect({
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

  test.beforeEach(`${connection}: Initialize test name`, async (t) => {
    const { string: uid } = await ksuid.random();
    const testName = `test-${uid}`;
    // @ts-expect-error ava context typing is lame
    t.context.testName = testName;
    const testTree = getTreeWithTestName(testName);
    // @ts-expect-error ava context typing is lame
    t.context.testTree = testTree;
    await putResourceAxios({}, `/bookmarks/${testName}`);
  });
  test.afterEach(`${connection}: Clean up test`, async (t) => {
    const { testName } = t.context as Context;
    // This does not delete resources... oh well.
    await deleteLinkAxios(`/bookmarks/${testName}`);
  });

  test(`${connection}: Shouldn't error when the Content-Type header can be derived from the _type key in the PUT body`, async (t) => {
    const { testName } = t.context as Context;
    const response = await client.put({
      path: `/bookmarks/${testName}/sometest`,
      data: { _type: 'application/json' },
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test(`${connection}: Shouldn't error when the Content-Type header can be derived from the contentType key`, async (t) => {
    // @ts-expect-error ava context typing is lame
    const { testName } = t.context;
    const response = await client.put({
      path: `/bookmarks/${testName}/somethingnew`,
      data: `"abc123"`,
      contentType: 'application/json',
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test(`${connection}: Shouldn't error when 'Content-Type' header (_type) can be derived from the 'tree'`, async (t) => {
    const { testName, testTree } = t.context as Context;
    const response = await client.put({
      path: `/bookmarks/${testName}/aaa/bbb/index-one/sometest`,
      tree: testTree,
      data: `"abc123"`,
    });
    t.is(response.status, 201);
    t.assert(response.headers['content-location']);
    t.assert(response.headers['x-oada-rev']);
  });

  test.skip(`${connection}: Should error when _type cannot be derived from the above tested sources`, async (t) => {
    const { testName } = t.context as Context;
    await t.throwsAsync(
      client.put({
        path: `/bookmarks/${testName}/sometest`,
        data: `"abc123"`,
      })
    );
  });
  // TODO: Check the rejection reason

  test(`${connection}: Should error when using a contentType parameter for which your token does not have access to read/write`, async (t) => {
    const { testName } = t.context as Context;
    await t.throwsAsync(
      client.put({
        path: `/bookmarks/${testName}/sometest2`,
        data: { anothertest: 123 },
        contentType: 'application/vnd.oada.foobar.1+json',
      })
    );
  });
  // TODO: Check the rejection reason

  test(`${connection}: Should error when timeout occurs during a PUT request`, async (t) => {
    const { testName } = t.context as Context;
    await t.throwsAsync(
      client.put({
        path: `/bookmarks/${testName}/sometest3`,
        data: { anothertest: 123 },
        contentType: 'application/json',
        timeout: 1,
      })
    );
  });
  // TODO: Check the rejection reason

  test(`${connection}: Should create the proper resource breaks on the server when a tree parameter is supplied to a deep endpoint`, async (t) => {
    const { testName, testTree } = t.context as Context;
    const putResp = await client.put({
      path: `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`,
      tree: testTree,
      data: { test: 'some test' },
    });
    t.is(putResp.status, 201);
    t.assert(putResp.headers['content-location']);
    t.assert(putResp.headers['x-oada-rev']);

    // Path: aaa
    const response1 = await getAxios(`/bookmarks/${testName}/aaa`);
    t.is(response1.status, 200);
    t.assert(response1.headers['content-location']);
    t.assert(response1.headers['x-oada-rev']);
    const { data: data1 } = response1 as { data: Nested };
    t.assert(data1?._id);
    t.assert(data1?._rev);
    t.assert(data1?.bbb?._id);
    t.assert(data1?.bbb?._rev);
    t.falsy(data1?.bbb?.['index-one']);

    // Path: aaa/bbb
    const response2 = await getAxios(`/bookmarks/${testName}/aaa/bbb`);
    t.is(response2.status, 200);
    t.assert(response2.headers['content-location']);
    t.assert(response2.headers['x-oada-rev']);
    const { data: data2 } = response2 as { data: Nested };
    t.assert(data2?._id);
    t.assert(data2?._rev);
    t.falsy(data2?.['index-one']?._id);
    t.falsy(data2?.['index-one']?._rev);
    t.assert(data2?.['index-one']?.ccc);

    // Path: aaa/bbb/index-one
    const response3 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one`
    );
    t.is(response3.status, 200);
    t.assert(response3.headers['content-location']);
    t.assert(response3.headers['x-oada-rev']);
    const { data: data3 } = response3 as { data: Nested };
    t.falsy(data3?._id);
    t.falsy(data3?._rev);
    t.assert(data3?.ccc?._id);
    t.assert(data3?.ccc?._rev);

    // Path: aaa/bbb/index-one/ccc
    const response4 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc`
    );
    t.is(response4.status, 200);
    t.assert(response4.headers['content-location']);
    t.assert(response4.headers['x-oada-rev']);
    const { data: data4 } = response4 as { data: Nested };
    t.assert(data4?._id);
    t.assert(data4?._rev);
    t.assert(data4?._type);
    t.falsy(data4?.['index-two']?._id);
    t.falsy(data4?.['index-two']?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two
    const response5 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two`
    );
    t.is(response5.status, 200);
    t.assert(response5.headers['content-location']);
    t.assert(response5.headers['x-oada-rev']);
    const { data: data5 } = response5 as { data: Nested };
    t.falsy(data5?._id);
    t.falsy(data5?._rev);
    t.assert(data5?.ddd?._id);
    t.assert(data5?.ddd?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd
    const response6 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd`
    );
    t.is(response6.status, 200);
    t.assert(response6.headers['content-location']);
    t.assert(response6.headers['x-oada-rev']);
    const { data: data6 } = response6 as { data: Nested };
    t.assert(data6?._id);
    t.assert(data6?._type);
    t.assert(data6?._rev);
    t.falsy(data6?.['index-three']?._id);
    t.falsy(data6?.['index-three']?._rev);
    t.assert(data6?.['index-three']?.eee);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three
    const response7 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three`
    );
    t.is(response7.status, 200);
    t.assert(response7.headers['content-location']);
    t.assert(response7.headers['x-oada-rev']);
    const { data: data7 } = response7 as { data: Nested };
    t.falsy(data7?._id);
    t.falsy(data7?._rev);
    t.assert(data7?.eee?._id);
    t.falsy(data7?.eee?._rev);

    // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee
    const response8 = await getAxios(
      `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`
    );
    t.is(response8.status, 200);
    t.assert(response8.headers['content-location']);
    t.assert(response8.headers['x-oada-rev']);
    const { data: data8 } = response8 as { data: Nested };
    t.assert(data8?._id);
    t.assert(data8?._rev);
    t.assert(data8?.test);
    t.falsy(data8?.test?._id);
    t.falsy(data8?.test?._rev);
  });

  test(`${connection}: Should create the proper trees from simultaneous PUT requests`, async (t) => {
    const { testName, testTree } = t.context as Context;
    // Adjust timeout because concurrent PUTs usually result in if-match errors and
    // the client tries to resolve the conflicts using the exponential backoff algorithm
    // t.timeout(10_000);
    // Do concurrent PUTs
    const paths = ['a', 'b', 'c'];
    const promises = paths.map(async (v) =>
      client.put({
        path: `/bookmarks/${testName}/concurrent-put/${v}`,
        tree: testTree,
        data: { foo: 'bar' },
      })
    );
    await Promise.all(promises);

    // Check
    for await (const v of paths) {
      const response = await getAxios(
        `/bookmarks/${testName}/concurrent-put/${v}`
      );
      t.log(response.data);
      t.is(response.status, 200);
      t.assert(response.headers['content-location']);
      t.assert(response.headers['x-oada-rev']);
      t.assert(response.data?._id);
      t.assert(response.data?._rev);
      t.assert(response.data?.foo);
    }
  });
}
