#!/usr/bin/env node

import fs from "node:fs";
import { executeManager, UsageError } from "../scripts/manage-agents.mjs";

const args = process.argv.slice(2);
let home = null;
let bundleRoot = null;
let tamperStateBeforeApply = false;
const forwarded = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--home") home = args[++index];
  else if (args[index] === "--bundle-root") bundleRoot = args[++index];
  else if (args[index] === "--tamper-state-before-apply") tamperStateBeforeApply = true;
  else forwarded.push(args[index]);
}

try {
  const result = executeManager(forwarded, {
    home,
    bundleRoot,
    beforeApply: tamperStateBeforeApply
      ? ({ locations }) => fs.appendFileSync(locations.stateFile, "\n", "utf8")
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
