import { expect } from 'chai';
import 'mocha';

import type { OADATree } from '../lib/client';
import * as oada from '../lib/index';
import * as config from './config';

const generateRandomStr = () => {
  return Math.random().toString(36).substring(7);
};

describe('Client test', function () {
  it('Connect/Disconnect', async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
    await client.disconnect();
  });

  it('Single GET', async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
    const response = await client.get({ path: '/bookmarks' });
    expect(response.status).to.equal(200);
    expect(response.data).to.have.nested.property(`_type`);
    // expect(response.data["_type"]).to.equal(
    //   "application/vnd.oada.bookmarks.1+json"
    // );
    await client.disconnect();
  });

  xit('watch', async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
    await client.watch({
      path: '/bookmarks',
      watchCallback: async (d: unknown) => {
        console.log(d);
      },
    });
  });

  xit('Single PUT', async () => {
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
    await client.put({
      path: '/bookmarks',
      data: { test10: 'aaa' },
    });

    client.disconnect();
  });

  xit('Recursive PUT/GET', async () => {
    const randomStr = generateRandomStr();
    const tree = {
      bookmarks: {
        _type: 'application/json',
        //_rev: 0,
        [randomStr]: {
          _type: 'application/json',
          //_rev: 0,
          level1: {
            '*': {
              _type: 'application/json',
              //_rev: 0,
              level2: {
                '*': {
                  _type: 'application/json',
                  //_rev: 0,
                  level3: {
                    '*': {
                      _type: 'application/json',
                      //_rev: 0,
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OADATree;
    const client = await oada.connect({
      domain: config.domain,
      token: config.token,
    });
    // Tree PUT
    await client.put({
      path: `/bookmarks/${randomStr}/level1/abc/level2/def/level3/ghi/`,
      data: { thingy: 'abc' },
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
    client.disconnect();
  });
});
