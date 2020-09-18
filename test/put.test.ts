import chai from "chai";
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
import "mocha";
import ksuid from "ksuid";
import * as oada from "../lib/index";
import * as config from "./config";
import * as utils from "./utils";

describe("PUT test", function () {
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

  it("Shouldn't error when the Content-Type header can be derived from the _type key in the PUT body", async function () {
    const response = await client.put({
      path: `/bookmarks/${testName}/sometest`,
      data: { _type: "application/json" },
    });
    expect(response.status).to.equal(200);
  });

  it("Shouldn't error when the Content-Type header can be derived from the contentType key", async function () {
    const response = await client.put({
      path: `/bookmarks/${testName}/somethingnew`,
      data: `"abc123"`,
      contentType: "application/json",
    });
    expect(response.status).to.equal(200);
  });

  it("Shouldn't error when 'Content-Type' header (_type) can be derived from the 'tree'", async function () {
    var response = await client.put({
      path: `/bookmarks/${testName}/aaa/bbb/index-one/sometest`,
      tree: testTree,
      data: `"abc123"`,
    });
    expect(response.status).to.equal(200);
  });

  xit("Should error when _type cannot be derived from the above tested sources", async function () {
    return expect(
      client.put({
        path: `/bookmarks/${testName}/sometest`,
        data: `"abc123"`,
      })
    ).to.be.rejected;
  });

  it("Should error when using a contentType parameter for which your token does not have access to read/write", async function () {
    return expect(
      client.put({
        path: `/bookmarks/${testName}/sometest2`,
        data: { anothertest: 123 },
        contentType: "application/vnd.oada.foobar.1+json",
      })
    ).to.be.rejected;
  });

  it("Should error when timeout occurs during a PUT request", async function () {
    return expect(
      client.put({
        path: `/bookmarks/${testName}/sometest3`,
        data: { anothertest: 123 },
        contentType: "application/json",
        timeout: 1,
      })
    ).to.be.rejected;
  });
});
