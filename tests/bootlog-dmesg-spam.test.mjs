import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// O LOG QUE O BRING-UP GRAVA NO CARTÃO ESTAVA SENDO ENGOLIDO PELO PRÓPRIO BOOT.
//
// Medido no X55 em 08/11/2026, aparelho com a bateria desconectada
// (`present=0`). O `rk817-charger` imprime
//
//   rk817-charger rk817-charger.6.auto: Battery voltage 17840 below minimum voltage 3400000
//
// a cada ~8 s. Em 3,3 h de uptime:
//
//   total do dmesg: 1260 linhas
//   spam do charger: 1258
//   outras:             2   <- e as duas eram do takeover do fbcon que EU disparei
//
// Ou seja: o log de boot inteiro foi rotacionado para fora do buffer. O
// `giochi-bootlog`, que existe para gravar o diagnóstico na FAT do cartão,
// gravaria 1258 linhas de ruído — e `dmesg | grep painel` não acha nada.
//
// A correção agrupa por ASSINATURA da mensagem (timestamp fora, números
// normalizados) e imprime a primeira ocorrência, com a contagem quando o padrão
// se repete 3+ vezes. Este teste roda o awk DE VERDADE, extraído do script.

const BOOTLOG = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-bootlog");

/** Extrai o programa awk do bloco de dmesg do `giochi-bootlog`. */
function extrairAwk() {
  const texto = readFileSync(BOOTLOG, "utf8");
  const inicio = texto.indexOf("echo \"## dmesg\"");
  assert.ok(inicio > 0, "o bloco do dmesg sumiu do bootlog");
  const bloco = texto.slice(inicio, texto.indexOf('echo "## DRM', inicio));
  const m = bloco.match(/awk '([\s\S]*?)'/);
  assert.ok(m, "não achei o programa awk no bloco do dmesg");
  return m[1];
}

function rodar(dmesg) {
  const dir = mkdtempSync(path.join(tmpdir(), "giochi-awk-"));
  try {
    const prog = path.join(dir, "agrupa.awk");
    const entrada = path.join(dir, "dmesg.txt");
    writeFileSync(prog, extrairAwk());
    writeFileSync(entrada, dmesg);
    return execFileSync("awk", ["-f", prog, entrada], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CHARGER = (t, v) =>
  `[${t.toFixed(6).padStart(11)}] rk817-charger rk817-charger.6.auto: Battery voltage ${v} below minimum voltage 3400000`;

test("o laço do charger vira poucas linhas, com contagem", () => {
  const linhas = ["[   0.000000] Booting Linux on physical CPU 0x0"];
  for (let i = 0; i < 300; i += 1) linhas.push(CHARGER(13 + i * 8, 17840 + i));
  linhas.push("[12094.546881] fbcon: Taking over console");
  linhas.push("[12094.547878] Console: switching to colour frame buffer device 160x45");
  linhas.push("[12100.000000] usb0: RNDIS ready");

  const saida = rodar(`${linhas.join("\n")}\n`);
  const n = saida.trim().split("\n").length;

  assert.ok(n < 12, `300 repetições viraram ${n} linhas; esperado < 12`);
  assert.match(saida, /no mesmo padrao/, "a contagem tem de aparecer");
  assert.match(saida, /299 linha\(s\) no mesmo padrao/, "300 linhas = a primeira + 299 repetidas");

  // O que IMPORTA não pode ter sido engolido no meio do laço.
  assert.match(saida, /Booting Linux on physical CPU/, "o começo do boot tem de sobreviver");
  assert.match(saida, /fbcon: Taking over console/, "linha entre repetições tem de sobreviver");
  assert.match(saida, /frame buffer device 160x45/, "e a seguinte também");
  assert.match(saida, /usb0: RNDIS ready/, "e o fim do log também");
});

test("duas linhas parecidas com números diferentes NÃO são comprimidas", () => {
  // mmc0 e mmc1 diferem só no número — e as duas são informação. A compressão
  // começa na terceira repetição justamente para não perder este par.
  const dmesg = [
    "[   20.000000] mmc0: SDHCI controller on fe2e0000.mmc [fe2e0000.mmc] using ADMA",
    "[   20.000001] mmc1: SDHCI controller on fe2d0000.mmc [fe2d0000.mmc] using ADMA",
  ].join("\n");
  const saida = rodar(`${dmesg}\n`);
  assert.match(saida, /fe2e0000/, "a primeira tem de aparecer");
  assert.match(saida, /fe2d0000/, "e a segunda também");
  assert.ok(!/no mesmo padrao/.test(saida), "duas não é laço");
});

test("log sem repetição sai igual à entrada", () => {
  const dmesg = [
    "[    0.000000] Booting Linux",
    "[    1.000000] rockchip-drm display-subsystem: bound fe0a0000.hdmi",
    "[    2.000000] panel: st7703 found",
  ].join("\n");
  const saida = rodar(`${dmesg}\n`).trim();
  assert.equal(saida, dmesg, "o awk não pode alterar o que não é repetido");
});

test("o bootlog descreve o porquê, não só o como", () => {
  // O comentário é o que impede alguém de "simplificar" a compressão para um
  // grep de regex — que escolheria quais mensagens do kernel importam, que é a
  // mesma classe do `2>/dev/null` (§12.53).
  const texto = readFileSync(BOOTLOG, "utf8");
  assert.match(texto, /1258 das 1260 linhas/, "o número medido tem de estar escrito");
  assert.match(texto, /rotacionad/, "e o efeito (buffer rotacionado)");
});
