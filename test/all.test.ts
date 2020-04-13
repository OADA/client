import { expect } from "chai";
import "mocha";
import * as oada from "../lib/index";

const domain = "localhost";
const token = "abc";
const generateRandomStr = () => {
  return Math.random()
    .toString(36)
    .substring(7);
};

describe("Client test", function() {
  it("Connect/Disconnect", async () => {
    const client = oada.createInstance();
    await client.connect({ domain, token });
    await client.disconnect();
  });

  it("Single GET", async () => {
    let client = oada.createInstance();
    await client.connect({ domain, token });
    console.log("connected");
    const response = await client.get({ path: "/bookmarks" });
    expect(response.status).to.equal(200);
    expect(response.data["_type"]).to.equal(
      "application/vnd.oada.bookmarks.1+json"
    );
    client.disconnect();
  });

  xit("watch", async () => {
    let client = oada.createInstance();
    await client.connect({ domain, token });
    const response = await client.watch({
      path: "/bookmarks",
      watchCallback: d => {
        console.log(d);
      }
    });
  });

  xit("Single PUT", async () => {
    let client = oada.createInstance();
    await client.connect({ domain, token: "def" });
    console.log("connected");
    const response = await client.put({
      path: "/bookmarks",
      data: { test10: "aaa" }
    });

    client.disconnect();
  });

  it("Recursive PUT/GET", async () => {
    const randomStr = generateRandomStr();
    var tree = {
      bookmarks: {
        _type: "application/json",
        _rev: 0
      }
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
                  _rev: 0
                }
              }
            }
          }
        }
      }
    };
    let client = oada.createInstance();
    await client.connect({ domain, token });
    // Tree PUT
    await client.put({
      path: `/bookmarks/${randomStr}/level1/abc/level2/def/level3/ghi/`,
      data: { thingy: "abc" },
      tree
    });
    // Recursive GET
    const response = await client.get({
      path: `/bookmarks/${randomStr}`,
      tree
    });
    const responseData = response.data;
    // check
    expect(responseData).to.have.nested.property(`_type`);
    expect(responseData).to.have.nested.property(`level1.abc._type`);
    expect(responseData).to.have.nested.property(`level1.abc.level2.def._type`);
    expect(responseData).to.have.nested.property(
      `level1.abc.level2.def.level3.ghi._type`
    );
    client.disconnect();
  });
});
