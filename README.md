# @oada/client

A lightweight client tool for interacting with an OADA-compliant server

| | `@oada/client` | `@oada/oada-cache` |
| --- | --- | --- |
| Language | TypeScript | JavaScript |
| Supported protocols | websocket | websocket, HTTP |
| Internal cache | No | Yes |


## Usage

### Connect

```javascript
var client = require("@oada/client")
var connection = await client.connect({
  domain: "api.oada.com",
  token: "abc"
})
```

### GET

#### Single GET

```javascript
var response = await connection.get({ path: '/bookmarks/test' })
```

#### Recursive GET

``` javascript
var dataTree = {
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
var response = await connection.get({
  path: '/bookmarks/thing',
  tree: dataTree
})
```

#### Watch

```javascript
var response = await connection.get({
  path: '/bookmarks/test',
  watchCallback: d => {
    console.log(d);
  }
})
```

### PUT

#### Single PUT

```javascript
var response = await connection.put({
  path: "/bookmarks/test",
  data: { thing: "abc" },
  contentType: "application/json"
})
```

#### Tree PUT

``` javascript
var dataTree = {
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
var response = await connection.put({
  path: '/bookmarks/thing/abc/xyz/zzz',
  tree: dataTree,
  data: { test: "something" }
})
```

### HEAD

```javascript
var response = await connection.head({ path: '/bookmarks/test' })
```
