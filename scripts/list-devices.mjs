#!/usr/bin/env node
import {
  buildGithubMatrix,
  loadAllDevices,
  loadIndex,
  readBuildrootVersion,
} from "./lib/devices.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        index += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const index = await loadIndex();
const arch = args.arch || index.defaultArch;
const deviceId = args.device || "all";
// `--allow-draft` (ou ALLOW_DRAFT=1) inclui rascunhos que já declaram
// buildrootDefconfig. É o que permite tentar um aparelho novo no CI antes de
// ligá-lo na matriz normal.
const allowDraft = Boolean(args["allow-draft"]) || process.env.ALLOW_DRAFT === "1";

try {
  if (args["github-matrix"]) {
    const matrix = await buildGithubMatrix({ arch, deviceId, allowDraft });
    process.stdout.write(`${JSON.stringify(matrix)}\n`);
  } else {
    const { devices, errors } = await loadAllDevices();
    console.log("Giochi System — dispositivos");
    console.log(`Buildroot: ${await readBuildrootVersion()}`);
    for (const device of devices) {
      const state = device.enabled ? "enabled" : "disabled";
      console.log(
        `  ${device.id.padEnd(18)} ${device.arch.padEnd(7)} ${state.padEnd(9)} ${device.status.padEnd(6)} ${device.name}`,
      );
    }
    if (errors.length) {
      for (const error of errors) console.error(`\nERRO: ${error.message}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`list-devices: ${error.message}`);
  process.exitCode = 1;
}
