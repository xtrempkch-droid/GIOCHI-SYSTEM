import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato da avaliação do PortMaster (docs/evaluacao-portmaster.md).
//
// Como no estudo do pyglet, o que estes testes protegem é a **memória da
// análise**, e aqui ela tem duas metades que envelhecem em direções opostas:
//
//   1. os números do lado deles (tamanho do pacote, dos runtimes) mudam a cada
//      release — se mudarem, o documento precisa de nova medição;
//   2. o veredito depende de premissas NOSSAS (a imagem não tem python3; GPL
//      não entra na imagem). Se qualquer uma virar mentira, o veredito muda
//      sem ninguém reler o texto.
//
// A segunda é a que justifica o teste: premissa que vira falsa em silêncio é a
// família do §12.1 ("build verde e imagem errada") aplicada a uma decisão.

const DOC = path.join(ROOT, "docs/evaluacao-portmaster.md");

async function texto() {
  return readFile(DOC, "utf8");
}

test("o estudo existe e o veredito é app de loja, não imagem", async () => {
  const t = await texto();
  // Se alguém trocar o veredito por "embarcar", tem de ser com nova medição da
  // licença — não por conveniência de empacotamento.
  assert.match(t, /app de loja/i);
  assert.match(t, /bloqueado pela nossa regra de licença/i);
  assert.match(t, /\/user\/ports/);
});

test("a distinção de licença que decide está explícita", async () => {
  const t = await texto();
  // A GUI é MIT (passa); o que reprova é o PAYLOAD: gptokeyb2 (GPL-2.0) e
  // 7-Zip (LGPL-2.1). Perder essa distinção faz alguém concluir "é MIT, então
  // pode" — que é o erro oposto ao do Quiver.
  assert.match(t, /\bMIT\b/);
  assert.match(t, /gptokeyb2.{0,80}GPL-2\.0|GPL-2\.0.{0,80}gptokeyb2/s);
  assert.match(t, /LGPL-2\.1/);
  assert.match(t, /7-?Zip/i);
});

test("os números medidos estão no documento, com a fonte", async () => {
  const t = await texto();
  assert.match(t, /24 642 993/, "tamanho do PortMaster.zip");
  assert.match(t, /644 376 025/, "runtimes popular aarch64");
  assert.match(t, /2 007 136 147/, "runtimes all aarch64");
  assert.match(t, /pugwash/, "o executável é script python3, não binário");
  // O release medido é a âncora temporal: sem ela, daqui a seis meses ninguém
  // sabe contra o que os números foram medidos.
  assert.match(t, /2026\.11\.17-0700/);
});

test("o estudo separa o medido do estimado, como o §6 exige", async () => {
  const t = await texto();
  assert.match(t, /estimado/i, "o tamanho do python3 tem de estar dito como estimativa");
  assert.match(t, /15–25 MB/);
  assert.match(t, /N[ÃA]O est[áa] medido/i);
  // As duas perguntas que faltam são as que mais importam: subir em CFW
  // desconhecida e RetroArch. Se o texto começar a afirmar isso, foi dedução.
  assert.match(t, /CFW desconhecida/i);
});

test("o ponto de extensão e o diretório dos ports estão nomeados", async () => {
  const t = await texto();
  // `mod_<CFW>.txt` é o gancho oficial deles: port script, controle e launcher
  // todos sourceiam. Sem nomeá-lo, a integração parece exigir fork do control.txt.
  assert.match(t, /mod_<\w+>\.txt|mod_Giochi\.txt/);
  assert.match(t, /control\.txt/);
  assert.match(t, /\/roms/);
  // E o motivo de não usarmos `/roms`: já temos `/user` declarado.
  assert.match(t, /diretorio=|directory=user/);
});

test("a imagem continua sem python3 — se mudar, o documento tem de mudar", async () => {
  // Premissa do veredito. `BR2_TARGET_UBOOT_NEEDS_PYTHON3` é de HOST e não
  // conta; o que se procura é o pacote de alvo (`^BR2_PACKAGE_PYTHON3`).
  const dirs = ["config", "device", "buildroot-external"];
  const achados = [];

  async function varrer(dir) {
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await varrer(p);
      } else {
        const conteudo = await readFile(p, "utf8").catch(() => "");
        for (const linha of conteudo.split("\n")) {
          if (linha.startsWith("BR2_PACKAGE_PYTHON3")) achados.push(`${path.relative(ROOT, p)}: ${linha.trim()}`);
        }
      }
    }
  }

  for (const d of dirs) await varrer(path.join(ROOT, d));

  assert.deepEqual(
    achados,
    [],
    "a imagem passou a ter python3 de alvo. O §3.1 do docs/evaluacao-portmaster.md " +
      "diz que ele NÃO está na imagem (é o custo do caminho B) — atualize o estudo, " +
      `e diga se o PortMaster passa a ser de graça no rootfs: ${achados.join(", ")}`,
  );
});

test("nada do PortMaster está embarcado hoje", async () => {
  // O documento diz "como app, 0 MB na imagem". Se alguém copiar o pacote para o
  // overlay, isso vira mentira — e, pior, leva GPL-2.0 para o artefato público.
  const overlay = path.join(ROOT, "device/common/rootfs-overlay");
  const suspeitos = [];

  async function varrer(dir) {
    const entradas = await readdir(dir, { withFileTypes: true });
    for (const e of entradas) {
      if (e.isDirectory()) {
        await varrer(path.join(dir, e.name));
      } else if (/portmaster|gptokeyb|7zzs/i.test(e.name)) {
        suspeitos.push(path.relative(ROOT, path.join(dir, e.name)));
      }
    }
  }

  await varrer(overlay);
  assert.deepEqual(
    suspeitos,
    [],
    "binário/pacote do PortMaster no overlay comum: o payload tem GPL-2.0 e " +
      `LGPL, que a §15 recusa na imagem assinada (ver docs/evaluacao-portmaster.md §4): ${suspeitos.join(", ")}`,
  );
});
