/**
 * tests/global-setup.ts — runs once in the main Vitest process, around the whole run.
 *
 * Each worker writes its uploads under TEST_UPLOADS_ROOT (see tests/setup.ts). Workers can be
 * stopped without their exit handlers running, so the folder is cleared here instead: before
 * the run, in case an earlier one was interrupted, and after it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEST_UPLOADS_ROOT = path.join(os.tmpdir(), 'opticapture-test-uploads');

const clear = () => fs.rmSync(TEST_UPLOADS_ROOT, { recursive: true, force: true });

export default function setup() {
  clear();
  return clear;
}
