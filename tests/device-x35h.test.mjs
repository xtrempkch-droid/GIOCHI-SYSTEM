import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, loadDevice } from "../scripts/lib/devices.mjs";

// A X35H é a primeira vez que este repositório deriva um aparelho de outro já
// que bootou. A tentação é copiar a pasta da X55 e "ajustar" — e o que se perde
// nesse ajuste é justamente o que identifica o aparelho: o DTS, o defconfig,
// os patches. Um build verde com a identidade da X55 gera um cartão que não
// liga (ou pior, liga com o painel errado).
//
// Estes testes travam a identidade: o que o device.json declara é o que os
// arquivos contêm, e nada aponta para o aparelho vizinho.

const DIR = path.join(ROOT, "device/powkiddy x35h");
const X55 = path.join(ROOT, "device/powkiddy x55");

test("X35H e X35S são RK3566; o R35S é que é RK3326", async () => {
  // O AGENTS.md já disse RK3326 para o X35H, o que mandaria o build para outro
  // pipeline de boot (DDR init e U-Boot diferentes). Fonte: device.conf medido
  // no antecessor (GIOCHI_SOC=rk3566).
  for (const id of ["powkiddy-x35h", "powkiddy-x35s"]) {
    const device = await loadDevice(id);
    assert.equal(device.arch, "arm64", `${id}: arch inesperada`);
  }
  const readme = await readFile(path.join(DIR, "README.md"), "utf8");
  assert.match(readme, /RK3566/);
  assert.doesNotMatch(readme, /RK3326/, "o README do X35H cita o SoC do R35S");
});

test("o defconfig aponta para o DTS do X35H, não para o da X55", async () => {
  const defconfig = await readFile(path.join(DIR, "defconfig"), "utf8");
  assert.match(
    defconfig,
    /^BR2_LINUX_KERNEL_INTREE_DTS_NAME="rockchip\/rk3566-powkiddy-x35h"$/m,
  );
  assert.doesNotMatch(
    defconfig,
    /INTREE_DTS_NAME="[^"]*x55/,
    "o DTB da X55 no defconfig da X35H gravaria o painel errado no cartão",
  );
});

test("o U-Boot usa o defconfig genérico, porque o mainline não tem o do X35H", async () => {
  const defconfig = await readFile(path.join(DIR, "defconfig"), "utf8");
  assert.match(defconfig, /^BR2_TARGET_UBOOT_BOARD_DEFCONFIG="anbernic-rgxx3-rk3566"$/m);
});

test("o painel do fragmento é ST7703, e não o HX8394 da X55", async () => {
  const fragment = await readFile(path.join(DIR, "linux.fragment"), "utf8");
  assert.match(fragment, /^CONFIG_DRM_PANEL_SITRONIX_ST7703=y$/m);
  // Comentário pode (e deve) explicar a troca; o que não pode existir é a
  // ATRIBUIÇÃO, que é o que muda o .config do kernel.
  assert.doesNotMatch(
    fragment,
    /^CONFIG_DRM_PANEL_HIMAX_HX8394=/m,
    "o HX8394 é o painel da X55; aqui daria tela preta com backlight aceso",
  );
  const required = await readFile(path.join(DIR, "kernel-required.txt"), "utf8");
  assert.match(required, /^CONFIG_DRM_PANEL_SITRONIX_ST7703=y$/m);
});

test("sem rádio: nenhum driver de Wi-Fi/BT no fragmento", async () => {
  const fragment = await readFile(path.join(DIR, "linux.fragment"), "utf8");
  // Comentários podem (e devem) mencionar os símbolos; o que não pode existir é
  // a atribuição, que é o que muda o .config do kernel.
  for (const symbol of ["CONFIG_RTW88", "CONFIG_BT_HCIUART", "CONFIG_BT="]) {
    const ativo = new RegExp(`^${symbol.replace("=", "=")}\\S*=`, "m");
    assert.doesNotMatch(fragment, ativo, `${symbol} voltou ao fragmento da X35H`);
  }
});

test("os patches declarados existem e são os do X35H", async () => {
  const device = await loadDevice("powkiddy-x35h");
  assert.ok(Array.isArray(device.kernelPatches) && device.kernelPatches.length === 2);
  for (const patchPath of device.kernelPatches) {
    const text = await readFile(path.join(DIR, patchPath), "utf8");
    assert.match(text, /^diff --git /m, `${patchPath} não é um diff`);
    // Um patch que toca o DTS/painel da X55 seria aplicado no lugar errado.
    assert.doesNotMatch(
      text,
      /^\+\+\+ b\/arch\/arm64\/boot\/dts\/rockchip\/rk3566-powkiddy-x55\.dts$/m,
      `${patchPath} modifica o DTS da X55`,
    );
  }
});

test("o DTS novo herda o da X55 em vez de duplicar 1000 linhas", async () => {
  const patch = await readFile(
    path.join(DIR, "patches/0001-giochi-system-x35h-dts.patch"),
    "utf8",
  );
  const linhas = patch.split("\n").filter((l) => l.startsWith("+"));
  assert.ok(
    linhas.some((l) => /#include "rk3566-powkiddy-x55\.dts"/.test(l)),
    "o DTS do X35H precisa incluir o da X55; copiar o arquivo inteiro divergiria em silêncio",
  );
  assert.ok(
    linhas.some((l) => /compatible = "powkiddy,x35h"/.test(l)),
    "falta o compatible próprio",
  );
  assert.ok(
    linhas.some((l) => /charge-full-design-microamp-hours = <3000000>/.test(l)),
    "bateria de 3000 mAh (medida), não os 4000 mAh da X55",
  );
  assert.ok(
    linhas.some((l) => /rotation = <0>/.test(l)),
    "a X35H não é rotacionada; herdar 270 da X55 deitaria a tela",
  );
});

test("o driver do painel entra por um compatible novo, não por driver externo", async () => {
  const patch = await readFile(
    path.join(DIR, "patches/0002-giochi-system-x35h-panel-st7703.patch"),
    "utf8",
  );
  assert.match(patch, /panel-sitronix-st7703\.c/);
  assert.match(patch, /\.compatible = "powkiddy,x35h-panel"/);
  assert.match(patch, /\.init_sequence = powkiddy_x35h_panel_init_sequence/);
  assert.doesNotMatch(
    patch,
    /compatible = "rocknix,generic-dsi"/,
    "o driver fora da árvore da ROCKNIX não entra: o mainline cobre o ST7703",
  );
  // A temporização medida: 640x480 a 30 MHz fecha em ~58,5 Hz.
  assert.match(patch, /\.hdisplay\s*= 640,/);
  assert.match(patch, /\.vdisplay\s*= 480,/);
  assert.match(patch, /\.clock\s*= 30000,/);
});

test("o mapa de botões do X35H tem 16 botões e não declara BTN_MODE", async () => {
  const map = await readFile(path.join(DIR, "buttons.map"), "utf8");
  const entradas = map
    .split("\n")
    .map((l) => l.replace(/#.*/, ""))
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((p) => p.trim()))
    .filter(([, codigo]) => /^BTN_/.test(codigo ?? ""));
  assert.equal(entradas.length, 16);
  assert.ok(
    !entradas.some(([, codigo]) => codigo === "BTN_MODE"),
    "BTN_MODE só existe na X55 (patch 0002 dela); aqui faria o teste esperar 17",
  );
});

test("o log de boot é ligado só neste aparelho", async () => {
  // Sem TTL/Wi-Fi/BT o cartão é o único canal. O marcador não pode existir no
  // overlay comum (a X55 tem console e não precisa escrever no cartão a cada
  // boot).
  const comum = path.join(ROOT, "device/common/rootfs-overlay/etc/giochi/boot-log");
  await assert.rejects(readFile(comum), "o marcador de log vazou para o overlay comum");
  const marcador = await readFile(path.join(DIR, "rootfs-overlay/etc/giochi/boot-log"));
  assert.equal(marcador.length, 0, "o marcador é um arquivo vazio; o conteúdo não importa");
});
