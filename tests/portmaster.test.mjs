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

test("o estudo separa o medido do estimado", async () => {
  const t = await texto();
  // Número estimado tem de estar DITO como estimado; número medido, como
  // medido. A regra do repositório vale para estudo de viabilidade também — foi
  // a primeira coisa que a medição de 20/11/2026 corrigiu (15–25 MiB estimados
  // viraram 22,9 MiB medidos).
  assert.match(t, /MEDIDO/i, "o total tem de estar marcado como medido");
  assert.match(t, /22,9 MiB/);
  // O que continua sem medição tem de estar nomeado, e não sumir do documento.
  assert.match(t, /N[ÃA]O medido/i);
  assert.match(t, /box64|wine/i, "o desempenho continua não medido");
  assert.match(t, /CFW desconhecida|detecta o aparelho/i);
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

test("python3 de alvo só existe no fragmento OPT-IN, nunca no padrão", async () => {
  // A premissa original ("a imagem não tem python3") virou falsa em
  // 20/11/2026, quando `config/portmaster.fragment` entrou — e o teste antigo
  // reprovou na hora, que é o comportamento desejado.
  //
  // A invariante que fica é a que importa: python3 custa 22,9 MiB medidos e só
  // pode entrar quando alguém pede (`GIOCHI_WITH_PORTMASTER=1`). Se ele
  // aparecer no `common.fragment` ou no defconfig de um aparelho, todo mundo
  // paga sem escolher.
  const padrao = ["config/common.fragment", "config/common.busybox.fragment"];
  for (const rel of padrao) {
    const conteudo = await readFile(path.join(ROOT, rel), "utf8");
    const linhas = conteudo
      .split("\n")
      .filter((l) => l.startsWith("BR2_PACKAGE_PYTHON3"));
    assert.deepEqual(linhas, [], `${rel} liga python3 de alvo: só o fragmento opt-in pode`);
  }

  // E o defconfig do aparelho também não — é o arquivo que sempre entra.
  const device = path.join(ROOT, "device");
  const suspeitos = [];
  for (const pasta of await readdir(device, { withFileTypes: true })) {
    if (!pasta.isDirectory()) continue;
    for (const arquivo of ["defconfig", "buildroot.fragment"]) {
      const p = path.join(device, pasta.name, arquivo);
      const conteudo = await readFile(p, "utf8").catch(() => "");
      if (/^BR2_PACKAGE_PYTHON3/m.test(conteudo)) suspeitos.push(`${pasta.name}/${arquivo}`);
    }
  }
  assert.deepEqual(
    suspeitos,
    [],
    "python3 no defconfig/buildroot.fragment de um aparelho: quem não pediu passa a pagar 22,9 MiB",
  );

  // E o opt-in tem de existir, com build-device.sh ligando de fato.
  const frag = await readFile(path.join(ROOT, "config/portmaster.fragment"), "utf8");
  assert.match(frag, /^BR2_PACKAGE_PYTHON3=y$/m);
  const build = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");
  assert.match(build, /GIOCHI_WITH_PORTMASTER/);
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
