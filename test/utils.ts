import axios, { AxiosRequestConfig, AxiosPromise } from "axios";
import ksuid from "ksuid";
import * as config from "./config";

export async function getAxios(path: string) {
  const response = await axios({
    method: "get",
    url: "https://" + config.domain + path,
    headers: {
      Authorization: "Bearer " + config.token,
    },
  });

  return response;
}

export async function putAxios(data: object, path: string) {
  const response = await axios({
    method: "put",
    url: "https://" + config.domain + path,
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json",
    },
    data,
  });

  return response;
}

export async function putResourceAxios(data: object, path: string) {
  let _id = "resources/" + ksuid.randomSync().string;
  const resource = await axios({
    method: "put",
    url: "https://" + config.domain + "/" + _id,
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json",
    },
    data,
  });
  const link = await axios({
    method: "put",
    url: "https://" + config.domain + path,
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json",
    },
    data: { _id, _rev: 0 },
  });

  return { resource, link, resource_id: _id };
}

export async function deleteLinkAxios(path: string) {
  const link = await axios({
    method: "delete",
    url: "https://" + config.domain + path,
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json",
    },
    data: null,
  });

  return { link };
}

export function getTreeWithTestName(testName: string) {
  return {
    bookmarks: {
      _type: "application/json",
      _rev: 0,
      [testName]: {
        _type: "application/json",
        _rev: 0,
        aaa: {
          _type: "application/json",
          _rev: 0,
          bbb: {
            _type: "application/json",
            _rev: 0,
            "index-one": {
              "*": {
                _type: "application/json",
                _rev: 0,
                "index-two": {
                  "*": {
                    _type: "application/json",
                    _rev: 0,
                    "index-three": {
                      "*": {
                        _type: "application/json",
                        test: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "concurrent-put": {
          _type: "application/json",
          _rev: 0,
          "*": {
            _type: "application/json",
            _rev: 0,
          },
        },
      },
    },
  };
}
