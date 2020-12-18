import * as config from "./config";
import * as utils from "./utils";
import * as readline from 'readline'; // node.js native readline

(async function() {

  const bookmarks = await utils.getAxios(`/bookmarks`).then(res => res.data);
  const testkeys = Object.keys(bookmarks).filter(k => k.match(/test-/));

  const readline = require('readline');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('About to delete keys '+JSON.stringify(testkeys)+' from OADA.  Proceed (y/N)? ', async (answer) => {
    rl.close();
    if (answer !== 'y') {
      console.log('Not deleting keys because you didn\'t type "y"');
      return;
    }
    console.log('Deleting keys...');
    await Promise.all(testkeys.map(k => utils.deleteLinkAxios(`/bookmarks/${k}`)));
    console.log('Keys deleted.');
  });

})();
