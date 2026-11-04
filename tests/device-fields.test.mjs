import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT, validateDevice } from "../scripts/lib/devices.mjs";

// Contrato de `buildrootFragments` e `firmwareFiles` (device/README.md).
//
// Os dois eram documentados desde o começo e **nenhum script lia**. Um aparelho
// que declarasse "firmwareFiles": ["firmware"] receberia build verde e imagem
// sem o blob, e o sintoma no aparelho é `Direct firmware load ... failed with
// error -2` — que não cita o device.json. É a mesma classe do §12.1: o build
// não tem como saber que o campo foi ignorado.
//
// Aqui se testa o contrato de três peças: o validador (declarar arquivo que não
// existe falha), o leitor usado pelo shell (device-info.mjs) e o build (ordem
// dos fragmentos e destino do firmware).

const BUILD_SCRIPT = path.join(ROOT, "scripts/build-device.sh");
const DEVICE_INFO = path.join(ROOT, "scripts/device-info.mjs");

async function makeDevice(extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-device-"));
  await mkdir(path.join(dir, "rootfs-overlay"), { recursive: true });
  await writeFile(path.join(dir, "buildroot.fragment"), "BR2_TARGET_GENERIC_HOSTNAME=\"x\"\n");
  await writeFile(path.join(dir, "README.md"), "doc\n");
  return {
    dir,
    device: {
      schemaVersion: 1,
      id: "test-device",
      name: "Test Device",
      description: "aparelho sintético só para teste de schema",
      arch: "arm64",
      hostname: "giochi-test",
      buildrootDefconfig: "",
      buildrootFragment: "buildroot.fragment",
      rootfsOverlays: ["rootfs-overlay"],
      artifacts: ["Image"],
      runner: "ubuntu-24.04",
      timeoutMinutes: 120,
      status: "draft",
      docs: "README.md",
      directory: dir,
      folder: "test-device",
      enabled: false,
      ...extra,
    },
  };
}

test("device.json mínimo continua válido com os campos novos ausentes", async () => {
  const { device } = await makeDevice();
  assert.deepEqual(await validateDevice(device), []);
});

test("buildrootFragments declarado e existente passa", async () => {
  const { dir, device } = await makeDevice();
  await writeFile(path.join(dir, "buildroot.panel.fragment"), "BR2_PACKAGE_X=y\n");
  device.buildrootFragments = ["buildroot.panel.fragment"];
  assert.deepEqual(await validateDevice(device), []);
});

test("buildrootFragments apontando para arquivo inexistente falha", async () => {
  const { device } = await makeDevice({
    buildrootFragments: ["buildroot.nao-existe.fragment"],
  });
  const errors = await validateDevice(device);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /fragmento por área não encontrado: buildroot\.nao-existe\.fragment/);
});

test("buildrootFragments com caminho absoluto ou travessia é recusado", async () => {
  const { device } = await makeDevice({ buildrootFragments: ["/etc/passwd"] });
  const errors = await validateDevice(device);
  assert.ok(errors.some((message) => /caminho relativo seguro/.test(message)));

  device.buildrootFragments = ["../../etc/passwd"];
  const traversal = await validateDevice(device);
  assert.ok(traversal.some((message) => /caminho relativo seguro/.test(message)));
});

test("firmwareFiles pode ser arquivo ou diretório", async () => {
  const { dir, device } = await makeDevice();
  await mkdir(path.join(dir, "firmware", "rtl_bt"), { recursive: true });
  await writeFile(path.join(dir, "firmware", "rtl_bt", "rtl8821cs_config.bin"), "x");
  await writeFile(path.join(dir, "extra.bin"), "x");
  device.firmwareFiles = ["firmware", "extra.bin"];
  assert.deepEqual(await validateDevice(device), []);
});

test("firmwareFiles inexistente falha em vez de virar imagem sem o blob", async () => {
  const { device } = await makeDevice({ firmwareFiles: ["firmware"] });
  const errors = await validateDevice(device);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /firmware não encontrado: firmware/);
});

test("os devices reais continuam válidos com a validação nova", async () => {
  const { loadDevice, loadIndex } = await import("../scripts/lib/devices.mjs");
  const index = await loadIndex();
  for (const entry of index.devices) {
    const device = await loadDevice(entry.id, index);
    assert.deepEqual(await validateDevice(device), [], `device ${entry.id}`);
  }
});

test("device-info.mjs expõe os dois campos novos", async () => {
  const text = await readFile(DEVICE_INFO, "utf8");
  assert.match(text, /case "buildrootFragments":/);
  assert.match(text, /case "firmwareFiles":/);
  // O shell consome por linha; um JSON aqui obrigaria parse no sed.
  for (const field of ["buildrootFragments", "firmwareFiles"]) {
    const branch = text.slice(text.indexOf(`case "${field}":`));
    assert.match(
      branch.slice(0, 400),
      /console\.log\(path\.join\(device\.directory/,
      `${field} precisa imprimir caminho absoluto por linha`,
    );
  }
});

test("o build aplica fragmentos por área DEPOIS do fragmento principal", async () => {
  const text = await readFile(BUILD_SCRIPT, "utf8");
  const common = text.indexOf('--fragment "$ROOT/config/common.fragment"');
  const main = text.indexOf('--fragment "$FRAGMENT"');
  const extras = text.indexOf('${EXTRA_FRAGMENT_ARGS[@]');
  assert.ok(common > 0 && main > common, "ordem esperada: common antes do principal");
  assert.ok(
    extras > main,
    "fragmentos por área (buildrootFragments) precisam vir depois de buildroot.fragment",
  );
});

test("o build copia firmware para /lib/firmware preservando a subpasta", async () => {
  const text = await readFile(BUILD_SCRIPT, "utf8");
  assert.match(text, /FIRMWARE_OVERLAY="\$OVERLAY_STAGE\/02-firmware"/);
  assert.match(text, /mkdir -p "\$FIRMWARE_OVERLAY\/lib\/firmware"/);
  // Diretório declarado: o conteúdo é que vale, senão `firmware/rtl_bt/x.bin`
  // viraria `lib/firmware/firmware/rtl_bt/x.bin` e o driver não acharia.
  assert.match(text, /cp -a "\$firmware_path\/\." "\$FIRMWARE_OVERLAY\/lib\/firmware\/"/);
  // E o overlay precisa ser ANEXADO à lista, não substituí-la.
  assert.match(text, /OVERLAY_ARGS\+=\(--overlay "\$FIRMWARE_OVERLAY"\)/);
});

test("firmware entra num overlay separado do device, e é limpo a cada build", async () => {
  const text = await readFile(BUILD_SCRIPT, "utf8");
  const wipe = text.indexOf('rm -rf "$OVERLAY_STAGE"');
  const firmware = text.indexOf('FIRMWARE_OVERLAY="$OVERLAY_STAGE/02-firmware"');
  assert.ok(wipe > 0, "o staging precisa ser recriado (§12.18)");
  assert.ok(
    firmware > wipe,
    "o firmware é copiado DEPOIS da limpeza, senão um build anterior sobrevive",
  );
});

test("device/README.md não promete mais campo sem leitor", async () => {
  // O README é a documentação que alguém segue para criar aparelho novo. Se ele
  // listar um campo que nenhum script lê, o resultado é imagem errada e verde.
  const readme = await readFile(path.join(ROOT, "device/README.md"), "utf8");
  const buildText = await readFile(BUILD_SCRIPT, "utf8");
  const devicesText = await readFile(path.join(ROOT, "scripts/lib/devices.mjs"), "utf8");
  const infoText = await readFile(DEVICE_INFO, "utf8");

  for (const field of ["buildrootFragments", "kernelPatches", "firmwareFiles"]) {
    assert.match(readme, new RegExp(`"${field}"`), `README deve declarar ${field}`);
    assert.match(devicesText, new RegExp(`device\\.${field}`), `${field} precisa de validação`);
    assert.match(infoText, new RegExp(`case "${field}":`), `${field} precisa de leitor`);
    assert.match(buildText, new RegExp(field), `${field} precisa ser consumido pelo build`);
  }
});
