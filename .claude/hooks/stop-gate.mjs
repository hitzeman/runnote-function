#!/usr/bin/env node
// Stop hook: the agent may not finish its turn while typecheck or tests are
// red. Exit 2 blocks the stop and feeds the failure output back to the agent.
//
// Escape hatch for humans: RUNNOTE_SKIP_STOP_GATE=1.
// This hook deliberately blocks even when `stop_hook_active` is true: a red
// build is never an acceptable end state. If the agent cannot get to green,
// a human interrupts.
import { spawnSync } from 'node:child_process';

if (process.env.RUNNOTE_SKIP_STOP_GATE === '1') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const steps = [
  ['typecheck', ['run', '--silent', 'typecheck']],
  ['test', ['test', '--silent']],
];

for (const [name, args] of steps) {
  const res = spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) {
    const out = `${res.stdout}\n${res.stderr}`.trim().split('\n').slice(-60).join('\n');
    process.stderr.write(
      `Stop blocked: \`npm run ${name}\` is failing. Fix it (or explain to the user why you cannot) before finishing.\n\n${out}\n`
    );
    process.exit(2);
  }
}
process.exit(0);
