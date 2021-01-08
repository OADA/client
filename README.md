# @oada/client

A lightweight client tool for interacting with an OADA-compliant server

[![npm](https://img.shields.io/npm/v/@oada/client)](https://www.npmjs.com/package/@oada/client)

## Installation

This module is available through npm. To install the module, simply run:

```bash
$ npm install @oada/client
```

## Usage

### Connect

```javascript
const client = require("@oada/client")
const connection = await client.connect({
  domain: "api.oada.com", // domain of OADA server
  token: "abc" // token
})
```

### GET

#### Single GET

```javascript
const response = await connection.get({
  path: '/bookmarks/test',
  timeout: 1000  // timeout in milliseconds (optional)
})
```

#### Recursive GET

``` javascript
const dataTree = {
  "bookmarks": {
    "_type": "application/vnd.oada.bookmarks.1+json",
    "_rev": 0,
    "thing": {
      "_type": "application/json",
      "_rev": 0,
      "abc": {
        "*": {
          "_type": "application/json",
      	  "_rev": 0,
        }
      }
    }
  }
}
const response = await connection.get({
  path: '/bookmarks/thing',
  tree: dataTree,
  timeout: 1000  // timeout in milliseconds (optional)
})
```

#### Watch

A watch request can be issued by passing a callback function to `watchCallback` argument of a GET request.
```javascript
const response = await connection.get({
  path: '/bookmarks/test',
  watchCallback: d => {
    console.log(d);
  },
  timeout: 1000  // timeout in milliseconds (optional)
})
```

Alternatively, one could explicitly send a `watch` request as follows.
```javascript
const requestId = await connection.watch({
  path: '/bookmarks/test',
  rev: 1, // optional
  watchCallback: d => {
    console.log(d);
  },
  timeout: 1000  // timeout in milliseconds (optional)
})
```

To unwatch a resource, use the `unwatch` request.
```javascript
const response = await connection.unwatch(requestId);
```

### PUT

#### Single PUT

```javascript
const response = await connection.put({
  path: "/bookmarks/test",
  data: { thing: "abc" },
  contentType: "application/json",
  timeout: 1000  // timeout in milliseconds (optional)
})
```

#### Tree PUT

``` javascript
const dataTree = {
  "bookmarks": {
    "_type": "application/vnd.oada.bookmarks.1+json",
    "_rev": 0,
    "thing": {
      "_type": "application/json",
      "_rev": 0,
      "abc": {
        "*": {
          "_type": "application/json",
      	  "_rev": 0,
        }
      }
    }
  }
}
const response = await connection.put({
  path: '/bookmarks/thing/abc/xyz/zzz',
  tree: dataTree,
  data: { test: "something" },
  timeout: 1000  // timeout in milliseconds (optional)
})
```

### HEAD

```javascript
const response = await connection.head({
  path: '/bookmarks/test',
  timeout: 1000  // timeout in milliseconds (optional)
})
```
