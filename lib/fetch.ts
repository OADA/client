import { fetch, context as _context, disconnectAll } from 'fetch-h2';

export type Disconnect = typeof disconnectAll;

// Create our own context to honor NODE_TLS_REJECT_UNAUTHORIZED like https
export const context = () =>
  _context({
    session: {
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    },
  });

export { Headers } from 'cross-fetch';

// cross-fetch has fetch as default export
export default fetch;
