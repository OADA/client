import chai from "chai";
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
import "mocha";
import ksuid from "ksuid";
import * as oada from "../lib/index";
import * as config from "./config";
import * as utils from "./utils";

describe("Client test", function () {
  // Client instance
  let client: oada.OADAClient;

  // Tree
  let testName: string;
  let testTree: object;

  // Initialization
  before("Initialize connection", async function () {
    testName = "test-" + ksuid.randomSync().string;
    testTree = utils.getTreeWithTestName(testName);
    await utils.putResourceAxios({}, "/bookmarks/" + testName);
    // Connect
    client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
  });

  // Cleanup
  after("Destroy connection", async function () {
    // Disconnect
    await client.disconnect();
    // this does not delete resources... oh well.
    await utils.deleteLinkAxios("/bookmarks/" + testName);
  });

  it("Get Top-Level Bookmark", async () => {
    // Run
    const response = await client.get({ path: "/bookmarks" });

    // Check
    expect(response.status).to.equal(200);
    expect(response.data).to.include({
      _type: "application/vnd.oada.bookmarks.1+json",
    });
  });

  it("Should allow you to get a single resource by its resource ID", async function () {
    // Prepare a resource
    const testObj = { abc: "def" };
    const r = await utils.putResourceAxios(
      testObj,
      `/bookmarks/${testName}/testResource1`
    );

    // Run
    const response = await client.get({
      path: `/${r.resource_id}`,
    });

    // Check
    expect(response.status).to.equal(200);
    expect(response.data).to.include.keys(["_id", "_rev", "_meta"]);
    expect(response.data).to.include(testObj);
  });

  it("Should allow you to get a single resource by its path", async function () {
    // Prepare a resource
    const testObj = { abc: "def" };
    const path = `/bookmarks/${testName}/testResource2`;
    const r = await utils.putResourceAxios(testObj, path);

    // Run
    const response = await client.get({
      path,
    });

    // Check
    expect(response.status).to.equal(200);
    expect(response.data).to.include.keys(["_id", "_rev", "_meta"]);
    expect(response.data).to.include(testObj);
  });

  it("Should error when the root path of a 'tree' GET doesn't exist", async function () {
    return expect(
      client.get({
        path: "/bookmarks/test/testTwo",
        tree: testTree,
      })
    ).to.be.rejected;
  });

  it("Should allow you to get resources based on a tree", async function () {
    // Prepare resources
    const basePath = `/bookmarks/${testName}`;
    await utils.putResourceAxios({ somethingelse: "okay" }, basePath + "/aaa");
    await utils.putResourceAxios({ b: "b" }, `/bookmarks/${testName}/aaa/bbb`);
    await utils.putResourceAxios(
      { c: "c" },
      basePath + "/aaa/bbb/index-one/ccc"
    );
    await utils.putResourceAxios(
      { d: "d" },
      basePath + "/aaa/bbb/index-one/ccc/index-two/bob"
    );
    await utils.putResourceAxios(
      { e: "e" },
      basePath + "/aaa/bbb/index-one/ccc/index-two/bob/index-three/2018"
    );

    // Run
    const response = await client.get({
      path: basePath,
      tree: testTree,
    });

    // Check
    expect(response.status).to.equal(200);
    expect(response.data).to.include.keys(["_id", "_rev", "_type", "_meta"]);
    expect(response.data).to.have.nested.property("aaa");
    expect(response.data).to.have.nested.property("aaa.bbb");
    expect(response.data).to.have.nested.property("aaa.bbb.b");
    expect(response.data).to.have.nested.property("aaa.bbb.index-one.ccc");
    expect(response.data).to.have.nested.property(
      "aaa.bbb.index-one.ccc.index-two.bob"
    );
    expect(response.data).to.have.nested.property(
      "aaa.bbb.index-one.ccc.index-two.bob.index-three.2018"
    );
  });
});
