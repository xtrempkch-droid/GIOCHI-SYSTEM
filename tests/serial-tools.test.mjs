import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Ferramentas de diagnóstico serial (`docker/baud-scan.py`, `serial-listen.py`,
// `serial-watch.py`).
//
// Elas existem porque o console do R35S não tem baud documentado nesta árvore e
// porque a linha cai. Duas coisas precisam continuar verdadeiras:
//
//   1. o log de diagnóstico grava os bytes CRUS — decodificar destrói a
//      evidência. Medido: 47 bytes `ff 00 00 00 ...` viraram quatro caracteres
//      `EF BF BD` e 35 zeros, e o padrão que identifica linha flutuante sumiu;
//   2. a classificação distingue "mudo" de "ruído" de "texto". Se tudo virar
//      "chegou alguma coisa", a conclusão sobre o baud erra.

const DOCKER = path.join(ROOT, "docker");
const le = (nome) => readFileSync(path.join(DOCKER, nome), "utf8");

test("as três ferramentas existem e o Dockerfile oficial as copia", async () => {
  for (const nome of [
    "baud-scan.py",
    "serial-listen.py",
    "serial-watch.py",
    "serial-loopback.py",
    "serial-push.py",
  ]) {
    assert.ok(le(nome).length > 500, `${nome} está vazio?`);
  }
  const dockerfile = le("serial.Dockerfile");
  // Sem esta linha a imagem não tem as ferramentas e o comando do doc falha
  // com "No such file or directory", que não diz que faltou o COPY.
  // Já aconteceu: o serial-watch.py foi escrito DEPOIS de a imagem ser
  // construída, e o container morreu com "can't open file" no meio da captura.
  for (const nome of [
    "baud-scan.py",
    "serial-listen.py",
    "serial-watch.py",
    "serial-loopback.py",
    "serial-push.py",
  ]) {
    assert.match(dockerfile, new RegExp(nome.replace(/\./g, "\\.")), `${nome} fora do COPY`);
  }
});

test("o diagnóstico grava bytes crus, não só texto decodificado", async () => {
  const fonte = le("serial-listen.py");
  // O .bin é a prova. `errors="replace"` sozinho apaga o padrão de ruído.
  assert.match(fonte, /bin_path/);
  assert.match(fonte, /open\(bin_path, "ab"\)/);
  assert.match(fonte, /cru\.write\(pedaco\)/);
  // E o vigia também.
  const vigia = le("serial-watch.py");
  assert.match(vigia, /bin_path/);
  assert.match(vigia, /cru\.write\(pedaco\)/);
});

test("a classificação separa mudo, ruído e texto", async () => {
  for (const fonte of [le("baud-scan.py"), le("serial-listen.py")]) {
    assert.match(fonte, /RUIDO/);
    assert.match(fonte, /TEXTO/);
    assert.match(fonte, /MISTO/);
  }
  // O limiar importa: 0xFF seguido de zeros é 0% imprimível e TEM de cair em
  // RUIDO, não em "chegou dado".
  const scan = le("baud-scan.py");
  assert.match(scan, /0\.90/);
  assert.match(scan, /0\.50/);
});

test("a varredura de baud usa os bauds reais desta árvore", () => {
  const scan = le("baud-scan.py");
  // 1500000 é o console da X55 (medido); 115200 é o palpite natural para
  // PX30/RK3326 e não pode faltar na varredura.
  assert.match(scan, /1500000/);
  assert.match(scan, /115200/);
});

test("o vigia distingue 'porta ausente' de 'porta ocupada'", () => {
  const vigia = le("serial-watch.py");
  // O adaptador que cai do barramento faz /dev/ttyUSB* DESAPARECER. Acusar
  // "multiple access" nesse caso manda procurar processo concorrente onde não
  // há nenhum — foi o que a mensagem do pyserial sugeriu em 04/11.
  assert.match(vigia, /os\.path\.exists\(port\)/);
  assert.match(vigia, /AUSENTE/);
  assert.match(vigia, /SerialException/);
});

test("os scripts python compilam", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "serial-tools-"));
  try {
    for (const nome of [
      "baud-scan.py",
      "serial-listen.py",
      "serial-watch.py",
      "serial-loopback.py",
    ]) {
      const destino = path.join(dir, nome);
      writeFileSync(destino, le(nome));
      // `ast.parse` prova sintaxe sem precisar de pyserial instalado no host.
      execFileSync("python3", [
        "-c",
        `import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())`,
        destino,
      ]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o log de uma captura real tem o cabeçalho com baud e horário", () => {
  // Sem o cabeçalho, dois arquivos a bauds diferentes ficam indistinguíveis —
  // e a primeira pergunta ao analisar ruído é "em que baud isto foi lido?".
  const fonte = le("serial-listen.py");
  assert.match(fonte, /escuta a .* baud/);
  assert.match(fonte, /strftime/);
});
