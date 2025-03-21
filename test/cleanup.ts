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

/* eslint-disable no-console */

import readline from "node:readline";

import { deleteLink, getResource } from "./utils.js";

async function run() {
  const response = await getResource(`/bookmarks`);
  const bookmarks = (await response.json()) as Record<string, unknown>;
  const testkeys = Object.keys(bookmarks).filter((k) => /test-/.exec(k));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question(
    `About to delete keys ${JSON.stringify(
      testkeys,
    )} from OADA.  Proceed (y/N)? `,
    async (answer) => {
      rl.close();
      if (answer !== "y") {
        console.log('Not deleting keys because you didn\'t type "y"');
        return;
      }

      console.log("Deleting keys...");
      await Promise.all(
        testkeys.map(async (k) => deleteLink(`/bookmarks/${k}`)),
      );
      console.log("Keys deleted.");
    },
  );
}

// eslint-disable-next-line unicorn/prefer-top-level-await
void run();
