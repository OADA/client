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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import ksuid from 'ksuid';

// eslint-disable-next-line import/no-namespace
import * as oada from '../lib/index';
import {
  deleteLinkAxios,
  getTreeWithTestName,
  putResourceAxios,
} from './utils';
import { domain, token } from './config';

use(chaiAsPromised);

for (const connection of ['ws', 'http']) {
  if (connection !== 'ws' && connection !== 'http') continue;

  // eslint-disable-next-line @typescript-eslint/no-loop-func
  describe(`${connection} GET test`, () => {
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

    it('Get Top-Level Bookmark', async () => {
      // Run
      const response = await client.get({ path: '/bookmarks' });

      // Check
      expect(response.status).to.equal(200);
      expect(response.data).to.include({
        _type: 'application/vnd.oada.bookmarks.1+json',
      });
    });

    it('Should allow you to get a single resource by its resource ID', async () => {
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
      expect(response.status).to.equal(200);
      expect(response.data).to.include.keys(['_id', '_rev', '_meta']);
      expect(response.data).to.include(testObject);
    });

    it('Should allow you to get a single resource by its path', async () => {
      // Prepare a resource
      const testObject = { abc: 'def' };
      const path = `/bookmarks/${testName}/testResource2`;
      await putResourceAxios(testObject, path);

      // Run
      const response = await client.get({
        path,
      });

      // Check
      expect(response.status).to.equal(200);
      expect(response.data).to.include.keys(['_id', '_rev', '_meta']);
      expect(response.data).to.include(testObject);
    });

    it('Should error when timeout occurs during a GET request', async () => {
      // Prepare a resource
      const testObject = { abc: 'def' };
      const path = `/bookmarks/${testName}/testResource3`;
      await putResourceAxios(testObject, path);

      // Run
      return expect(
        client.get({
          path,
          timeout: 1, // 1 ms timeout
        })
      ).to.be.rejected;
    });

    it("Should error when the root path of a 'tree' GET doesn't exist", async () =>
      expect(
        client.get({
          path: '/bookmarks/test/testTwo',
          tree: testTree,
        })
      ).to.eventually.be.rejected);

    it('Should allow you to get resources based on a tree', async () => {
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
      expect(response.status).to.equal(200);
      expect(response.data).to.include.keys(['_id', '_rev', '_type', '_meta']);
      expect(response.data).to.have.nested.property('aaa');
      expect(response.data).to.have.nested.property('aaa.bbb');
      expect(response.data).to.have.nested.property('aaa.bbb.b');
      expect(response.data).to.have.nested.property('aaa.bbb.index-one.ccc');
      expect(response.data).to.have.nested.property(
        'aaa.bbb.index-one.ccc.index-two.bob'
      );
      expect(response.data).to.have.nested.property(
        'aaa.bbb.index-one.ccc.index-two.bob.index-three.2018'
      );
    });
  });
}
