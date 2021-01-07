import { use, expect } from "chai";
import "mocha";
import * as oada from "../lib/index";
import * as config from "./config";
use(require("chai-as-promised"));

const generateRandomStr = () => {
  return Math.random().toString(36).substring(7);
};

describe("HTTP Client test", function () {
  it("HTTP Connect/Disconnect", async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
      connection: "http",
    });
    await client.disconnect();
  });

  it("HTTP Single GET", async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
      connection: "http",
    });
    const response = await client.get({ path: "/bookmarks" });
    expect(response.status).to.equal(200);
    expect(response.data).to.have.nested.property(`_type`);
    //expect(response.data?._type).to.equal("application/vnd.oada.bookmarks.1+json");
    await client.disconnect();
  });

  it("HTTP watch should throw", async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
      connection: "http",
    });
    await expect(
      client.watch({
        path: "/bookmarks",
        watchCallback: console.log,
      })
    ).to.eventually.be.rejected;
  });

  it("HTTP PUT->GET->DELETE", async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
      connection: "http",
    });
    const response = await client
      .put({
        path: "/bookmarks",
        data: { test10: "aaa" },
      })
      .then(() => client.get({ path: `/bookmarks/test10` }))
      .then(async (res) => {
        await client.delete({ path: `/bookmarks/test10` });
        return res.data;
      });
    expect(response).to.equal("aaa");
  });

  it("Recursive PUT/GET", async () => {
    const randomStr = generateRandomStr();
    var tree = {
      bookmarks: {
        _type: "application/json",
        _rev: 0,
      },
    };
    tree.bookmarks[randomStr] = {
      _type: "application/json",
      _rev: 0,
      level1: {
        "*": {
          _type: "application/json",
          _rev: 0,
          level2: {
            "*": {
              _type: "application/json",
              _rev: 0,
              level3: {
                "*": {
                  _type: "application/json",
                  _rev: 0,
                },
              },
            },
          },
        },
      },
    };
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
      connection: "http",
    });
    // Tree PUT
    await client.put({
      path: `/bookmarks/${randomStr}/level1/abc/level2/def/level3/ghi/`,
      data: { thingy: "abc" },
      tree,
    });
    // Recursive GET
    const response = await client.get({
      path: `/bookmarks/${randomStr}`,
      tree,
    });
    const responseData = response.data;
    // check
    expect(responseData).to.have.nested.property(`_type`);
    expect(responseData).to.have.nested.property(`level1.abc._type`);
    expect(responseData).to.have.nested.property(`level1.abc.level2.def._type`);
    expect(responseData).to.have.nested.property(
      `level1.abc.level2.def.level3.ghi._type`
    );
    // Cleanup
    await client.delete({
      path: `/bookmarks/${randomStr}`,
    });
    client.disconnect();
  });
});
