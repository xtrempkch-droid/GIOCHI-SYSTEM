#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import {
  DEVICE_ROOT,
  ROOT,
  loadAllDevices,
  readBuildrootVersion,
} from "./lib/devices.mjs";

const required = [
  path.join(ROOT, "config", "common.fragment"),
  path.join(DEVICE_ROOT, "common", "rootfs-overlay"),
  path.join(ROOT, "buildroot.version"),
];

let failed = false;

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

console.log("Giochi System — validação da árvore de dispositivos\n");

for (const target of required) {
  if (!(await exists(target))) {
    console.error(`ERRO: arquivo/pasta obrigatório ausente: ${path.relative(ROOT, target)}`);
    failed = true;
  }
}

let version = "";
try {
  version = await readBuildrootVersion();
  console.log(`Buildroot fixado em ${version}.`);
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  failed = true;
}

const { index, devices, errors } = await loadAllDevices();

if (errors.length) {
  failed = true;
  for (const error of errors) {
    console.error(`\nERRO: ${error.message}`);
  }
}

for (const device of devices) {
  const marker = device.enabled ? "BUILD" : "draft ";
  console.log(
    `  ${marker}  ${device.id.padEnd(18)} ${device.arch.padEnd(7)} ${device.status.padEnd(6)} ${device.name}`,
  );
}

const enabled = index.devices.filter((device) => device.enabled);
if (enabled.length === 0) {
  console.error("\nERRO: nenhum dispositivo habilitado em device/devices.json.");
  failed = true;
}

for (const entry of enabled) {
  const device = devices.find((item) => item.id === entry.id);
  if (!device) {
    console.error(`\nERRO: dispositivo habilitado não carregado: ${entry.id}`);
    failed = true;
    continue;
  }
  if (device.arch !== entry.arch) {
    console.error(`\nERRO: arch do índice e do device.json divergem em ${entry.id}`);
    failed = true;
  }
  if (device.status !== "ready") {
    console.error(`\nERRO: dispositivo habilitado precisa estar ready: ${entry.id}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nValidação falhou.");
  process.exitCode = 1;
} else {
  console.log(
    `\nOK: ${devices.length} dispositivo(s), ${enabled.length} habilitado(s) para build.`,
  );
}
