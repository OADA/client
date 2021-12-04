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

import { context as _context, disconnectAll } from 'fetch-h2';

export type Disconnect = typeof disconnectAll;

// Create our own context to honor NODE_TLS_REJECT_UNAUTHORIZED like https
export const context = () =>
  _context({
    session: {
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    },
  });

export { Headers } from 'cross-fetch';

// Cross-fetch has fetch as default export

export { fetch as default } from 'fetch-h2';
