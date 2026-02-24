#!/usr/bin/env node

const { spawnSync, spawn } = require('child_process');
const { loadEnv } = require('./load-env');

loadEnv();

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerUp() {
  try {
    const r = await fetch(base);
    return r.ok || r.status > 0;
  } catch {
    return false;
  }
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isServerUp()) return true;
    await sleep(500);
  }
  return false;
}

function runCmd(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with code ${r.status}`);
  }
}

async function run() {
  let serverProc = null;
  let startedByScript = false;

  try {
    const up = await isServerUp();
    if (!up) {
      runCmd('pnpm', ['build']);

      serverProc = spawn('pnpm', ['start', '-p', '3000'], {
        stdio: 'inherit',
        env: process.env
      });
      startedByScript = true;

      const ready = await waitForServer(90000);
      if (!ready) {
        throw new Error('Server did not become ready on http://localhost:3000');
      }
    }

    runCmd('node', ['scripts/test-api-smoke.js']);
    runCmd('node', ['scripts/test-webhooks.js']);

    console.log('E2E_PASS');
    console.log('- API smoke test: passed');
    console.log('- Webhook integration test: passed');
  } finally {
    if (startedByScript && serverProc && !serverProc.killed) {
      serverProc.kill('SIGINT');
    }
  }
}

run().catch((err) => {
  console.error('E2E_FAIL');
  console.error(err.message || err);
  process.exit(1);
});
