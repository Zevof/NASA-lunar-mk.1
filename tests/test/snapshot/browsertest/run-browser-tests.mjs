import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = [
  'test-overview-focus.mjs',
  'test-route-ui.mjs',
  'test-scene.mjs'
];

let failed = 0;

for (const test of tests) {
  const testPath = path.join(here, test);
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [testPath], {
    stdio: 'inherit',
    cwd: path.dirname(here)
  });

  if (result.status !== 0) {
    failed++;
    console.error(`FAILED: ${test} (exit code ${result.status})`);
  } else {
    console.log(`PASSED: ${test}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} browser test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll browser tests passed.');
}
