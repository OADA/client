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

import { generate as ksuid } from 'xksuid';

import type { Tree } from '@oada/types/oada/tree/v1.js';

// eslint-disable-next-line import/no-namespace
import * as oada from '../dist/index.js';
import {
  Nested,
  deleteLinkAxios,
  getAxios,
  getTreeWithTestName,
  putAxios,
  putResourceAxios,
} from './utils.js';

for (const connection of ['ws', 'http'] as const) {
  // Client instance
  let client: oada.OADAClient;

  // Tree
  let testName: string;
  let testTree: Tree;

  // Initialization
  test.before(`${connection}: Initialize connection`, async () => {
    testName = `test-${ksuid()}`;
    testTree = getTreeWithTestName(testName);
    await putResourceAxios({}, `/bookmarks/${testName}`);
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
    // This does not delete resources... oh well.
    await deleteLinkAxios(`/bookmarks/${testName}`);
  });

  test(`${connection}: Get Top-Level Bookmark`, async (t) => {
    // Run
    const response = await client.get({ path: '/bookmarks' });

    // Check
    t.is(response.status, 200);
    t.like(response.data, {
      _type: 'application/vnd.oada.bookmarks.1+json',
    });
  });

  test(`${connection}: Should allow you to get a single resource by its resource ID`, async (t) => {
    // Prepare a resource
    const testObject = { abc: 'def' };
    const r = await putResourceAxios(
      testObject,
      `/bookmarks/${testName}/testResource1`
    );

    // Run
    const response = await client.get({
      path: `/${r.resource_id}`,
    });

    // Check
    t.is(response.status, 200);
    const { data } = response as { data: Record<string, unknown> };
    t.assert(data._id);
    t.assert(data._rev);
    t.assert(data._meta);
    t.like(data, testObject);
  });

  test(`${connection}: Should allow you to get a single resource by its path`, async (t) => {
    // Prepare a resource
    const testObject = { abc: 'def' };
    const path = `/bookmarks/${testName}/testResource2`;
    await putResourceAxios(testObject, path);

    // Run
    const response = await client.get({
      path,
    });

    // Check
    t.is(response.status, 200);
    const { data } = response as { data: Record<string, unknown> };
    t.assert(data._id);
    t.assert(data._rev);
    t.assert(data._meta);
    t.like(data, testObject);
  });

  test(`${connection}: Should error when timeout occurs during a GET request`, async (t) => {
    // Prepare a resource
    const testObject = { abc: 'def' };
    const path = `/bookmarks/${testName}/testResource3`;
    await putResourceAxios(testObject, path);

    // Run
    await t.throwsAsync(
      client.get({
        path,
        timeout: 1, // 1 ms timeout
      })
    );
  });

  test(`${connection}: Should error when the root path of a 'tree' GET doesn't exist`, async (t) => {
    await t.throwsAsync(
      client.get({
        path: '/bookmarks/test/testTwo',
        tree: testTree,
      })
    );
  });

  test(`${connection}: Should error when 'X-OADA-Ensure-Link' is present`, async (t) => {
    const putResp = await putAxios(
      { somedata: 789 },
      `/bookmarks/${testName}/sometest4`,
      { 'X-OADA-Ensure-Link': 'versioned' }
    );
    t.is(putResp.status, 201);
    t.assert(putResp.headers['content-location']);
    t.assert(putResp.headers['x-oada-rev']);

    await t.throwsAsync(
      getAxios(`/bookmarks/${testName}/sometest4`, {
        'X-OADA-Ensure-Link': 'versioned',
      })
      /*
      {
        code: '400',
        message: 'X-OADA-Ensure-Link not allowed for this method',
      }
      */
    );
  });

  test(`${connection}: Should allow you to get resources based on a tree`, async (t) => {
    // Prepare resources
    const basePath = `/bookmarks/${testName}`;
    await putResourceAxios({ somethingelse: 'okay' }, `${basePath}/aaa`);
    await putResourceAxios({ b: 'b' }, `/bookmarks/${testName}/aaa/bbb`);
    await putResourceAxios({ c: 'c' }, `${basePath}/aaa/bbb/index-one/ccc`);
    await putResourceAxios(
      { d: 'd' },
      `${basePath}/aaa/bbb/index-one/ccc/index-two/bob`
    );
    await putResourceAxios(
      { e: 'e' },
      `${basePath}/aaa/bbb/index-one/ccc/index-two/bob/index-three/2018`
    );

    // Run
    const response = await client.get({
      path: basePath,
      tree: testTree,
    });
    // Check
    t.is(response.status, 200);
    const { data } = response as { data: Nested };
    t.assert(data?._id);
    t.assert(data?._rev);
    t.assert(data?._type);
    t.assert(data?._meta);
    t.assert(data?.aaa?.bbb?.b);
    t.assert(
      data?.aaa?.bbb?.['index-one']?.ccc?.['index-two']?.bob?.['index-three']?.[
        '2018'
      ]
    );
  });
}
