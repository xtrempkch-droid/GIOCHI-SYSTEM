import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do RUNTIME do PortMaster na imagem (config/portmaster.fragment).
//
// A avaliação (`docs/evaluacao-portmaster.md`) responde "dá para pôr?" e "quanto
// custa". Este arquivo prende a parte que, se mudar sem ninguém notar, produz
// imagem que parece certa e GUI que não abre — que é o padrão deste repositório
// desde o §12.1.
//
// As três listas abaixo foram MEDIDAS em 20/11/2026, rodando o PortMaster de
// verdade no R35S, não lendo o código dele:
//
//   1. `xml` ausente  -> "No module named 'xml'" no import do harbourmaster
//   2. `lzma` ausente -> "unable to extract the Noto fonts"
//   3. o resto        -> os imports de `pylibs/` cruzados com o `python3.mk`

const FRAGMENT = path.join(ROOT, "config/portmaster.fragment");

async function fragmento() {
  return readFile(FRAGMENT, "utf8");
}

test("o fragmento existe e é opt-in, com o custo medido escrito nele", async () => {
  const t = await fragmento();
  // Número estimado não pode virar número medido, nem o contrário: o fragmento
  // é onde quem builda olha primeiro.
  assert.match(t, /22,7 MiB/, "o custo medido tem de estar no fragmento");
  assert.match(t, /GIOCHI_WITH_PORTMASTER=1/);
  assert.match(t, /OPCIONAL/i);
});

test("python3 entra com os módulos que o PortMaster importa", async () => {
  const t = await fragmento();
  const exigidos = [
    ["BR2_PACKAGE_PYTHON3=y", "o interpretador (o pugwash é '#!/usr/bin/env python3')"],
    ["BR2_PACKAGE_PYTHON3_SSL=y", "requests → _ssl e _hashlib"],
    ["BR2_PACKAGE_PYTHON3_ZLIB=y", "zipfile, que extrai o pylibs.zip"],
    ["BR2_PACKAGE_PYTHON3_UNICODEDATA=y", "idna importa unicodedata"],
    ["BR2_PACKAGE_PYTHON3_PYEXPAT=y", "harbourmaster/util/proxy.py → xml.etree"],
    ["BR2_PACKAGE_PYTHON3_XZ=y", "as Noto fonts do pylibs são .xz"],
  ];
  for (const [simbolo, motivo] of exigidos) {
    assert.match(t, new RegExp(`^${simbolo}$`, "m"), `falta ${simbolo} (${motivo})`);
  }
});

test("bz2 fica de fora com o motivo, e não por esquecimento", async () => {
  const t = await fragmento();
  // O único uso é o sink de log `.bz2` do loguru, que este fluxo não escolhe.
  // Se alguém acrescentar, tem de apagar a justificativa — o teste reprova nos
  // dois lados para a decisão não virar folclore.
  assert.doesNotMatch(t, /^BR2_PACKAGE_PYTHON3_BZIP2=y$/m);
  assert.match(t, /bz2/i);
  assert.match(t, /loguru/i);
});

test("bubblewrap é o sandbox, e o giochi-ports diz o que ele NÃO garante", async () => {
  const t = await fragmento();
  assert.match(t, /^BR2_PACKAGE_BUBBLEWRAP=y$/m);

  // Prometer mais do que ele entrega é o defeito do §12.15 com outra roupa: o
  // port roda como root DENTRO do namespace e /user é gravável. Quem lê o
  // `giochi-ports` tem de saber disso antes de confiar no isolamento.
  const bin = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  assert.match(bin, /N[ÃA]O garante|nao garante/i);
  assert.match(bin, /\/user.{0,40}grav[áa]vel/is, "tem de dizer que /user é gravável");
});

test("o pacote do PortMaster NÃO está no fragmento, e o motivo é licença", async () => {
  const t = await fragmento();
  // A linha que impede a recaída: o zip traz gptokeyb2 (GPL-2.0) e 7zzs
  // (LGPL-2.1). Se alguém "resolver" o problema embarcando o pacote, a imagem
  // deixa de poder ser publicada (§15).
  assert.match(t, /GPL-2\.0/);
  assert.match(t, /LGPL/);
  assert.match(t, /\/user/, "o pacote mora em /user, fora da imagem");
});

test("o giochi-ports existe, é executável e usa bubblewrap", async () => {
  const bin = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports");
  const st = await stat(bin);
  // Modo no disco; o do índice do Git é conferido pelo selftest-contract.
  assert.ok(st.mode & 0o111, "giochi-ports sem bit de execução — serviço que não sobe (§12.50)");

  const t = await readFile(bin, "utf8");
  // O desenho do sandbox, item por item. Cada um destes some em silêncio e o
  // resultado é "roda, mas sem isolamento" — que ninguém percebe.
  assert.match(t, /--ro-bind \/ \//, "rootfs tem de ser somente-leitura");
  assert.match(t, /--dev-bind \/dev \/dev/, "DRM/input/uinput/tty0/snd vêm do /dev do aparelho");
  assert.match(t, /--bind \/user \/user/, "é onde ele escreve: ports, jogos, runtimes");
  assert.match(t, /--unshare-all/, "sem namespaces não há isolamento de processo");
  assert.match(t, /--share-net/, "sem rede ele não instala nada, e o sintoma é mudo");
  assert.match(t, /--die-with-parent/, "port órfão segurando o DRM é o §12.45");
});

test("o giochi-ports recusa rodar sem sandbox a menos que seja pedido", async () => {
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // A regra do repositório: falha explícita em vez de rodar pior sem avisar.
  assert.match(t, /--sem-sandbox/);
  assert.match(t, /Recusando rodar codigo de terceiro/);
  // E o caminho de escape tem de DIZER o que está abrindo.
  assert.match(t, /rootfs gravavel/);
});

test("o giochi-ports avisa quando /roms não existe", async () => {
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // Medido no R35S: sem /roms, o control.txt falha em SILÊNCIO ao carregar
  // funcs.txt, e os ports ficam sem pm_finish/pm_message. O aviso é a única
  // pista que sobra.
  assert.match(t, /\/roms nao existe/);
  assert.match(t, /funcs\.txt/);
});

test("o build-device.sh liga o fragmento no prepare-config", async () => {
  const t = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");
  assert.match(t, /GIOCHI_WITH_PORTMASTER/);
  assert.match(t, /PORTMASTER_FRAGMENT_ARGS=\(--fragment/);
  // A linha tem de estar na chamada do prepare-config, não só declarada — foi
  // o defeito do §12.59 (achado 1: variável lida direito, gate desligado).
  const chamada = t.slice(t.indexOf('node "$ROOT/scripts/prepare-config.mjs"'));
  const fim = chamada.indexOf("make -C");
  const bloco = chamada.slice(0, fim);
  assert.match(bloco, /PORTMASTER_FRAGMENT_ARGS/, "o array não chega ao prepare-config");
});

test("o post-build grava OS_NAME e o symlink /roms", async () => {
  const t = await readFile(path.join(ROOT, "scripts/post-build.sh"), "utf8");
  // Medido no R35S: o control.txt resolve o nome por OS_NAME → NAME → ID, e sem
  // OS_NAME o CFW_NAME sai "Buildroot" — que colide com qualquer imagem
  // Buildroot do mundo e faz o mod_<CFW>.txt procurar o arquivo errado.
  assert.match(t, /OS_NAME=/, "sem OS_NAME o CFW_NAME é 'Buildroot'");
  assert.match(t, /ln -sfn \/user .*roms|ln -sfn \/user "\$TARGET_DIR\/roms"/);
  // E o motivo de ser symlink e não `directory=user` no mod: medido numa
  // amostra de 25 ports, 7 citam /roms literalmente.
  assert.match(t, /7 citam/, "o número medido tem de estar no comentário");
});
