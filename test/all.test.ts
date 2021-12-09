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

import { expect } from 'chai';

import { domain, token } from './config';
import type { OADATree } from '../lib/client';
import { connect } from '../lib/index';

const generateRandomString = () => Math.random().toString(36).slice(7);

describe('Client test', () => {
  it('Connect/Disconnect', async () => {
    const client = await connect({
      domain,
      token,
    });
    await client.disconnect();
  });

  it('Single GET', async () => {
    const client = await connect({
      domain,
      token,
    });
    const response = await client.get({ path: '/bookmarks' });
    expect(response.status).to.equal(200);
    expect(response.data).to.have.nested.property(`_type`);
    // Expect(response.data["_type"]).to.equal(
    //   "application/vnd.oada.bookmarks.1+json"
    // );
    await client.disconnect();
  });

  xit('watch', async () => {
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

  xit('Single PUT', async () => {
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

  xit('Recursive PUT/GET', async () => {
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
    } as unknown as OADATree;
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
    const responseData = response.data;
    // Check
    expect(responseData).to.have.nested.property(`_type`);
    expect(responseData).to.have.nested.property(`level1.abc._type`);
    expect(responseData).to.have.nested.property(`level1.abc.level2.def._type`);
    expect(responseData).to.have.nested.property(
      `level1.abc.level2.def.level3.ghi._type`
    );
    await client.disconnect();
  });
});
