import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, loadDevice } from "../scripts/lib/devices.mjs";
import { buildKernelCmdline, validateCmdlineSpec } from "../scripts/lib/cmdline.mjs";

// A cmdline do kernel era um literal dentro do make-sd-image.sh. Enquanto havia
// um aparelho só, tudo bem. No segundo, o literal herdado da X55 produz um
// cartão que boota e não mostra console — sem uma linha de erro em lugar nenhum.
// Estes testes existem para que a cmdline seja derivada do aparelho e para que a
// da X55 continue EXATAMENTE igual à que bootou em hardware.

const PARTUUID = "47494f43-02";

// Valor que estava cravado no script e que bootou na X55 em hardware real.
const X55_ESPERADO =
  "root=PARTUUID=47494f43-02 rootwait rw rootfstype=ext4 " +
  "console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xfe660000 fbcon=rotate:3";

test("a cmdline da X55 é idêntica à que bootou em hardware", async () => {
  const device = await loadDevice("powkiddy-x55");
  assert.equal(buildKernelCmdline(device.kernelCmdline, { partuuid: PARTUUID }), X55_ESPERADO);
});

test("make-sd-image.sh não tem mais cmdline cravada no código", async () => {
  const script = await readFile(path.join(ROOT, "scripts/make-sd-image.sh"), "utf8");
  assert.doesNotMatch(
    script,
    /^KERNEL_CMDLINE="/m,
    "voltou a existir literal de cmdline: o console de um aparelho vaza para o outro",
  );
  assert.match(script, /device-info\.mjs"?\s*"?\$?DEVICE_ID"?\s*"?cmdline/);
});

test("aparelho usado para gerar imagem precisa declarar kernelCmdline", async () => {
  // Só a X55 e o QEMU geram imagem hoje; os drafts ainda não sabem a UART.
  for (const id of ["powkiddy-x55", "qemu-aarch64"]) {
    const device = await loadDevice(id);
    assert.equal(
      validateCmdlineSpec(device.kernelCmdline).length,
      0,
      `${id} tem kernelCmdline inválido ou ausente`,
    );
  }
});

test("draft sem kernelCmdline é aceito pelo schema (e recusado na hora da imagem)", async () => {
  // X35S ainda não gerou imagem e a UART dele não foi medida. Não é erro da
  // árvore: é uma decisão registrada. O gate real é o make-sd-image.sh, que
  // falha antes de gravar qualquer byte.
  const device = await loadDevice("powkiddy-x35s");
  assert.equal(device.kernelCmdline, undefined);
});

test("console sem baud não inventa velocidade", () => {
  const line = buildKernelCmdline({ console: "ttyFIQ0" }, { partuuid: PARTUUID });
  assert.match(line, /console=ttyFIQ0(?: |$)/);
  assert.doesNotMatch(line, /console=ttyFIQ0,/);
});

test("baud explícito sai em 8N1", () => {
  const line = buildKernelCmdline(
    { console: "ttyS2", baud: 115200 },
    { partuuid: PARTUUID },
  );
  assert.match(line, /console=ttyS2,115200n8/);
});

test("fbconRotate:0 é respeitado e não confundido com ausência", () => {
  const comZero = buildKernelCmdline(
    { console: "ttyS2", fbconRotate: 0 },
    { partuuid: PARTUUID },
  );
  const semCampo = buildKernelCmdline({ console: "ttyS2" }, { partuuid: PARTUUID });
  assert.match(comZero, /fbcon=rotate:0/);
  assert.doesNotMatch(semCampo, /fbcon=rotate/);
});

test("video= é passado adiante para saídas com mode setting", () => {
  const line = buildKernelCmdline(
    { console: "ttyS2", video: "HDMI-A-1:800x600@60" },
    { partuuid: PARTUUID },
  );
  assert.match(line, /video=HDMI-A-1:800x600@60/);
});

test("rootfstype/rootwait/rw podem ser desligados", () => {
  const line = buildKernelCmdline(
    { console: "ttyS2", rootwait: false, rw: false, rootfstype: "f2fs" },
    { partuuid: PARTUUID },
  );
  assert.equal(line, "root=PARTUUID=47494f43-02 rootfstype=f2fs console=ttyS2");
});

test("sem partuuid a composição falha em vez de gerar cmdline sem root", () => {
  assert.throws(() => buildKernelCmdline({ console: "ttyS2" }), /partuuid/);
});

test("validação rejeita os erros que já custaram tempo neste projeto", async () => {
  const casos = [
    [{ baud: 1500000 }, /console/],
    [{ console: "tty S2" }, /console/],
    [{ console: "ttyS2", baud: 1500000.5 }, /baud/],
    [{ console: "ttyS2", earlycon: "0xfe660000" }, /earlycon/],
    [{ console: "ttyS2", fbconRotate: 4 }, /fbconRotate/],
    [{ console: "ttyS2", video: "HDMI-A-1:800x600 @60" }, /video/],
    [{ console: "ttyS2", rotate: 3 }, /desconhecido/],
  ];
  for (const [spec, esperado] of casos) {
    const mensagens = validateCmdlineSpec(spec).join("\n");
    assert.match(mensagens, esperado, `não recusou ${JSON.stringify(spec)}`);
  }
});

test("campo desconhecido não passa em silêncio", () => {
  // `fbconrotate` em minúsculas seria ignorado e a tela sairia deitada.
  const mensagens = validateCmdlineSpec({ console: "ttyS2", fbconrotate: 3 }).join("\n");
  assert.match(mensagens, /desconhecido/);
});
