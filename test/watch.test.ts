import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import "mocha";
import ksuid from "ksuid";
import * as oada from "../lib/index";
import * as config from "./config";
import * as utils from "./utils";

["ws", "http"].forEach((connection) => {
  if (connection !== "ws" && connection !== "http") return;

  describe(connection + ": WATCH test", function () {
    // Client instance
    let client: oada.OADAClient;

    // Tree
    let testName: string;

    // Initialization
    before("Initialize connection", async function () {
      testName = "test-" + ksuid.randomSync().string;
      await utils.putResourceAxios({}, "/bookmarks/" + testName);
      // Connect
      client = await oada.connect({
        domain: config.domain,
        token: config.token,
        connection,
      });
    });

    // Cleanup
    after("Destroy connection", async function () {
      // Disconnect
      await client.disconnect();
      // this does not delete resources... oh well.
      await utils.deleteLinkAxios("/bookmarks/" + testName);
    });

    it("Should receive the watch change from a single PUT request", function (done) {
      utils
        .putResourceAxios({}, `/bookmarks/${testName}/test1`)
        // 1) Get current rev
        .then(() => utils.getAxios(`/bookmarks/${testName}/test1`))
        // 2) Set up watch
        .then((axiosResp) =>
          client.watch({
            path: `/bookmarks/${testName}/test1`,
            watchCallback: (watchResp: any) => {
              // We need a try-catch to properly capture an exception from expect() within a callback function
              try {
                // Check
                expect(axiosResp.data).to.include.keys("_rev");
                const nextRev = axiosResp.data._rev + 1;
                expect(watchResp.body).to.include({ _rev: nextRev });
                expect(watchResp.body).to.have.nested.property("testData1.abc");

                // Done this unit test
                done();
              } catch (e) {
                // Done this unit test with an exception
                done(e);
              }
            },
          })
        )
        // 3) Make changes
        .then(() =>
          utils.putAxios(
            { abc: "def" },
            `/bookmarks/${testName}/test1/testData1`
          )
        );
      // This unit test will wait until done() is called
    });

    it("Should not receive the watch change after unwatch request", function (done) {
      utils
        .putResourceAxios({}, `/bookmarks/${testName}/test2`)
        // 1) Get current rev
        .then(() => utils.getAxios(`/bookmarks/${testName}/test2`))
        // 2) Set up watch
        .then((_axiosResp) =>
          client.watch({
            path: `/bookmarks/${testName}/test2`,
            watchCallback: (_watchResp: any) => {
              // This callback should never be called after unwatch
              done(new Error("Watch received"));
            },
          })
        )
        // 3) Unwatch
        .then((watchResp) => client.unwatch(watchResp))
        // 4) Make changes
        .then(() =>
          utils.putAxios(
            { abc: "def" },
            `/bookmarks/${testName}/test2/testData`
          )
        )
        // 5) Wait 1 second
        .then(() => {
          return new Promise((_) => setTimeout(_, 1000));
        })
        .then(done);
      // This unit test will wait until done() is called
    });

    xit("Should receive the watch change from a single deep PUT request", function (done) {
      utils
        .putResourceAxios({}, `/bookmarks/${testName}/test3`)
        .then(() =>
          utils.putResourceAxios({}, `/bookmarks/${testName}/test3/level1`)
        )
        .then(() =>
          utils.putResourceAxios(
            {},
            `/bookmarks/${testName}/test3/level1/level2`
          )
        )
        // 1) Get current rev
        .then(() => utils.getAxios(`/bookmarks/${testName}/test3`))
        // 2) Set up watch
        .then((axiosResp) =>
          client.watch({
            path: `/bookmarks/${testName}/test3`,
            watchCallback: (watchResp: any) => {
              console.log(watchResp);
              // We need a try-catch to properly capture an exception from expect() within a callback function
              try {
                // Check
                expect(axiosResp.data).to.include.keys("_rev");
                const nextRev = axiosResp.data._rev + 1;
                expect(watchResp.body).to.include({ _rev: nextRev });
                expect(watchResp.body).to.have.nested.property("testData1.abc");

                // Done this unit test
                done();
              } catch (e) {
                // Done this unit test with an exception
                done(e);
              }
            },
          })
        )
        // 3) Make changes
        .then(() =>
          utils.putAxios(
            { abc: "def" },
            `/bookmarks/${testName}/test3/level1/level2/testData`
          )
        );
      // This unit test will wait until done() is called
    });
  });
});
