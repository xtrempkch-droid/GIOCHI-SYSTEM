import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// O DEFCONFIG DO APARELHO ERA O ÚNICO ARQUIVO DE CONFIGURAÇÃO SEM GATE.
//
// `assert-config.mjs` verificava `config/common.fragment`, o
// `buildroot.fragment` e os fragmentos por área — e nunca o
// `device/<pasta>/defconfig`, que é o arquivo onde o aparelho declara a maior
// parte das suas escolhas.
//
// O buraco foi medido em 08/11/2026, reproduzindo o pipeline do X55 sem
// compilar (`make <defconfig>` -> `prepare-config` -> `make olddefconfig`):
//
//   assert dos fragmentos:  OK — 25 símbolos
//   assert do defconfig:    BR2_PACKAGE_KMOD_TOOLS descartado
//
// Mecanismo: `BR2_PACKAGE_KMOD_TOOLS` tem
// `depends on BR2_PACKAGE_BUSYBOX_SHOW_OTHERS`, e essa dependência só é
// satisfeita pelo `config/common.fragment`. O `make <defconfig>` roda ANTES dos
// fragmentos, então o kconfig descarta o símbolo na leitura do defconfig (ele
// nem aparece no `.config`, nem como `is not set`); o `olddefconfig` posterior,
// já com SHOW_OTHERS=y, traz o símbolo com o DEFAULT `n`. O `=y` escrito no
// defconfig nunca é lido de novo.
//
// Resultado na imagem: o `modprobe` do busybox, que não resolve
// `modules.dep.bin`, softdeps nem blacklist — e o `S15modules` depende disso.

const BUILD = path.join(ROOT, "scripts", "build-device.sh");

// Símbolos do Buildroot que dependem de `BR2_PACKAGE_BUSYBOX_SHOW_OTHERS`.
// Conferido em `package/kmod/Config.in` do 2024.02. Se outro aparecer, o teste
// que compara defconfig com fragmento continua valendo — este aqui é o que já
// custou uma imagem.
const DEPENDE_DE_SHOW_OTHERS = ["BR2_PACKAGE_KMOD_TOOLS"];

function defconfigsDeAparelho() {
  const pasta = path.join(ROOT, "device");
  const resultado = [];
  for (const nome of readdirSync(pasta)) {
    const arquivo = path.join(pasta, nome, "defconfig");
    try {
      resultado.push({ device: nome, texto: readFileSync(arquivo, "utf8") });
    } catch {
      // aparelho sem defconfig próprio (usa o do Buildroot): nada a verificar
    }
  }
  return resultado;
}

test("o build verifica também o defconfig do aparelho", () => {
  const script = readFileSync(BUILD, "utf8");
  assert.match(
    script,
    /ASSERT_FRAGMENTS\+=\(--fragment "\$BR2_DIR\/configs\/\$DEFCONFIG"\)/,
    "o defconfig do aparelho tem de entrar no assert-config",
  );
  // Só quando o aparelho tem defconfig PRÓPRIO: o `qemu-aarch64` usa o do
  // Buildroot, que contém símbolos que o próprio Buildroot ajusta — afirmar
  // sobre ele daria falso positivo no único aparelho habilitado.
  assert.match(
    script,
    /if \[\[ -f "\$DEVICE_DEFCONFIG" \]\]; then\s*\n\s*ASSERT_FRAGMENTS/,
    "a inclusão tem de ser condicional ao defconfig do aparelho",
  );
});

test("o defconfig usado no assert é o INSTALADO, com placeholders resolvidos", () => {
  // `device/<pasta>/defconfig` contém `__UBOOT_FRAGMENT__` e
  // `__UBOOT_PATCH_DIR__`; o build os substitui ao copiar para
  // `$BR2_DIR/configs/`. Assertar sobre o original acusaria divergência em
  // todo build de aparelho que use U-Boot customizado.
  const script = readFileSync(BUILD, "utf8");
  const chamada = script.indexOf('ASSERT_FRAGMENTS+=(--fragment "$BR2_DIR/configs/$DEFCONFIG")');
  assert.ok(chamada > 0);
  // E a substituição tem de acontecer ANTES: o `sed -i` dos dois placeholders.
  const sed = script.indexOf("__UBOOT_FRAGMENT__#$WORK_DIR/uboot.fragment#");
  assert.ok(sed > 0 && sed < chamada, "a substituição do placeholder tem de vir antes do assert");
});

test("nenhum defconfig de aparelho pede símbolo que depende do common.fragment", () => {
  // A regra que evita a classe: símbolo cuja `depends on` só é satisfeita por um
  // fragmento mora no FRAGMENTO, porque o defconfig é lido antes deles.
  const ofensores = [];
  for (const { device, texto } of defconfigsDeAparelho()) {
    for (const simbolo of DEPENDE_DE_SHOW_OTHERS) {
      if (new RegExp(`^${simbolo}=y$`, "m").test(texto)) {
        ofensores.push(`${device}: ${simbolo}`);
      }
    }
  }
  assert.deepEqual(
    ofensores,
    [],
    "estes símbolos dependem de BUSYBOX_SHOW_OTHERS, que vem do common.fragment:\n  " +
      `${ofensores.join("\n  ")}\n` +
      "  no defconfig eles são descartados em silêncio; mova para buildroot.fragment",
  );
});

test("quem usa os utilitários de módulo declara KMOD_TOOLS no fragmento", () => {
  // Não basta remover do defconfig: o `modprobe` do kmod é o que resolve
  // `modules.dep.bin`/softdeps/blacklist, e o `S15modules` da X55 depende disso.
  for (const device of ["powkiddy x55", "powkiddy x35h"]) {
    const fragmento = readFileSync(path.join(ROOT, "device", device, "buildroot.fragment"), "utf8");
    assert.match(
      fragmento,
      /^BR2_PACKAGE_KMOD_TOOLS=y$/m,
      `${device}: KMOD_TOOLS saiu do defconfig e não entrou no fragmento`,
    );
  }
});
