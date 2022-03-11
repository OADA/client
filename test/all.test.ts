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

import type { Nested } from './utils.js';
import { connect } from '../dist/index.js';

const generateRandomString = () => Math.random().toString(36).slice(7);

test('Connect/Disconnect', async (t) => {
  const client = await connect({
    domain,
    token,
  });
  await client.disconnect();
  t.pass();
});

test('Single GET', async (t) => {
  const client = await connect({
    domain,
    token,
  });
  const response = await client.get({ path: '/bookmarks' });
  t.is(response.status, 200);
  t.like(response.data, { _type: 'application/vnd.oada.bookmarks.1+json' });
  await client.disconnect();
});

test.skip('watch', async () => {
  const client = await connect({
    domain,
    token,
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const { changes } = await client.watch({
    path: '/bookmarks',
  });
  for await (const change of changes) {
    // eslint-disable-next-line no-console
    console.log(change);
  }
});

test.skip('Single PUT', async () => {
  const client = await connect({
    domain,
    token,
  });
  await client.put({
    path: '/bookmarks',
    data: { test10: 'aaa' },
  });

  await client.disconnect();
});

test.skip('Recursive PUT/GET', async (t) => {
  const randomString = generateRandomString();
  const tree = {
    bookmarks: {
      // eslint-disable-next-line sonarjs/no-duplicate-string
      _type: 'application/json',
      // _rev: 0,
      [randomString]: {
        _type: 'application/json',
        // _rev: 0,
        level1: {
          '*': {
            _type: 'application/json',
            // _rev: 0,
            level2: {
              '*': {
                _type: 'application/json',
                // _rev: 0,
                level3: {
                  '*': {
                    _type: 'application/json',
                    // _rev: 0,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const client = await connect({
    domain,
    token,
  });
  // Tree PUT
  await client.put({
    path: `/bookmarks/${randomString}/level1/abc/level2/def/level3/ghi/`,
    data: { thingy: 'abc' },
    tree,
  });
  // Recursive GET
  const response = await client.get({
    path: `/bookmarks/${randomString}`,
    tree,
  });
  const responseData = response.data as Nested;
  // Check
  t.assert(responseData?._type);
  t.assert(responseData?.level1?.abc?._type);
  t.assert(responseData?.level1?.abc?.level2?.def?._type);
  t.assert(responseData?.level1?.abc?.level2?.def?.level3?.ghi?._type);
  await client.disconnect();
});
