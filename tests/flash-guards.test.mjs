import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// GUARDAS DE DESTINO — a mesma pergunta nos dois scripts que gravam cartão.
//
// `flash-dd.sh` nasceu em 06/11/2026 com três guardas: dispositivo de bloco,
// removível, e "não é o disco de `/` nem de `/boot`". A terceira é a que importa
// quando o host roda num SSD USB ou num cartão: nesse caso "removível" é
// verdade para o disco do sistema, e gravar nele apaga o computador de quem
// está trabalhando.
//
// `flash-sd.sh` — o script com MAIS recursos (SHA256, --grow, --expect-gib) —
// não tinha essa guarda. O teste é sobre a CLASSE (§12.50): os dois scripts que
// gravam cartão precisam perguntar pela mesma coisa, e não só aquele onde a
// guarda foi escrita primeiro.

const DESTRUTIVOS = ["flash-sd.sh", "flash-dd.sh"];

function codigo(texto) {
  return texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
}

for (const nome of DESTRUTIVOS) {
  test(`${nome}: recusa gravar no disco que sustenta o /`, async () => {
    const script = path.join(ROOT, "scripts", nome);
    const corpo = codigo(await readFile(script, "utf8"));
    assert.match(corpo, /findmnt -no SOURCE \//, "tem de perguntar onde está o /");
    assert.match(corpo, /findmnt -no SOURCE \/boot/, "e o /boot, que pode ser outro disco");
    assert.match(
      corpo,
      /lsblk -nlo PKNAME/,
      "o nome do disco pai sai de PKNAME — comparar /dev/sdb2 com /dev/sdb não acha nada",
    );
    assert.match(corpo, /Recusando/, "e tem de recusar, não avisar");
  });
}

test("a guarda do disco de sistema está ANTES do dd, nos dois scripts", async () => {
  for (const nome of DESTRUTIVOS) {
    const corpo = codigo(await readFile(path.join(ROOT, "scripts", nome), "utf8"));
    const guarda = corpo.indexOf("findmnt -no SOURCE /");
    const dd = corpo.indexOf("dd if=");
    assert.ok(guarda > 0, `${nome}: a guarda sumiu`);
    assert.ok(dd > guarda, `${nome}: a guarda passou para depois da gravação`);
  }
});

test("flash-sd.sh confere o tamanho e o disco antes de apagar qualquer coisa", async () => {
  const corpo = codigo(await readFile(path.join(ROOT, "scripts", "flash-sd.sh"), "utf8"));
  const confirmacao = corpo.indexOf("TODO O CONTEÚDO DO CARTÃO SERÁ APAGADO");
  const guardaDisco = corpo.indexOf("findmnt -no SOURCE /");
  assert.ok(guardaDisco < confirmacao, "a checagem tem de vir antes do aviso de apagar");
});
