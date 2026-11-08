#!/usr/bin/env node
// PostToolUse hook (Edit | Write | MultiEdit): lint the file that was just
// changed so the agent sees ESLint errors immediately, not at the end.
// Exit 2 feeds stderr back to the agent; exit 0 is silent.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input?.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!file || !/\.(ts|mts|mjs|js)$/.test(file)) process.exit(0);
const rel = relative(root, file);
if (rel.startsWith('..') || rel.startsWith('node_modules') || rel.startsWith('dist')) process.exit(0);

const res = spawnSync('npx', ['eslint', '--no-warn-ignored', rel], { cwd: root, encoding: 'utf8' });
if (res.status === 0) process.exit(0);

process.stderr.write(`ESLint failed for ${rel}. Fix these before moving on:\n${res.stdout}${res.stderr}`);
process.exit(2);
