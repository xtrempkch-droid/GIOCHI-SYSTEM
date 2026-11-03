#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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
  case "kernelPatches":
    for (const patchPath of device.kernelPatches ?? []) {
      console.log(path.join(device.directory, patchPath));
    }
    break;
  case "dts": {
    // O nome do DTB vem do defconfig do aparelho, não de um campo extra no
    // device.json: duas fontes para a mesma informação divergem em silêncio, e
    // aqui a divergência significa gravar o DTB de outro painel no cartão.
    const defconfigPath = path.join(device.directory, "defconfig");
    if (!existsSync(defconfigPath)) {
      process.exit(2);
    }
    const match = readFileSync(defconfigPath, "utf8").match(
      /^BR2_LINUX_KERNEL_INTREE_DTS_NAME="?([^"\s]+)"?$/m,
    );
    if (!match) {
      process.exit(2);
    }
    console.log(path.basename(match[1]));
    break;
  }
  default:
    console.error(`Campo desconhecido: ${field}`);
    process.exit(2);
}
