import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato de `flash-sd.sh --grow`, escrito em 06/11/2026 ao preparar o cartão
// de 128 GB do X35H.
//
// O problema que ele resolve: a `.img` tem tamanho fixo (2 GiB). Num cartão de
// 128 GB isso deixa 114 GB sem tabela de partição — espaço que nenhum `mkfs`
// nem app enxerga, porque não pertence a partição nenhuma. O `docs/flashing.md`
// já registrava a consequência de desenho; faltava a ferramenta.
//
// A alternativa (`make-sd-image.sh --size-mib 118000`) foi recusada por um
// motivo medido: `dd` escreve os zeros também, e 115 GiB são mais de uma hora
// de gravação contra ~2 min + `resize2fs`.
//
// As duas armadilhas abaixo foram encontradas testando de verdade num arquivo,
// não lendo documentação — as duas davam mensagem que esconde a causa.

const SCRIPT = path.join(ROOT, "scripts/flash-sd.sh");
const ler = () => readFile(SCRIPT, "utf8");

test("--grow existe e é documentado no --help", async () => {
  const texto = await ler();
  assert.match(texto, /--grow\)\s*GROW=1/);
  assert.match(texto, /--grow.*usa o cartão todo/);
  const ajuda = execFileSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.match(ajuda, /--grow/, "o --help tem de listar a opção");
  // O `--help` cortado é um defeito próprio: o cabeçalho cresce quando entra
  // opção nova, e um recorte por número de linha passa a mentir em silêncio.
  assert.ok(!/set -euo/.test(ajuda), "--help imprimiu o corpo do script");
  assert.ok(ajuda.length < 2000, `--help com ${ajuda.length} chars: faixa errada`);
});

test("cresce DEPOIS de verificar o SHA, nunca antes", async () => {
  // Crescer muda a tabela de partições e o superbloco: a partir daí o cartão
  // NÃO é mais byte a byte igual à imagem. Verificar depois seria comparar com
  // algo que já não existe, e o veredito seria sempre "cartão defeituoso".
  const texto = await ler();
  const posVerify = texto.indexOf("ACTUAL_SHA=\"$(verify_card)\"");
  const posCall = texto.indexOf("cresce_ultima_particao \"$TARGET\"");
  assert.ok(posVerify > 0, "a verificação de SHA sumiu");
  assert.ok(posCall > 0, "a chamada do crescimento sumiu");
  assert.ok(posVerify < posCall, "o crescimento passou para antes da verificação");
});

test("`sfdisk -J` devolve NOME em `node`, e o número sai do índice", async () => {
  // Medido: `node` vem como `/dev/sdb2` (ou `cartao.img2` num arquivo). Passar
  // isso para `-N` falha, e a mensagem fala do dispositivo, não do argumento:
  //
  //   sfdisk: cannot open /dev/sdb2: No such file or directory
  //
  // `-N` espera o NÚMERO. Este teste falha se alguém "simplificar" usando node.
  const texto = await ler();
  assert.match(texto, /numero_da_ultima_particao/);
  assert.match(texto, /i \+ 1/, "o número tem de sair do índice (1-based)");
  assert.ok(
    !/sfdisk[^|]*-N "\$\(?.*\]\[.node.\]/.test(texto),
    "não pode passar `node` para -N",
  );
});

test("`blockdev --getstart` não existe — o início vem do sfdisk", async () => {
  // Medido: `blockdev: Comando desconhecido: --getstart`. É fácil de escrever
  // porque a opção parece natural, e o erro só aparece na hora de crescer.
  const texto = await ler();
  // Só código executável: o comentário que DOCUMENTA a armadilha é a defesa
  // contra a recaída e não pode ser o que faz o teste falhar.
  const executavel = texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(!/blockdev --getstart/.test(executavel), "blockdev não tem --getstart");
});

test("partição com nome terminado em dígito recebe o `p` (mmcblk0p2)", async () => {
  // `/dev/mmcblk0` + 2 não é `/dev/mmcblk02`. Um leitor de cartão SD interno de
  // notebook é exatamente este caso, e ele É um disco removível — passa pela
  // validação do script.
  const texto = await ler();
  assert.match(texto, /caminho_da_particao/);
  assert.match(texto, /\*\[0-9\]\)\s*printf '%sp%s/);
});

test("crescer só a última partição, e só se for ext4", async () => {
  const texto = await ler();
  // Crescer uma partição do meio exigiria mover as seguintes: é a operação que
  // apaga dados. A escolha é pelo maior `start`.
  assert.match(texto, /key=lambda k: partes\[k\]\["start"\]/);
  assert.match(texto, /"\$tipo" != "ext4"/);
  // fsck antes do resize: `resize2fs` num fs inconsistente espalha a
  // inconsistência em vez de corrigi-la.
  const posFsck = texto.indexOf("e2fsck -f -p");
  const posResize = texto.indexOf("resize2fs \"$part\"");
  assert.ok(posFsck > 0 && posResize > 0 && posFsck < posResize);
});

test("falha ao crescer não derruba a gravação já verificada", async () => {
  // O cartão já foi gravado e conferido por SHA256 quando o crescimento roda.
  // Sair != 0 aqui faria o operador achar que a gravação falhou e regravar —
  // quando o sistema está pronto e só falta espaço.
  const texto = await ler();
  const bloco = texto.slice(
    texto.indexOf("cresce_ultima_particao()"),
    texto.indexOf("if ((GROW)); then"),
  );
  const saidas = bloco.match(/^\s*exit \d/gm) ?? [];
  assert.deepEqual(saidas, [], "a função não pode dar `exit`: use aviso + return 0");
  assert.ok((bloco.match(/return 0/g) ?? []).length >= 4, "os caminhos de falha têm de voltar 0");
});
