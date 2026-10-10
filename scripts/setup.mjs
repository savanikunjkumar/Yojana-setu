#!/usr/bin/env node
/**
 * First-run setup: creates the env files from their examples, without ever
 * overwriting one that already exists, then prints the remaining steps.
 *
 * Kept deliberately side-effect-light — it does not start Docker or touch the
 * database, so running it twice is always safe.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFiles = [
  { example: '.env.example', target: '.env' },
  { example: 'apps/web/.env.local.example', target: 'apps/web/.env.local' },
];

let created = 0;

for (const { example, target } of envFiles) {
  const targetPath = join(repoRoot, target);
  const examplePath = join(repoRoot, example);

  if (existsSync(targetPath)) {
    console.log(`  kept     ${target} (already exists)`);
    continue;
  }

  if (!existsSync(examplePath)) {
    console.error(`  missing  ${example} — cannot create ${target}`);
    process.exitCode = 1;
    continue;
  }

  copyFileSync(examplePath, targetPath);
  console.log(`  created  ${target} from ${relative(repoRoot, examplePath)}`);
  created += 1;
}

console.log(
  [
    '',
    created > 0 ? 'Environment files are ready.' : 'Environment files were already in place.',
    '',
    'Next:',
    '  1. npm run db:up        start PostgreSQL in Docker',
    '  2. npm run db:deploy    create the tables and the match_schemes() function',
    '  3. npm run db:seed      load 18 real schemes and 5 demo applicants',
    '  4. npm run dev          start the API on :4000 and the web app on :3000',
    '',
    'Then open http://localhost:3000, or http://localhost:4000/api/docs for the API.',
    '',
  ].join('\n'),
);
