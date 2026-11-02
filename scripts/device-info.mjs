#!/usr/bin/env node
import path from "node:path";
import { loadDevice } from "./lib/devices.mjs";

const [id, field = "json"] = process.argv.slice(2);

if (!id) {
  console.error("Uso: node scripts/device-info.mjs <device-id> [campo]");
  process.exit(2);
}

const device = await loadDevice(id);

switch (field) {
  case "json":
    console.log(
      JSON.stringify(
        {
          ...device,
          directory: path.relative(process.cwd(), device.directory) || ".",
        },
        null,
        2,
      ),
    );
    break;
  case "defconfig":
    console.log(device.buildrootDefconfig);
    break;
  case "fragment":
    console.log(path.join(device.directory, device.buildrootFragment));
    break;
  case "overlays":
    for (const overlay of device.rootfsOverlays) {
      console.log(path.join(device.directory, overlay));
    }
    break;
  case "artifacts":
    for (const artifact of device.artifacts) {
      console.log(artifact);
    }
    break;
  case "hostname":
    console.log(device.hostname);
    break;
  case "name":
    console.log(device.name);
    break;
  case "arch":
    console.log(device.arch);
    break;
  case "folder":
    console.log(device.folder);
    break;
  case "enabled":
    console.log(String(device.enabled));
    break;
  case "runner":
    console.log(device.runner);
    break;
  case "timeout":
    console.log(String(device.timeoutMinutes));
    break;
  case "docs":
    console.log(path.join(device.directory, device.docs));
    break;
  default:
    console.error(`Campo desconhecido: ${field}`);
    process.exit(2);
}
