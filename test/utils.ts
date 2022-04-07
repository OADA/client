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

import { domain, token } from './config.js';
import axios from 'axios';
import ksuid from 'ksuid';

export type Nested =
  | {
      [k: string]: Nested;
    }
  | undefined;

export async function getAxios(
  path: string,
  headers?: Record<string, unknown>,
) {
  return axios({
    method: 'get',
    url: `${domain}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
}

export async function putAxios(
  data: Record<string, unknown>,
  path: string,
  headers?: Record<string, unknown>,
) {
  return axios({
    method: 'put',
    url: `${domain}${path}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      // eslint-disable-next-line sonarjs/no-duplicate-string
      'Content-Type': 'application/json',
      ...headers,
    },
    data,
  });
}

export async function putResourceAxios(
  data: Record<string, unknown>,
  path: string
) {
  const _id = `resources/${ksuid.randomSync().string}`;
  const resource = await axios({
    method: 'put',
    url: `${domain}/${_id}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data,
  });
  const link = await axios({
    method: 'put',
    url: `${domain}${path}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { _id, _rev: 0 },
  });

  return { resource, link, resource_id: _id };
}

export async function deleteLinkAxios(path: string) {
  const link = await axios({
    method: 'delete',
    url: `${domain}${path}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: null,
  });

  return { link };
}

export function getTreeWithTestName(testName: string) {
  return {
    bookmarks: {
      _type: 'application/json',
      _rev: 0,
      [testName]: {
        '_type': 'application/json',
        '_rev': 0,
        'aaa': {
          _type: 'application/json',
          _rev: 0,
          bbb: {
            '_type': 'application/json',
            '_rev': 0,
            'index-one': {
              '*': {
                '_type': 'application/json',
                '_rev': 0,
                'index-two': {
                  '*': {
                    '_type': 'application/json',
                    '_rev': 0,
                    'index-three': {
                      '*': {
                        _type: 'application/json',
                        test: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
        'concurrent-put': {
          '_type': 'application/json',
          '_rev': 0,
          '*': {
            _type: 'application/json',
            _rev: 0,
          },
        },
      },
    },
  };
}
