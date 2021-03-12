import { context } from "fetch-h2";

// Create our own context to honor NODE_TLS_REJECT_UNAUTHORIZED like https
const { fetch } = context({
  session: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  },
});

// cross-fetch has fetch as default export
export default fetch;
