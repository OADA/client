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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ksuid from 'ksuid';

// eslint-disable-next-line import/no-namespace
import * as oada from '../lib/index';
import {
  deleteLinkAxios,
  getAxios,
  getTreeWithTestName,
  putResourceAxios,
} from './utils';
import { domain, token } from './config';

use(chaiAsPromised);

for (const connection of ['ws', 'http']) {
  if (connection !== 'ws' && connection !== 'http') continue;

  // eslint-disable-next-line @typescript-eslint/no-loop-func
  describe(`${connection}: PUT test`, () => {
    // Client instance
    let client: oada.OADAClient;

    // Tree
    let testName: string;
    let testTree: Record<string, unknown>;

    // Initialization
    before('Initialize connection', async () => {
      testName = `test-${ksuid.randomSync().string}`;
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
    after('Destroy connection', async () => {
      // Disconnect
      await client?.disconnect();
      // This does not delete resources... oh well.
      await deleteLinkAxios(`/bookmarks/${testName}`);
    });

    it("Shouldn't error when the Content-Type header can be derived from the _type key in the PUT body", async () => {
      const response = await client.put({
        path: `/bookmarks/${testName}/sometest`,
        data: { _type: 'application/json' },
      });
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
    });

    it("Shouldn't error when the Content-Type header can be derived from the contentType key", async () => {
      const response = await client.put({
        path: `/bookmarks/${testName}/somethingnew`,
        data: `"abc123"`,
        contentType: 'application/json',
      });
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
    });

    it("Shouldn't error when 'Content-Type' header (_type) can be derived from the 'tree'", async () => {
      const response = await client.put({
        path: `/bookmarks/${testName}/aaa/bbb/index-one/sometest`,
        tree: testTree,
        data: `"abc123"`,
      });
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
    });

    xit('Should error when _type cannot be derived from the above tested sources', async () =>
      expect(
        client.put({
          path: `/bookmarks/${testName}/sometest`,
          data: `"abc123"`,
        })
      ).to.be.rejected);
    // TODO: Check the rejection reason

    it('Should error when using a contentType parameter for which your token does not have access to read/write', async () =>
      expect(
        client.put({
          path: `/bookmarks/${testName}/sometest2`,
          data: { anothertest: 123 },
          contentType: 'application/vnd.oada.foobar.1+json',
        })
      ).to.be.rejected);
    // TODO: Check the rejection reason

    it('Should error when timeout occurs during a PUT request', async () =>
      expect(
        client.put({
          path: `/bookmarks/${testName}/sometest3`,
          data: { anothertest: 123 },
          contentType: 'application/json',
          timeout: 1,
        })
      ).to.be.rejected);
    // TODO: Check the rejection reason

    it('Should create the proper resource breaks on the server when a tree parameter is supplied to a deep endpoint', async () => {
      const putResp = await client.put({
        path: `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`,
        tree: testTree,
        data: { test: 'some test' },
      });
      expect(putResp.status).to.equal(200);
      expect(putResp.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);

      // Path: aaa
      let response = await getAxios(`/bookmarks/${testName}/aaa`);
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_rev', 'bbb']);
      expect(response.data).to.have.nested.property('bbb._id');
      expect(response.data).to.have.nested.property('bbb._rev');
      expect(response.data).to.not.have.nested.property('bbb.index-one');

      // Path: aaa/bbb
      response = await getAxios(`/bookmarks/${testName}/aaa/bbb`);
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_rev', 'index-one']);
      expect(response.data).to.not.have.nested.property('index-one._id');
      expect(response.data).to.not.have.nested.property('index-one._rev');
      expect(response.data).to.have.nested.property('index-one.ccc');

      // Path: aaa/bbb/index-one
      response = await getAxios(`/bookmarks/${testName}/aaa/bbb/index-one`);
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.not.include.keys(['_id', '_rev']);
      expect(response.data).to.include.keys(['ccc']);
      expect(response.data).to.have.nested.property('ccc._id');
      expect(response.data).to.have.nested.property('ccc._rev');

      // Path: aaa/bbb/index-one/ccc
      response = await getAxios(`/bookmarks/${testName}/aaa/bbb/index-one/ccc`);
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_type', '_rev']);
      expect(response.data).to.not.have.nested.property('index-two._id');
      expect(response.data).to.not.have.nested.property('index-two._rev');

      // Path: aaa/bbb/index-one/ccc/index-two
      response = await getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two`
      );
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.not.include.keys(['_id', '_rev']);
      expect(response.data).to.have.nested.property('ddd._id');
      expect(response.data).to.have.nested.property('ddd._rev');

      // Path: aaa/bbb/index-one/ccc/index-two/ddd
      response = await getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd`
      );
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_type', '_rev']);
      expect(response.data).to.not.have.nested.property('index-three._id');
      expect(response.data).to.not.have.nested.property('index-three._rev');
      expect(response.data).to.have.nested.property('index-three.eee');

      // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three
      response = await getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three`
      );
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.not.include.keys(['_id', '_rev']);
      expect(response.data).to.include.keys(['eee']);
      expect(response.data).to.have.nested.property('eee._id');
      expect(response.data).to.not.have.nested.property('eee._rev');

      // Path: aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee
      response = await getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one/ccc/index-two/ddd/index-three/eee`
      );
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_rev', 'test']);
      expect(response.data).to.not.have.nested.property('test._id');
      expect(response.data).to.not.have.nested.property('test._rev');
    });

    it('Should create the proper trees from simultaneous PUT requests', async function () {
      // Adjust timeout because concurrent PUTs usually result in if-match errors and
      // the client tries to resolve the conflicts using the exponential backoff algorithm
      // eslint-disable-next-line @typescript-eslint/no-invalid-this
      this.timeout(10_000);
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
      for (const v of paths) {
        // eslint-disable-next-line no-await-in-loop
        const response = await getAxios(
          `/bookmarks/${testName}/concurrent-put/${v}`
        );
        expect(response.status).to.equal(200);
        expect(response.headers).to.include.keys([
          'content-location',
          'x-oada-rev',
        ]);
        expect(response.data).to.include.keys(['_id', '_rev', 'foo']);
      }
    });
  });
}
