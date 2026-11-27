import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const DOC = path.join(ROOT, "docs/evaluacao-ppsspp.md");

// PPSSPP é GPL-2.0-or-later (LICENSE.TXT do repo oficial, linhas 328-329, e a
// receita do ROCKNIX confirma: `PKG_LICENSE="GPL-2.0-or-later"`). Pela regra do
// §15 — "GPL, AGPL e LGPL ficam fora da imagem assinada" — ele não pode estar em
// nenhuma configuração desta árvore. O caminho é app de loja em /user, como o
// PortMaster (§32).
//
// Estes testes prendem os FATOS da avaliação de 26/11/2026, não a decisão: se
// alguém decidir mudar, o teste força a conversa (e o motivo escrito) em vez de
// deixar passar em silêncio.

test("PPSSPP não está em nenhuma configuração da árvore (GPL fora da imagem)", async () => {
  const dirs = ["config", "buildroot-external"];
  const arquivos = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    try {
      for (const f of await readdir(abs, { recursive: true })) arquivos.push(path.join(abs, f));
    } catch {
      /* pasta pode não existir */
    }
  }
  const devices = await readdir(path.join(ROOT, "device"));
  for (const d of devices) {
    const abs = path.join(ROOT, "device", d);
    try {
      for (const f of await readdir(abs, { recursive: true })) {
        const p = path.join(abs, f);
        if (/\.(fragment|defconfig|txt|mk)$/.test(f) || f === "device.json") arquivos.push(p);
      }
    } catch {
      /* não é pasta */
    }
  }

  const culpados = [];
  for (const p of arquivos) {
    let t;
    try {
      t = await readFile(p, "utf8");
    } catch {
      continue;
    }
    if (/BR2_PACKAGE_PPSSPP|BR2_PACKAGE_LIBRETRO_PPSSPP|ppsspp/i.test(t)) {
      culpados.push(path.relative(ROOT, p));
    }
  }
  assert.deepEqual(
    culpados,
    [],
    "PPSSPP achado em configuração da imagem: " +
      culpados.join(", ") +
      "\n  PPSSPP é GPL-2.0-or-later e a regra do §15 recusa GPL na imagem" +
      "\n  assinada. Ele entra como app de loja em /user, não como pacote.",
  );
});

test("o documento declara a licença com a fonte, e não só a conclusão", async () => {
  const t = await readFile(DOC, "utf8");
  assert.match(t, /GPL-2\.0-or-later/, "o veredito de licença tem de estar escrito");
  // A fonte importa: "é GPL" sem de onde veio vira lenda na terceira sessão.
  assert.match(t, /LICENSE\.TXT/i, "cite o arquivo de onde a licença foi lida");
  assert.match(t, /PKG_LICENSE/, "e a confirmação independente (receita do ROCKNIX)");
  assert.match(t, /§15|§32/, "aponte para a regra que aplica o bloqueio");
});

test("o que NÃO foi medido está marcado como não medido", async () => {
  const t = await readFile(DOC, "utf8");
  // A tentação deste documento é prometer "roda a 30 fps". Ninguém mediu.
  assert.match(t, /não medido|Não medi|não foi medido/i, "declare a lacuna");
  assert.match(t, /A35|Cortex-A35/, "o hardware do pior caso tem de estar nomeado");
  // E o teto medido do G31 precisa estar aqui: é o único número que existe.
  assert.match(t, /192 Mpix\/s|981 MiB/, "cite a medição que existe (§12.63)");
});

test("o FUSE continua registrado como pendência, com o sintoma", async () => {
  const t = await readFile(DOC, "utf8");
  assert.match(t, /CONFIG_FUSE_FS/, "o símbolo tem de estar nomeado");
  assert.match(t, /=m/, "e o estado real dele (=m, e nenhum aparelho tem autoload)");
  // O sintoma é o que economiza a tarde de quem for investigar.
  assert.match(t, /fusermount|autoload|S15modules/, "diga como se manifesta");
});

test("o caminho de app em /user é o único permitido, e está escrito", async () => {
  const t = await readFile(DOC, "utf8");
  assert.match(t, /\/user/, "o destino do pacote é /user (loja), não a imagem");
  const t2 = await readFile(path.join(ROOT, "docs/evaluacao-portmaster.md"), "utf8");
  assert.match(
    t2,
    /app de loja|loja/,
    "o precedente (PortMaster) tem de continuar dizendo o mesmo",
  );
});
