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

import { createRequire } from 'node:module';

import { context as _context } from 'fetch-h2';

const nodeRequire = createRequire(import.meta.url); // Construct the require method
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { name, version } = nodeRequire('../package.json');

const ourAgent = `${name}/${version}`;

// Create our own context to honor NODE_TLS_REJECT_UNAUTHORIZED like https
export const context = ({ userAgent }: { userAgent: string }) =>
  _context({
    userAgent: `${userAgent} ${ourAgent}`,
    session: {
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    },
  });

export { Headers } from 'cross-fetch';

// Cross-fetch has fetch as default export

export { fetch as default } from 'fetch-h2';
