import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do `flash-dd.sh`, escrito em 06/11/2026.
//
// Origem: o `flash-sd.sh` (com verificação de SHA256 e `--grow`) não deu certo
// no X35H, e no diagnóstico não dava para separar "cartão ruim" de "a
// conferência está errada". O script mínimo existe para responder isso por
// subtração: se não boota com `dd` puro, o problema não é a gravação.
//
// O que estes testes protegem é o que NÃO pode ser simplificado: as guardas que
// impedem gravar no disco errado. Gravar no disco errado não tem desfazer.

const SCRIPT = path.join(ROOT, "scripts/flash-dd.sh");
const ler = () => readFile(SCRIPT, "utf8");

test("o script existe e é executável no índice do Git", async () => {
  const modo = (await stat(SCRIPT)).mode;
  assert.ok(modo & 0o111, "flash-dd.sh não é executável");
});

test("o --help sai limpo, e não imprime o corpo do script", () => {
  const ajuda = execFileSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.match(ajuda, /dd e mais nada/);
  assert.ok(!/set -euo/.test(ajuda), "--help imprimiu o corpo do script");
  assert.ok(ajuda.length < 2000, `--help com ${ajuda.length} chars: faixa errada`);
});

test("é dd puro: sem sha256, sem resize, sem expect-gib", async () => {
  // A graça do script é ser MENOS que o flash-sd.sh. Se alguém "melhorar" ele
  // aqui, perde-se a única coisa que ele oferece: a resposta por subtração.
  const texto = await ler();
  const executavel = texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(!/sha256sum/.test(executavel), "não pode verificar SHA256");
  assert.ok(!/resize2fs/.test(executavel), "não pode crescer partição");
  assert.ok(!/expect-gib/.test(executavel), "não pode recusar por tamanho");
  assert.match(executavel, /dd if="\$IMAGEM" of="\$DESTINO" bs=4M conv=fsync/);
});

test("as três guardas de destino continuam, e são do código executável", async () => {
  const texto = await ler();
  const executavel = texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  // 1. disco inteiro, não partição
  assert.match(executavel, /\[\[ -b "\$DESTINO" \]\]/);
  // 2. removível
  assert.match(executavel, /removable.*!= "1"/);
  // 3. não é o disco de / nem de /boot — o sistema pode estar em USB, e nesse
  //    caso "removível" não protege nada.
  assert.match(executavel, /findmnt -no SOURCE \//);
  assert.match(executavel, /findmnt -no SOURCE \/boot/);
});

test("recusa destino com partição montada", async () => {
  // `dd` escreve mesmo assim, mas o kernel mantém o cache do fs antigo e a
  // próxima leitura devolve lixo — o sintoma vira "cartão corrompido".
  const texto = await ler();
  assert.match(texto, /lsblk -nlo MOUNTPOINT/);
  assert.match(texto, /Desmonte antes/);
});

test("sem --yes ele pede confirmação por digitação, não por Enter", async () => {
  const texto = await ler();
  assert.match(texto, /read -r -p .*confirma/);
  assert.match(texto, /\[\[ "\$confirma" == "\$DESTINO" \]\]/);
});

test("o README de gravação documenta o método tradicional e o custo medido", async () => {
  const doc = await readFile(path.join(ROOT, "docs/flashing.md"), "utf8");
  assert.match(doc, /flash-dd\.sh/);
  assert.match(doc, /61 s, 35 MB\/s/, "o custo medido tem de estar registrado");
  // O motivo de existir precisa estar escrito: sem isso alguém apaga o script
  // por parecer redundante com o flash-sd.sh.
  assert.match(doc, /o problema \*\*não é a gravação\*\*/);
});
