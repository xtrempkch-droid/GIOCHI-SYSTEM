#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadDevice } from "./lib/devices.mjs";
import { buildKernelCmdline, validateCmdlineSpec } from "./lib/cmdline.mjs";

const argv = process.argv.slice(2);

// `--partuuid` é opcional: sem ele a cmdline sai com um marcador, o que serve
// para documentação e teste. Com ele (é o que o make-sd-image.sh faz) sai a
// linha que vai para o extlinux.conf e o boot.scr.
let partuuid = undefined;
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--partuuid") {
    partuuid = argv[i + 1];
    i += 1;
  } else if (arg.startsWith("--partuuid=")) {
    partuuid = arg.slice("--partuuid=".length);
  } else {
    positional.push(arg);
  }
}

const [id, field = "json"] = positional;

if (!id) {
  console.error("Uso: node scripts/device-info.mjs <device-id> [campo] [--partuuid <uuid>]");
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
  case "dtsPaths":
    for (const dtsPath of device.dtsPaths ?? []) {
      console.log(dtsPath);
    }
    break;
  case "buildrootFragments":
    for (const extra of device.buildrootFragments ?? []) {
      console.log(path.join(device.directory, extra));
    }
    break;
  case "firmwareFiles":
    for (const firmware of device.firmwareFiles ?? []) {
      console.log(path.join(device.directory, firmware));
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
  case "cmdline": {
    const errors = validateCmdlineSpec(device.kernelCmdline);
    if (errors.length > 0) {
      for (const message of errors) {
        console.error(`  ${message}`);
      }
      process.exit(2);
    }
    console.log(
      buildKernelCmdline(device.kernelCmdline, {
        partuuid: partuuid ?? "<PARTUUID>",
      }),
    );
    break;
  }
  default:
    console.error(`Campo desconhecido: ${field}`);
    process.exit(2);
}
