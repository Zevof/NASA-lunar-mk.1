import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(path.dirname(path.dirname(here)));

// Dynamically read test files: match test-browser-*.mjs or test-*.mjs
// Exclude run-browser-tests.mjs and analyze-shots.mjs
const testDir = path.join(rootDir, 'browsertest');
const files = fs.readdirSync(testDir);
const tests = files
  .filter(f => f.endsWith('.mjs'))
  .filter(f => f === 'run-browser-tests.mjs' || f === 'analyze-shots.mjs' ? false : (f.startsWith('test-browser-') || f.startsWith('test-')))
  .sort();

console.log(`Found ${tests.length} browser test files.`);

// Helper to check server status
async function checkServer(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(300, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  // Start server on port 8765
  const port = 8765;
  console.log(`Starting server python serve.py ${port}...`);
  const serverProcess = spawn('python', ['serve.py', String(port)], {
    cwd: rootDir,
    shell: true,
    stdio: 'ignore'
  });

  // Wait until http://127.0.0.1:8765/ 200 delivers (max 20 attempts à 300ms)
  let serverReady = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    if (await checkServer(port)) {
      serverReady = true;
      break;
    }
  }

  if (!serverReady) {
    console.warn('Warning: Server did not respond with 200 in time, proceeding anyway...');
  } else {
    console.log('Server is up and running.');
  }

  let passed = 0;
  let failed = 0;
  const failedTests = [];

  for (const test of tests) {
    const testPath = path.join(testDir, test);
    console.log(`\n=== ${test} ===`);
    const result = spawnSync(process.execPath, [testPath], {
      stdio: 'inherit',
      cwd: testDir
    });

    if (result.status === 0) {
      passed++;
    } else {
      failed++;
      failedTests.push(test);
    }
  }

  // Stop server
  console.log('\nStopping server...');
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/f', '/im', 'python.exe'], { stdio: 'ignore' });
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch (e) {
    // ignore
  }

  const total = tests.length;
  console.log(`\nPASSED ${passed}/${total}`);
  if (failed > 0) {
    console.log(`Failed tests: ${failedTests.join(', ')}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  try {
    spawnSync('taskkill', ['/f', '/im', 'python.exe'], { stdio: 'ignore' });
  } catch (e) {}
  process.exit(1);
});
