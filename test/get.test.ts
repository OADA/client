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
  getResource,
  getTreeWithTestName,
  putResource,
  putResourceEnsureLink,
} from './utils.js';

// eslint-disable-next-line node/no-extraneous-import
import { type OADAClient, connect } from '@oada/client';

interface Context {
  testName: string;
  testTree: Tree;
  client: Record<'ws' | 'http', OADAClient>;
}

const test = ava as TestFn<Context>;

test.beforeEach(`Initialize test`, async (t) => {
  t.context.testName = `test-${ksuid()}`;
  t.context.testTree = getTreeWithTestName(t.context.testName);
  await putResourceEnsureLink({}, `/bookmarks/${t.context.testName}`);
});

for (const connection of ['ws', 'http'] as const) {
  // Initialization
  test.before(`${connection}: Initialize connection`, async (t) => {
    // Connect
    // @ts-expect-error stuff
    t.context.client ??= {};
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
    /*
    // This does not delete resources... oh well.
    await fetch(new URL(`/bookmarks/${t.context.testName}`, domain), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // eslint-disable-next-line unicorn/no-null
      body: JSON.stringify(null),
    });
    */
  });

  test(`${connection}: Get Top-Level Bookmark`, async (t) => {
    // Run
    const response = await t.context.client[connection].get({
      path: '/bookmarks',
    });

    // Check
    t.is(response.status, 200);
    t.like(response.data, {
      _type: 'application/vnd.oada.bookmarks.1+json',
    });
  });

  test(`${connection}: Should allow you to get a single resource by its resource ID`, async (t) => {
    // Prepare a resource
    const testObject = { abc: 'def' } as const;
    const r = await putResourceEnsureLink(
      testObject,
      `/bookmarks/${t.context.testName}/testResource1`,
    );

    // Run
    const response = await t.context.client[connection].get({
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
    const testObject = { abc: 'def' } as const;
    const path = `/bookmarks/${t.context.testName}/testResource2`;
    await putResourceEnsureLink(testObject, path);

    // Run
    const response = await t.context.client[connection].get({
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
    const testObject = { abc: 'def' } as const;
    const path = `/bookmarks/${t.context.testName}/testResource3`;
    await putResourceEnsureLink(testObject, path);

    // Run
    await t.throwsAsync(
      t.context.client[connection].get({
        path,
        timeout: 1, // 1 ms timeout
      }),
    );
  });

  test(`${connection}: Should error when the root path of a 'tree' GET doesn't exist`, async (t) => {
    await t.throwsAsync(
      t.context.client[connection].get({
        path: '/bookmarks/test/testTwo',
        tree: t.context.testTree,
      }),
    );
  });

  test(`${connection}: Should error when 'X-OADA-Ensure-Link' is present`, async (t) => {
    const putResp = await putResource(
      { somedata: 789 },
      `/bookmarks/${t.context.testName}/sometest4`,
      { 'X-OADA-Ensure-Link': 'versioned' },
    );
    t.is(putResp.status, 201);
    t.assert(putResp.headers.get('content-location'));
    t.assert(putResp.headers.get('x-oada-rev'));

    await t.throwsAsync(
      getResource(`/bookmarks/${t.context.testName}/sometest5`, {
        'X-OADA-Ensure-Link': 'versioned',
      }),
      {
        code: '400',
        // Message: 'X-OADA-Ensure-Link not allowed for this method',
      },
    );
  });

  test(`${connection}: Should allow you to get resources based on a tree`, async (t) => {
    // Prepare resources
    const basePath = `/bookmarks/${t.context.testName}`;
    await putResourceEnsureLink({ somethingelse: 'okay' }, `${basePath}/aaa`);
    await putResourceEnsureLink(
      { b: 'b' },
      `/bookmarks/${t.context.testName}/aaa/bbb`,
    );
    await putResourceEnsureLink(
      { c: 'c' },
      `${basePath}/aaa/bbb/index-one/ccc`,
    );
    await putResourceEnsureLink(
      { d: 'd' },
      `${basePath}/aaa/bbb/index-one/ccc/index-two/bob`,
    );
    await putResourceEnsureLink(
      { e: 'e' },
      `${basePath}/aaa/bbb/index-one/ccc/index-two/bob/index-three/2018`,
    );

    // Run
    const response = await t.context.client[connection].get({
      path: basePath,
      tree: t.context.testTree,
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
      ],
    );
  });
}
