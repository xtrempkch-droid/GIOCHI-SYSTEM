import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { ROOT } from "../scripts/lib/devices.mjs";

// O CAMINHO DE LOGIN do `serial-push-blob.py` estava QUEBRADO por tipos.
//
//   if b"login:" in saida:            <- saida é STR (o drenar decodifica)
//   print(saida[-500:].decode(...))   <- str não tem .decode
//
// O primeiro dava TypeError e o segundo AttributeError — os dois no caminho que
// SÓ roda quando a console não está num shell (login expirado, `giochi-init`
// imprimindo no meio), que é exatamente o caso que o bloco existe para
// recuperar. O caminho feliz (sessão já aberta) nunca passava por ali, então o
// script "funcionou" por meses com o código de recuperação morto.
//
// Nenhum teste pegava porque a suíte só fazia `ast.parse` nos scripts Python:
// sintaxe passa, e o erro é de TIPOS em tempo de execução.
//
// Este teste executa o script DE VERDADE com um módulo `serial` falso:
// respostas roteirizadas ("login: ", depois "# ") e relógio acelerado. Se o
// caminho de login quebrar de novo, o script morre com traceback antes do OK.

const SCRIPT = path.join(ROOT, "docker", "serial-push-blob.py");

function esperadoBase64(payload) {
  const encoded = Buffer.from(payload).toString("base64");
  const linhas = Math.ceil(encoded.length / 76);
  return { encoded, tamanhoNoDisco: encoded.length + linhas };
}

// `python3` e o nome no Linux/macOS; no Windows o interpretador costuma ser
// apenas `python`. Sem esta resolucao, o teste falha por NOME DE EXECUTAVEL e
// nao por comportamento -- foi o que aconteceu no Windows, onde o `python3` do
// PATH e o atalho da Microsoft Store respondendo "Python nao foi encontrado".
function acharPython() {
  for (const nome of ["python3", "python"]) {
    try {
      execFileSync(nome, ["-c", "import sys"], { stdio: "ignore" });
      return nome;
    } catch {
      // tenta o proximo nome
    }
  }
  return null;
}

// `-X utf8` + `PYTHONIOENCODING`: no Windows o stdout do Python usa a code page
// ANSI, entao "nao" com til sai em cp1252 e chega corrompido do lado de ca. O
// teste compara texto acentuado e falharia por encoding, nao por comportamento.
const PYTHON = acharPython();
const HARNESS = String.raw`
import sys, types

class FakeSerial:
    def __init__(self, port, baud, timeout=0.3):
        self.queue = list(RESPOSTAS)
        self.writes = []
        self._apos_write = False
    def write(self, dado):
        self.writes.append(dado)
        # Um item por DRENAGEM: o drenar do script lê em laço ate a janela de
        # tempo fechar, e sem esta guarda a primeira drenagem consumia a fila
        # inteira. A resposta sai na primeira leitura depois de um write, que e
        # o formato real do protocolo (pergunta -> resposta -> silencio).
        self._apos_write = True
    def read(self, n):
        if self._apos_write and self.queue:
            self._apos_write = False
            return self.queue.pop(0)
        return b""
    def flush(self):
        pass
    def reset_input_buffer(self):
        pass
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass

serial = types.ModuleType("serial")
serial.Serial = FakeSerial
sys.modules["serial"] = serial

# sleep anulado: as esperas do script somam ~15 s e não testam nada num
# transporte falso. O RELOGIO fica real de proposito: as janelas de drenar
# dependem dele para fazer exatamente uma leitura útil cada.
import time as _tempo_real
_tempo_real.sleep = lambda s: None

sys.argv = ["serial-push-blob.py", "/dev/ttyUSB0", "1500000", ARQUIVO, "/tmp/alvo.bin"]

with open(SCRIPT, encoding="utf-8") as fonte:
    exec(compile(fonte.read(), SCRIPT, "exec"))
`;

function roteiro(payload, md5) {
  const { tamanhoNoDisco } = esperadoBase64(payload);
  const vazio = () => Buffer.alloc(0);
  return [
    Buffer.from("giochi-system-r35s login: "), // tem_shell #1 — sem "#", tem login
    vazio(),                              // drenar após "root"
    Buffer.from("# "),                    // tem_shell #2 — shell alcançado
    vazio(),                              // drenar após "stty -echo"
    vazio(),                              // drenar após truncar o .b64
    vazio(),                              // drenar após Ctrl-C
    vazio(),                              // drenar após "stty echo"
    Buffer.from(`${tamanhoNoDisco}\n`),   // wc -c
    vazio(),                              // drenar após "base64 -d"
    Buffer.from(`${md5}  /tmp/alvo.bin\n`), // md5sum
  ];
}

test("o caminho de login recupera e completa a transferência", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "giochi-login-"));
  const arquivo = path.join(dir, "payload.bin");
  const payload = Buffer.from("Giochi System auditoria de tipos\n", "utf8");
  writeFileSync(arquivo, payload);

  const md5 = createHash("md5").update(payload).digest("hex");
  const respostas = roteiro(payload, md5);

  const codigo = HARNESS
    .replaceAll("RESPOSTAS", JSON.stringify(respostas.map((b) => [...b])))
    .replaceAll("ARQUIVO", JSON.stringify(arquivo))
    .replaceAll("SCRIPT", JSON.stringify(SCRIPT));

  try {
    const saida = execFileSync(PYTHON, ["-X", "utf8", "-c", codigo], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.match(saida, /md5 local: [0-9a-f]{32}/);
    assert.match(saida, /md5 remoto: [0-9a-f]{32}/);
    assert.match(saida, /OK: md5 confere dos dois lados/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem shell nenhum, o script diz o motivo em vez de morrer de TypeError", () => {
  // O segundo defeito do mesmo caminho: quando nem o login salva, o script
  // imprimia `saida[-500:].decode(...)` — AttributeError, traceback, e o
  // operador sem o diagnóstico que a mensagem existia para dar.
  const dir = mkdtempSync(path.join(tmpdir(), "giochi-semlogin-"));
  const arquivo = path.join(dir, "payload.bin");
  writeFileSync(arquivo, "x");

  // A console devolve só ruído: nem "#", nem "login:".
  const respostas = [Buffer.from("~~ ruído ~~\r\n")];
  const codigo = HARNESS
    .replaceAll("RESPOSTAS", JSON.stringify(respostas.map((b) => [...b])))
    .replaceAll("ARQUIVO", JSON.stringify(arquivo))
    .replaceAll("SCRIPT", JSON.stringify(SCRIPT));

  try {
    assert.throws(
      () => execFileSync(PYTHON, ["-X", "utf8", "-c", codigo], { encoding: "utf8", stdio: "pipe", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }),
      (erro) => {
        const junto = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
        assert.match(junto, /não cheguei a um shell/, "tem de dizer o motivo");
        assert.ok(!/TypeError|AttributeError|Traceback/.test(junto), "traceback no lugar da mensagem");
        assert.equal(erro.status, 8);
        return true;
      },
      "o script precisa sair 8 com a mensagem, não morrer de TypeError",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o arquivo-fonte não tem comparação de bytes contra string decodificada", () => {
  // A regra da classe, para não depender só do teste comportamental: dentro
  // deste script, `drenar` devolve STR, e comparar com literal de bytes ou
  // chamar .decode em cima é o mesmo erro duas vezes.
  const fonte = readFileSync(SCRIPT, "utf8");
  const linhas = fonte.split("\n");
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (/b"[^"]*"\s+in\s+saida\b/.test(linha)) {
      assert.fail(`linha ${i + 1}: bytes em str — use "…" in saida`);
    }
    if (/saida\[[^\]]*\]:?\.\s*decode\(/.test(linha) || /saida\[[^\]]*\]\.decode\(/.test(linha)) {
      assert.fail(`linha ${i + 1}: .decode em str — saida já é texto`);
    }
  }
});
