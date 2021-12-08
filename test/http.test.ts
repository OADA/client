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

/* eslint-disable no-console */

import { setTimeout } from 'node:timers/promises';

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { domain, token } from './config';
import type { OADATree } from '../lib/client';
import { connect } from '../lib/index';

use(chaiAsPromised);

const generateRandomString = () => Math.random().toString(36).slice(7);

describe('HTTP Client test', () => {
  it('HTTP Connect/Disconnect', async () => {
    const client = await connect({
      domain,
      token,
      connection: 'http',
    });
    await client.disconnect();
  });

  it('HTTP Single GET', async () => {
    const client = await connect({
      domain,
      token,
      connection: 'http',
    });
    const response = await client.get({ path: '/bookmarks' });
    expect(response.status).to.equal(200);
    expect(response.data).to.have.nested.property(`_type`);
    // Expect(response.data?._type).to.equal("application/vnd.oada.bookmarks.1+json");
    await client.disconnect();
  });

  it('HTTP watch should not throw', async () => {
    const client = await connect({
      domain,
      token,
      connection: 'http',
    });
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const watch = await client.watch({
        path: '/bookmarks',
      });
      const changeP = watch.next();
      const delay = setTimeout(1000);
      await Promise.race([changeP, delay]);
    } finally {
      await client.disconnect();
    }
  });

  it('HTTP PUT->GET->DELETE', async () => {
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
      expect(response).to.equal('aaa');
    } finally {
      await client.disconnect();
    }
  });

  it('Recursive PUT/GET', async () => {
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
    } as unknown as OADATree;
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
    const responseData = response.data;
    // Check
    expect(responseData).to.have.nested.property(`_type`);
    expect(responseData).to.have.nested.property(`level1.abc._type`);
    expect(responseData).to.have.nested.property(`level1.abc.level2.def._type`);
    expect(responseData).to.have.nested.property(
      `level1.abc.level2.def.level3.ghi._type`
    );
    // Cleanup
    await client.delete({
      path: `/bookmarks/${randomString}`,
    });
    await client.disconnect();
  });
});
