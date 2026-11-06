#!/usr/bin/env node
// O bootloader LEGACY da Rockchip, que é o que funciona no RK3326.
//
// Contexto medido no R35S (06/11/2026): o caminho mainline do Buildroot
// (idbloader TPL+SPL + u-boot.itb) executa TPL, DDR e BL31 e TRAVA ao saltar
// para o U-Boot em 0x200000 — console mudo, sem mensagem. É o mesmo sintoma que
// o antecessor registrou como "tela preta sem print no serial".
//
// A ROCKNIX usa o caminho legacy nesta placa há anos. Este teste prende a
// receita, para que o script não derive em silêncio.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SCRIPT = `${ROOT}scripts/make-rk3326-bootloader.sh`;
const IMAGE_SD = `${ROOT}scripts/make-sd-image.sh`;
const device = JSON.parse(readFileSync(`${ROOT}device/r35s/device.json`, "utf8"));

const source = readFileSync(SCRIPT, "utf8");
const imageSd = readFileSync(IMAGE_SD, "utf8");

test("o script existe, é executável e tem sintaxe válida", () => {
  assert.ok(existsSync(SCRIPT));
  const mode = readFileSync(SCRIPT).length > 0;
  assert.ok(mode);
  // O shebang importa: o script é chamado direto.
  assert.match(source, /^#!\/usr\/bin\/env bash$/m);
});

test("segue a receita do rkhelper da ROCKNIX, passo a passo", () => {
  // 1. idbloader: mkimage empacota o init de DDR, e o miniloader é concatenado.
  //    Motivo, do comentário do próprio rkhelper: "mkimage does not support
  //    packing second level bootloader on rk3326".
  assert.match(source, /-T rksd/);
  assert.match(source, /cat "\$\(basename "\$MINILOADER"\)" >> idbloader\.img/);

  // 2. uboot.img com o endereço de carga do RK3326.
  assert.match(source, /--pack --uboot/);
  assert.match(source, /0x00200000/);

  // 3. trust.img com BL31 em 0x00010000 e só ele com SEC=1.
  assert.match(source, /\[BL31_OPTION\]\nSEC=1/);
  assert.match(source, /ADDR=0x00010000/);
  assert.match(source, /trust_merger/);
});

test("os offsets de concatenação são os do BootROM (16320 e 24512)", () => {
  // Não são redondos de propósito: 16320 + 64 = 16384 e 24512 + 64 = 24576, que
  // é onde o BootROM procura quando o arquivo é gravado no setor 64 do cartão.
  // Arredondar para 16384/24576 quebra o boot sem nenhuma mensagem.
  assert.match(source, /seek=16320/);
  assert.match(source, /seek=24512/);
  assert.ok(!/seek=16384/.test(source), "16384 é o offset DO CARTÃO, não do arquivo");
});

test("verifica as assinaturas — tela preta não diz qual peça faltou", () => {
  assert.match(source, /b"LOADER  "/);
  assert.match(source, /b"BL3X"/);
});

test("aceita px30_* e rk3326_* — são o MESMO binário", () => {
  // Medido: md5 de px30_bl31_v1.33.elf == rk3326_bl31_v1.33.elf
  //         md5 de px30_ddr_333MHz_v2.08.bin == rk3326_ddr_333MHz_v2.08.bin
  // A Rockchip publica o mesmo arquivo com dois nomes. Escolher pelo nome é
  // irrelevante; o que muda o comportamento é o caminho (legacy vs TPL/SPL).
  assert.match(source, /rk3326_ddr_333MHz_v2\.08\.bin/);
  assert.match(source, /px30_ddr_333MHz_v2\.08\.bin/);
  assert.match(source, /rk3326_miniloader_v1\.35\.bin/);
  assert.match(source, /rk3326_bl31_v1\.33\.elf/);
});

test("o gerador de imagem prefere o legacy ao mainline", () => {
  // Se a ordem inverter, o cartão volta a receber u-boot-rockchip.bin e o
  // aparelho trava em 0x200000 de novo — com o build inteiro verde.
  const legacy = imageSd.indexOf("u-boot-legacy.bin");
  const rockchip = imageSd.indexOf('"$OUT_DIR/u-boot-rockchip.bin"');
  assert.ok(legacy > 0, "make-sd-image.sh não conhece u-boot-legacy.bin");
  assert.ok(legacy < rockchip, "legacy tem de ser testado ANTES do mainline");
});

test("o legacy está declarado nos artefatos do aparelho", () => {
  assert.ok(
    device.artifacts.includes("u-boot-legacy.bin"),
    "sem declarar, a coleta do build não copia e a imagem sai com o firmware antigo",
  );
});
