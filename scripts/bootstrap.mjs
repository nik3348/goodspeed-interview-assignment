#!/usr/bin/env node
/**
 * One command to take a fresh clone as far as it can go on its own.
 *
 * It creates the env files, says exactly what is still missing, and applies
 * the schema once it has what it needs. Everything it cannot do without a
 * human — creating a Supabase project, choosing an AI provider — it names
 * precisely rather than failing with a stack trace.
 *
 * Safe to run repeatedly: it never overwrites an existing .env.local, and
 * migrations are applied by the Supabase CLI, which skips what is already there.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENV_FILES = [
  {
    app: 'apps/api',
    required: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'AI_API_KEY'],
  },
  {
    app: 'apps/web',
    required: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_API_URL',
    ],
  },
];

const ESC = String.fromCharCode(27);
const bold = (text) => `${ESC}[1m${text}${ESC}[0m`;
const dim = (text) => `${ESC}[2m${text}${ESC}[0m`;

function readEnv(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) => line !== '' && !line.startsWith('#') && line.includes('='),
      )
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1).trim()];
      }),
  );
}

console.log(bold('\nKnowledge base setup\n'));

// 1. Environment files ----------------------------------------------------
const missing = [];

for (const { app, required } of ENV_FILES) {
  const target = join(root, app, '.env.local');

  if (!existsSync(target)) {
    copyFileSync(join(root, app, '.env.example'), target);
    console.log(`  created ${app}/.env.local ${dim('from .env.example')}`);
  }

  const env = readEnv(target);

  for (const key of required) {
    if (!env[key]) {
      missing.push(`${app}/.env.local   ${key}`);
    }
  }
}

if (missing.length > 0) {
  console.log(`\n${bold('Fill these in, then run this again:')}\n`);

  for (const entry of missing) {
    console.log(`  ${entry}`);
  }

  console.log(`
  ${dim('Supabase URL and publishable key:')}
    supabase.com/dashboard, your project, Project Settings, API keys

  ${dim('AI_API_KEY: any provider that speaks the OpenAI API.')}
    OpenAI, Groq, Together AI, OpenRouter, or a local Ollama. Ollama needs
    no key: set AI_BASE_URL=http://localhost:11434/v1 and leave the key blank.

  ${dim('Both files are commented; every variable says what it is for.')}
`);
  process.exit(0);
}

console.log('  environment files look complete');

// 2. Schema ---------------------------------------------------------------
const linked = existsSync(
  join(root, 'packages/database/supabase/.temp/project-ref'),
);

if (!linked) {
  console.log(`
${bold('Link this checkout to your Supabase project, then run this again:')}

  pnpm db:link --project-ref <your-project-ref>

  ${dim('The ref is the subdomain of your project URL. The CLI asks for the')}
  ${dim('database password you chose when you created the project.')}
`);
  process.exit(0);
}

console.log('\n  applying migrations\n');
execFileSync('pnpm', ['db:push'], { cwd: root, stdio: 'inherit' });

console.log('\n  generating database types\n');
execFileSync('pnpm', ['db:types'], { cwd: root, stdio: 'inherit' });

console.log(`
${bold('Ready.')} Start both apps with:

  pnpm dev

  ${dim('web   http://localhost:3001')}
  ${dim('api   http://localhost:3000')}
`);
