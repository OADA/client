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
import { deleteLinkAxios, getAxios, putAxios, putResourceAxios } from './utils';
import { domain, token } from './config';

use(chaiAsPromised);

for (const connection of ['ws', 'http']) {
  if (connection !== 'ws' && connection !== 'http') continue;

  // eslint-disable-next-line @typescript-eslint/no-loop-func
  describe(`${connection}: WATCH test`, () => {
    // Client instance
    let client: oada.OADAClient;

    // Tree
    let testName: string;

    // Initialization
    before('Initialize connection', async () => {
      testName = `test-${ksuid.randomSync().string}`;
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

    it('Should receive the watch change from a single PUT request', async () => {
      await putResourceAxios({}, `/bookmarks/${testName}/test1`);
      // 1) Get current rev
      const axiosResp = await getAxios(`/bookmarks/${testName}/test1`);
      // 2) Set up watch
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const watch = client.watch({
        path: `/bookmarks/${testName}/test1`,
      });
      // 3) Make changes
      await putAxios({ abc: 'def' }, `/bookmarks/${testName}/test1/testData1`);

      // eslint-disable-next-line no-unreachable-loop
      for await (const change of watch) {
        // We need a try-catch to properly capture an exception from expect() within a callback function
        // Check
        expect(axiosResp.data).to.include.keys('_rev');
        const nextRev = Number(axiosResp.data._rev) + 1;
        expect(change.body).to.include({ _rev: nextRev });
        expect(change.body).to.have.nested.property('testData1.abc');

        break;
      }
    });
    // This unit test will wait until done() is called

    it('Should not receive the watch change after unwatch request', async () => {
      await putResourceAxios({}, `/bookmarks/${testName}/test2`);
      // 1) Get current rev
      await getAxios(`/bookmarks/${testName}/test2`);
      // 2) Set up watch
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const watch = client.watch({
        path: `/bookmarks/${testName}/test2`,
      });
      // 3) Unwatch
      await watch.return();
      // 4) Make changes
      await putAxios({ abc: 'def' }, `/bookmarks/${testName}/test2/testData`);
      // eslint-disable-next-line no-unreachable-loop
      for await (const change of watch) {
        throw new Error(`Received change: ${JSON.stringify(change)}`);
      }
    });
    // This unit test will wait until done() is called

    xit('Should receive the watch change from a single deep PUT request', async () => {
      await putResourceAxios({}, `/bookmarks/${testName}/test3`);
      await putResourceAxios({}, `/bookmarks/${testName}/test3/level1`);
      await putResourceAxios({}, `/bookmarks/${testName}/test3/level1/level2`);
      // 1) Get current rev
      const axiosResp = await getAxios(`/bookmarks/${testName}/test3`);
      // 2) Set up watch
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const watch = client.watch({
        path: `/bookmarks/${testName}/test3`,
      });
      // 3) Make changes
      await putAxios(
        { abc: 'def' },
        `/bookmarks/${testName}/test3/level1/level2/testData`
      );
      for await (const watchResp of watch) {
        // eslint-disable-next-line no-console
        console.log(watchResp);
        // Check
        expect(axiosResp.data).to.include.keys('_rev');
        const nextRev = Number(axiosResp.data._rev) + 1;
        expect(watchResp.body).to.include({ _rev: nextRev });
        expect(watchResp.body).to.have.nested.property('testData1.abc');
      }
    });
    // This unit test will wait until done() is called
  });
}
