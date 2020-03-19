# oada-client

A lightweight client tool for interacting with an OADA-complient server

## Usage

### Connect

```javascript
var client = require("oada-client")
var connection = await client.connect({
  domain: "api.oada.com",
  token: "abc"
})
```

### GET

```javascript
var response = await connection.get({ path: '/bookmarks/test' })
```
