import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// GUARDAS DE UPGRADE DO BUILDROOT.
//
// Medido em 13/11/2026, comparando 2024.02 com 2025.02, 2025.08 e 2026.02
// usando o MESMO defconfig e o MESMO `config/common.fragment`:
//
//   | versão  | glibc | mesa   | panfrost sem LLVM? |
//   | 2024.02 | 2.38  | 23.x   | sim  (a atual)     |
//   | 2025.02 | 2.41  | 24.0.9 | sim                |
//   | 2025.05 | 2.41  | 25.0.6 | sim                |
//   | 2025.08 | 2.41  | 25.1.8 | NÃO                |
//   | 2025.11 | 2.42  | 25.2.7 | NÃO                |
//   | 2026.02 | 2.42  | 26.0.1 | NÃO                |
//
// Dois defeitos silenciosos aparecem nessas fronteiras, e nenhum deles dá erro:
// o build fica verde e a imagem sai errada. Os testes abaixo são os gates.

const VERSION = (await readFile(path.join(ROOT, "buildroot.version"), "utf8")).trim();
const [ANO, MES] = VERSION.split(".").map(Number);

/** `atLeast(2025, 2)` — verdadeiro para 2025.02 e posteriores. */
const atLeast = (ano, mes) => ANO > ano || (ANO === ano && MES >= mes);

async function defconfigsDosAparelhos() {
  const dir = path.join(ROOT, "device");
  const entradas = await readdir(dir, { withFileTypes: true });
  const saida = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    const arquivo = path.join(dir, entrada.name, "defconfig");
    try {
      saida.push({ aparelho: entrada.name, texto: await readFile(arquivo, "utf8") });
    } catch {
      /* aparelho sem defconfig próprio (o QEMU usa o do Buildroot) */
    }
  }
  return saida;
}

test("a série de headers do kernel é declarada quando o Buildroot não a infere", async (t) => {
  // A ARMADILHA. `BR2_KERNEL_HEADERS_AS_KERNEL=y` NÃO seleciona
  // `BR2_TOOLCHAIN_HEADERS_AT_LEAST_*`: com versão de kernel customizada, o
  // Kconfig não tem como saber a capacidade dos headers. O próprio help do
  // Buildroot diz que é preciso declarar a série.
  //
  // Em 2024.02 isso passava — o `.config` saía com `AT_LEAST="6.6"`. De
  // 2025.02 em diante sai `AT_LEAST="2.6"`, e então:
  //
  //   BR2_PACKAGE_GLIBC_SUPPORTS = n   → cai para uClibc (o default do choice
  //                                       não vale porque a dependência falhou)
  //   BR2_USE_WCHAR             = n   → freetype/psplash/SDL2_ttf desligados
  //   BR2_PACKAGE_GLIBC_UTILS   ausente → sem `ldd`
  //   BR2_PACKAGE_BINUTILS      ausente → sem `readelf`
  //   + dosfstools, iproute2, nano, procps-ng, psplash
  //
  // Medido: 9 símbolos do `common.fragment` desaparecem de uma vez, e a imagem
  // boota com a libc errada. Só `assert-config` pega — e só se alguém reparar
  // que a LISTA é longa demais para ser coincidência.
  if (!atLeast(2025, 2)) {
    t.skip(`buildroot ${VERSION} ainda infere a série (medido em 2024.02)`);
    return;
  }

  const pendentes = [];
  for (const { aparelho, texto } of await defconfigsDosAparelhos()) {
    const kernel = texto.match(/^BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE="([0-9]+\.[0-9]+)/m);
    if (!kernel) continue;
    const serie = kernel[1].replace(".", "_");
    const simbolo = `BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_${serie}=y`;
    if (!texto.includes(simbolo)) pendentes.push(`${aparelho} (falta ${simbolo})`);
  }

  assert.deepEqual(
    pendentes,
    [],
    "defconfig sem a série de headers: o olddefconfig cai para uClibc em silêncio.\n" +
      "  Adicione uma linha por aparelho, com o número da série do kernel:\n" +
      "    BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_6_12=y\n" +
      "  Ver AGENTS §12.66 (armadilha medida na comparação 2024.02 -> 2025.02).",
  );
});

test("o panfrost não arrasta LLVM sem decisão registrada", async (t) => {
  // A SEGUNDA ARMADILHA, e é de tamanho de imagem. A partir do mesa 25.1
  // (Buildroot 2025.08), `BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_PANFROST` passou a
  // ter `depends on BR2_PACKAGE_MESA3D_LLVM`, que faz `select
  // BR2_PACKAGE_LLVM` — LLVM **no target**, mais `MESA3D_NEEDS_PRECOMP_COMPILER`
  // (OpenCL + SPIRV-LLVM-Translator + SPIRV-Tools) e o `panfrost_compile` no
  // host.
  //
  // O sintoma sem tratar é o do §12.1: o `olddefconfig` descarta
  // BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_PANFROST (a dependência não está
  // satisfeita), o `assert-config` reprova e o build para. Quem "resolver"
  // ligando só o LLVM decide, sem perceber, colocar a maior biblioteca do
  // catálogo num handheld de 1 GB.
  //
  // Por isso a guarda é sobre o PAR: quem pede panfrost em versão que exige
  // LLVM tem de pedir o LLVM explicitamente, no mesmo arquivo. Assim a decisão
  // fica visível no diff, e não escondida dentro de um `select`.
  if (!atLeast(2025, 8)) {
    t.skip(`buildroot ${VERSION}: mesa sem LLVM no panfrost (medido em 2025.02 e 2025.05)`);
    return;
  }

  const pendentes = [];
  for (const { aparelho, texto } of await defconfigsDosAparelhos()) {
    const temPanfrost = /^BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_PANFROST=y$/m.test(texto);
    const temLlvm = /^BR2_PACKAGE_MESA3D_LLVM=y$/m.test(texto);
    if (temPanfrost && !temLlvm) {
      pendentes.push(`${aparelho}: pede panfrost sem BR2_PACKAGE_MESA3D_LLVM=y`);
    }
  }

  assert.deepEqual(
    pendentes,
    [],
    "o mesa desta versão exige LLVM para o panfrost.\n" +
      "  Ou declare BR2_PACKAGE_MESA3D_LLVM=y no defconfig (aceitando o custo de\n" +
      "  libLLVM no aparelho), ou fique numa versão <= 2025.05, onde o\n" +
      "  panfrost não precisa de LLVM. Ver AGENTS §12.66.",
  );
});

test("a versão do Buildroot tem hash fixado", async () => {
  // A migração de versão só está completa quando `buildroot.sha256` tem a
  // linha do tarball novo — sem ela o build recusa, e é o comportamento certo.
  const hashes = await readFile(path.join(ROOT, "buildroot.sha256"), "utf8");
  assert.match(
    hashes,
    new RegExp(`^[0-9a-f]{64}  buildroot-${VERSION.replace(/\./g, "\\.")}\\.tar\\.gz$`, "m"),
    `buildroot.sha256 não tem a linha de buildroot-${VERSION}.tar.gz`,
  );
});
