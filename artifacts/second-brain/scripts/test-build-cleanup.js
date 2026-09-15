const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { terminateProcessTree } = require('./build');

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once('exit', resolve));
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function waitForPidExit(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Child process ${pid} survived Metro process-tree cleanup.`);
}

async function main() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
        const { spawn } = require('node:child_process');
        const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], {
          stdio: 'ignore',
        });
        process.stdout.write(String(grandchild.pid));
        setInterval(() => {}, 10000);
      `,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 20 && !output; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const grandchildPid = Number(output);
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, 'Grandchild PID was not reported.');

  await terminateProcessTree(child, 500);
  await waitForChildExit(child);
  await waitForPidExit(grandchildPid);

  console.log('Build cleanup regression check passed for the Metro process tree.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});