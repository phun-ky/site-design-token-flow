// Check that colours come from the colour tokens: a colour may only be written
// as the value of a CSS custom property, such as `--app-bg: #1b1b1f`, so each
// theme can redefine it, and everything else reads it with var(). See
// src/build/colours.ts for what counts as a colour.
// Not checked: tests and the Playwright checks (their colours are examples),
// comments, images such as favicon.svg, and <meta name="theme-color">, which
// the browser reads before any CSS.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  findCssColours,
  findHtmlColours,
  findScriptColours
} from '../src/build/colours.ts';

const ROOT = new URL('../', import.meta.url);
const FINDERS = {
  css: findCssColours,
  html: findHtmlColours,
  ts: findScriptColours,
  mjs: findScriptColours,
  js: findScriptColours
};
const EXEMPT = /(?:^|\/)__tests__\/|\.test\.ts$|^e2e\//;
// The tracked files, and new ones Git doesn't ignore
const { stdout } = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' }
);
const files = stdout
  .split('\n')
  .filter((file) => file.split('.').pop() in FINDERS && !EXEMPT.test(file));
const problems = [];

for (const file of files) {
  const find = FINDERS[file.split('.').pop()];

  for (const { line, colour } of find(
    readFileSync(new URL(file, ROOT), 'utf8')
  )) {
    problems.push(`${file}:${line}  ${colour}`);
  }
}

if (files.length === 0) {
  console.error('No files to check: is this a Git checkout?');
  process.exit(1);
}

if (problems.length > 0) {
  console.error(
    `${problems.length} colour(s) not from a token. Define the colour as a custom property, such as --app-shadow-color, for each theme, and use it with var():\n\n${problems.join('\n')}`
  );
  process.exit(1);
}

console.log(`Every colour comes from a token, in ${files.length} files.`);
