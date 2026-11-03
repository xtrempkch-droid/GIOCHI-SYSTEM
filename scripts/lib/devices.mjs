import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEVICE_ROOT = path.join(ROOT, "device");
export const DEVICES_INDEX = path.join(DEVICE_ROOT, "devices.json");
export const BUILDROOT_VERSION_FILE = path.join(ROOT, "buildroot.version");

const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DEFCONFIG_RE = /^[a-z0-9][a-z0-9_]*_defconfig$/;
const ARCHES = new Set(["arm64", "x86_64", "arm"]);
const STATUSES = new Set(["ready", "draft"]);

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)}: JSON inválido (${error.message})`);
  }
}

function assertRelativePath(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} deve ser uma string não vazia.`);
  }
  if (path.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`${field} deve ser um caminho relativo seguro: ${value}`);
  }
}

function assertSafeFolder(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("folder deve ser uma string não vazia.");
  }
  if (value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new Error(`folder inválido: ${value}`);
  }
}

export async function readBuildrootVersion() {
  const version = (await readFile(BUILDROOT_VERSION_FILE, "utf8")).trim();
  if (!/^\d{4}\.\d{2}(?:\.\d+)?$/.test(version)) {
    throw new Error(
      `buildroot.version inválido: "${version}". Use algo como 2024.02.`,
    );
  }
  return version;
}

export async function loadIndex() {
  const index = await readJson(DEVICES_INDEX);
  if (index.schemaVersion !== 1) {
    throw new Error("device/devices.json: schemaVersion deve ser 1.");
  }
  if (!Array.isArray(index.devices) || index.devices.length === 0) {
    throw new Error("device/devices.json: devices deve ser um array não vazio.");
  }
  if (!ARCHES.has(index.defaultArch)) {
    throw new Error(`device/devices.json: defaultArch inválido: ${index.defaultArch}`);
  }

  const ids = new Set();
  const folders = new Set();

  for (const entry of index.devices) {
    if (!entry || typeof entry !== "object") {
      throw new Error("device/devices.json: cada item de devices deve ser um objeto.");
    }
    if (!ID_RE.test(entry.id || "")) {
      throw new Error(`device/devices.json: id inválido: ${entry.id}`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`device/devices.json: id duplicado: ${entry.id}`);
    }
    ids.add(entry.id);

    assertSafeFolder(entry.folder);
    if (folders.has(entry.folder)) {
      throw new Error(`device/devices.json: folder duplicada: ${entry.folder}`);
    }
    folders.add(entry.folder);

    if (!ARCHES.has(entry.arch)) {
      throw new Error(`device/devices.json: arch inválido para ${entry.id}: ${entry.arch}`);
    }
    if (typeof entry.enabled !== "boolean") {
      throw new Error(`device/devices.json: enabled deve ser booleano em ${entry.id}.`);
    }
  }

  return index;
}

export function devicePath(entry) {
  const directory = path.resolve(DEVICE_ROOT, entry.folder);
  const prefix = `${path.resolve(DEVICE_ROOT)}${path.sep}`;
  if (!directory.startsWith(prefix)) {
    throw new Error(`Caminho de dispositivo fora de device/: ${entry.folder}`);
  }
  return directory;
}

export async function loadDevice(id, index = null) {
  const sourceIndex = index || (await loadIndex());
  const entry = sourceIndex.devices.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Dispositivo não encontrado em device/devices.json: ${id}`);
  }

  const directory = devicePath(entry);
  if (!(await pathExists(directory))) {
    throw new Error(`Pasta do dispositivo não existe: ${path.relative(ROOT, directory)}`);
  }

  const filePath = path.join(directory, "device.json");
  if (!(await pathExists(filePath))) {
    throw new Error(`device.json não encontrado em ${path.relative(ROOT, directory)}`);
  }

  const config = await readJson(filePath);
  const device = {
    ...config,
    id: entry.id,
    folder: entry.folder,
    arch: entry.arch,
    enabled: entry.enabled,
    directory,
    relativeDirectory: path.relative(ROOT, directory),
  };

  const errors = await validateDevice(device);
  if (errors.length > 0) {
    const error = new Error(
      `Configuração inválida para ${id}:\n- ${errors.join("\n- ")}`,
    );
    error.errors = errors;
    throw error;
  }

  return device;
}

export async function validateDevice(device) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(device.schemaVersion === 1, "schemaVersion deve ser 1.");
  require(ID_RE.test(device.id || ""), `id inválido: ${device.id}`);
  require(
    typeof device.name === "string" && device.name.trim().length >= 2,
    "name deve ter pelo menos 2 caracteres.",
  );
  require(
    typeof device.description === "string" && device.description.trim().length >= 10,
    "description deve ter pelo menos 10 caracteres.",
  );
  require(ARCHES.has(device.arch), `arch inválido: ${device.arch}`);
  require(HOSTNAME_RE.test(device.hostname || ""), `hostname inválido: ${device.hostname}`);
  require(STATUSES.has(device.status), `status deve ser ready ou draft: ${device.status}`);
  require(
    typeof device.buildrootDefconfig === "string",
    "buildrootDefconfig deve ser string (vazia em drafts).",
  );

  if (device.buildrootDefconfig) {
    require(
      DEFCONFIG_RE.test(device.buildrootDefconfig),
      `buildrootDefconfig inválido: ${device.buildrootDefconfig}`,
    );
  }

  if (device.enabled) {
    require(device.status === "ready", "device habilitado precisa ter status ready.");
    require(
      Boolean(device.buildrootDefconfig),
      "device habilitado precisa de um buildrootDefconfig.",
    );
  }

  require(
    typeof device.runner === "string" && /^[A-Za-z0-9._-]+$/.test(device.runner),
    `runner inválido: ${device.runner}`,
  );
  require(
    Number.isInteger(device.timeoutMinutes) &&
      device.timeoutMinutes >= 60 &&
      device.timeoutMinutes <= 360,
    "timeoutMinutes deve ser inteiro entre 60 e 360.",
  );

  try {
    assertRelativePath(device.buildrootFragment, "buildrootFragment");
    const fragmentPath = path.join(device.directory, device.buildrootFragment);
    require(await pathExists(fragmentPath), `fragmento não encontrado: ${device.buildrootFragment}`);
  } catch (error) {
    errors.push(error.message);
  }

  require(
    Array.isArray(device.rootfsOverlays) && device.rootfsOverlays.length > 0,
    "rootfsOverlays deve ser um array não vazio.",
  );
  if (Array.isArray(device.rootfsOverlays)) {
    for (const overlay of device.rootfsOverlays) {
      try {
        assertRelativePath(overlay, "rootfsOverlays[]");
        const overlayPath = path.join(device.directory, overlay);
        require(await pathExists(overlayPath), `overlay não encontrado: ${overlay}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  require(
    Array.isArray(device.artifacts) && device.artifacts.length > 0,
    "artifacts deve ser um array não vazio.",
  );
  if (Array.isArray(device.artifacts)) {
    for (const artifact of device.artifacts) {
      require(
        typeof artifact === "string" && artifact.length > 0 && !artifact.includes(".."),
        `artifact inválido: ${artifact}`,
      );
    }
  }

  try {
    assertRelativePath(device.docs, "docs");
    const docsPath = path.join(device.directory, device.docs);
    require(await pathExists(docsPath), `documentação não encontrada: ${device.docs}`);
  } catch (error) {
    errors.push(error.message);
  }

  return errors;
}

export async function getBuildableDevices({ arch = null, deviceId = "all", allowDraft = false } = {}) {
  const index = await loadIndex();
  const targetArch = arch || index.defaultArch;

  let entries = index.devices.filter(
    (entry) => entry.enabled && entry.arch === targetArch,
  );

  if (deviceId && deviceId !== "all") {
    const entry = index.devices.find((item) => item.id === deviceId);
    if (!entry) throw new Error(`Dispositivo não encontrado: ${deviceId}`);
    if (!entry.enabled && !allowDraft) {
      throw new Error(
        `Dispositivo desabilitado: ${deviceId}. ` +
          `Para construir um rascunho, peça este id (não "all") e ligue o ` +
          `allow_draft — no CI é a entrada allow_draft="true"; local é ALLOW_DRAFT=1.`,
      );
    }
    if (entry.arch !== targetArch) {
      throw new Error(
        `Dispositivo ${deviceId} é ${entry.arch}, mas o filtro é ${targetArch}.`,
      );
    }
    entries = [entry];
  }

  if (entries.length === 0) {
    throw new Error(
      `Nenhum dispositivo habilitado para arch=${targetArch}. Verifique device/devices.json.`,
    );
  }

  const devices = [];
  for (const entry of entries) {
    const device = await loadDevice(entry.id, index);
    // Um rascunho entra na matriz por dois critérios: precisa ser pedido pelo
    // id (`--device`) e precisa declarar defconfig. `device=all` NUNCA puxa
    // rascunho, nem com allowDraft: tentar todos os rascunhos de uma vez é
    // como se perde uma tarde. Sem defconfig o job falharia antes de compilar,
    // e um CI vermelho por rascunho treina todo mundo a ignorar o vermelho.
    if (!device.enabled && !(allowDraft && deviceId !== "all" && device.buildrootDefconfig)) {
      continue;
    }
    devices.push(device);
  }

  if (devices.length === 0) {
    throw new Error(
      `Nenhum dispositivo construível para arch=${targetArch}.` +
        (allowDraft
          ? " Nenhum rascunho desta arquitetura declara buildrootDefconfig."
          : " Verifique device/devices.json ou use --allow-draft."),
    );
  }
  return devices;
}

export async function buildGithubMatrix({ arch = null, deviceId = "all", allowDraft = false } = {}) {
  const devices = await getBuildableDevices({ arch, deviceId, allowDraft });
  return {
    include: devices.map((device) => ({
      device: device.id,
      name: device.name,
      arch: device.arch,
      runner: device.runner,
      timeout: device.timeoutMinutes,
    })),
  };
}

export async function loadAllDevices() {
  const index = await loadIndex();
  const devices = [];
  const errors = [];
  for (const entry of index.devices) {
    try {
      devices.push(await loadDevice(entry.id, index));
    } catch (error) {
      errors.push(error);
    }
  }
  return { index, devices, errors };
}

export { ARCHES, ID_RE, HOSTNAME_RE, DEFCONFIG_RE };
