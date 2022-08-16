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

import { setTimeout } from 'isomorphic-timers-promises';

import type { Tree } from '@oada/types/oada/tree/v1.js';

import type { Nested } from './utils.js';
import { connect } from '../dist/index.js';

const generateRandomString = () => Math.random().toString(36).slice(7);

test('HTTP Connect/Disconnect', async (t) => {
  const client = await connect({
    domain,
    token,
    connection: 'http',
  });
  await client.disconnect();
  t.pass();
});

test('HTTP Single GET', async (t) => {
  const client = await connect({
    domain,
    token,
    connection: 'http',
  });
  const response = await client.get({ path: '/bookmarks' });
  t.is(response.status, 200);
  t.like(response.data, { _type: 'application/vnd.oada.bookmarks.1+json' });
  await client.disconnect();
});

test('HTTP watch should not throw', async (t) => {
  const client = await connect({
    domain,
    token,
    connection: 'http',
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const { changes } = await client.watch({
    path: '/bookmarks',
  });
  const changeP = changes.next();
  const delay = setTimeout(1000);
  await t.notThrowsAsync(Promise.race([changeP, delay]));
  await client.disconnect();
});

test('HTTP PUT->GET->DELETE', async (t) => {
  const client = await connect({
    domain,
    token,
    connection: 'http',
  });
  try {
    await client.put({
      path: '/bookmarks',
      data: { test10: 'aaa' },
    });
    const { data: response } = await client.get({
      path: `/bookmarks/test10`,
    });
    await client.delete({ path: `/bookmarks/test10` });
    t.is(response, 'aaa');
  } finally {
    await client.disconnect();
  }
});

test('Recursive PUT/GET', async (t) => {
  const randomString = generateRandomString();
  const tree = {
    bookmarks: {
      // eslint-disable-next-line sonarjs/no-duplicate-string
      _type: 'application/json',
      _rev: 0,
      [randomString]: {
        _type: 'application/json',
        _rev: 0,
        level1: {
          '*': {
            _type: 'application/json',
            _rev: 0,
            level2: {
              '*': {
                _type: 'application/json',
                _rev: 0,
                level3: {
                  '*': {
                    _type: 'application/json',
                    _rev: 0,
                  },
                },
              },
            },
          },
        },
      },
    },
  } as unknown as Tree;
  const client = await connect({
    domain,
    token,
    connection: 'http',
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
  const { data } = response as { data: Nested };
  // Check
  t.assert(data?._type);
  t.assert(data?.level1?.abc?._type);
  t.assert(data?.level1?.abc?.level2?.def?._type);
  t.assert(data?.level1?.abc?.level2?.def?.level3?.ghi?._type);
  // Cleanup
  await client.delete({
    path: `/bookmarks/${randomString}`,
  });
  await client.disconnect();
});
