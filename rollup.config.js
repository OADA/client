import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { defineConfig } from 'rollup';

const plugins = [ resolve({ 
  preferBuiltins: false,  // you need this one to avoid using node resolutions
  browser: true           // you need this to make sure node things in universal modules don't get included
}), commonjs(), json() ];

const watch = {
  buildDelay: 200, // delay build until 100 ms after last change
  include: "dist/**/*.js",
  exclude: [ "dist/index.mjs", "dist/test/index.mjs", "dist/index.umd.js" ],
};

// use defineConfig to get typings in editor:
export default defineConfig([
  {
    input: "dist/index.js",
    plugins,
    watch,
    output: {
      file: "../oada-cache-overmind/index.mjs",
      format: "esm",
      sourcemap: true
    },
  },
]);
