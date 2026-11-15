'use strict';
const { spawnSync } = require('node:child_process');
let failed = false;
// Sequential: each browser check owns the same local preview port. Run every
// suite even after a failure so one CI run reports all independent regressions.
for (const file of ['ui', 'navigation-regressions', 'group-management', 'appearance-settings']) {
  const result = spawnSync(process.execPath, [`test/${file}.cjs`], { stdio: 'inherit' });
  if (result.error || result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
