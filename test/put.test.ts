import { expect, use } from 'chai';
import 'mocha';
import * as oada from '../lib/index';
import * as config from './config';
import * as utils from './utils';
import ksuid from 'ksuid';
use(require('chai-as-promised'));

['ws', 'http'].forEach((connection) => {
  if (connection !== 'ws' && connection !== 'http') return;

  describe(`${connection}: PUT test`, function () {
    // Client instance
    let client: oada.OADAClient;

    // Tree
    let testName: string;
    let testTree: object;

    // Initialization
    before('Initialize connection', async function () {
      testName = 'test-' + ksuid.randomSync().string;
      testTree = utils.getTreeWithTestName(testName);
      await utils.putResourceAxios({}, '/bookmarks/' + testName);
      // Connect
      client = await oada.connect({
        domain: config.domain,
        token: config.token,
        connection,
      });
    });

    // Cleanup
    after('Destroy connection', async function () {
      // Disconnect
      await client?.disconnect();
      // this does not delete resources... oh well.
      await utils.deleteLinkAxios('/bookmarks/' + testName);
    });

    it("Shouldn't error when the Content-Type header can be derived from the _type key in the PUT body", async function () {
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

    it("Shouldn't error when the Content-Type header can be derived from the contentType key", async function () {
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

    it("Shouldn't error when 'Content-Type' header (_type) can be derived from the 'tree'", async function () {
      var response = await client.put({
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

    xit('Should error when _type cannot be derived from the above tested sources', async function () {
      return expect(
        client.put({
          path: `/bookmarks/${testName}/sometest`,
          data: `"abc123"`,
        })
      ).to.be.rejected;
      // TODO: Check the rejection reason
    });

    it('Should error when using a contentType parameter for which your token does not have access to read/write', async function () {
      return expect(
        client.put({
          path: `/bookmarks/${testName}/sometest2`,
          data: { anothertest: 123 },
          contentType: 'application/vnd.oada.foobar.1+json',
        })
      ).to.be.rejected;
      // TODO: Check the rejection reason
    });

    it('Should error when timeout occurs during a PUT request', async function () {
      return expect(
        client.put({
          path: `/bookmarks/${testName}/sometest3`,
          data: { anothertest: 123 },
          contentType: 'application/json',
          timeout: 1,
        })
      ).to.be.rejected;
      // TODO: Check the rejection reason
    });

    it('Should create the proper resource breaks on the server when a tree parameter is supplied to a deep endpoint', async function () {
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
      var response = await utils.getAxios(`/bookmarks/${testName}/aaa`);
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
      response = await utils.getAxios(`/bookmarks/${testName}/aaa/bbb`);
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
      response = await utils.getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one`
      );
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
      response = await utils.getAxios(
        `/bookmarks/${testName}/aaa/bbb/index-one/ccc`
      );
      expect(response.status).to.equal(200);
      expect(response.headers).to.include.keys([
        'content-location',
        'x-oada-rev',
      ]);
      expect(response.data).to.include.keys(['_id', '_type', '_rev']);
      expect(response.data).to.not.have.nested.property('index-two._id');
      expect(response.data).to.not.have.nested.property('index-two._rev');

      // Path: aaa/bbb/index-one/ccc/index-two
      response = await utils.getAxios(
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
      response = await utils.getAxios(
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
      response = await utils.getAxios(
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
      response = await utils.getAxios(
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
      this.timeout(10000);
      // Do concurrent PUTs
      const paths = ['a', 'b', 'c'];
      const promises = paths.map((v) => {
        return client.put({
          path: `/bookmarks/${testName}/concurrent-put/${v}`,
          tree: testTree,
          data: { foo: 'bar' },
        });
      });
      await Promise.all(promises);

      // Check
      for (const v of paths) {
        const response = await utils.getAxios(
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
});
