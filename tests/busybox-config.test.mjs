import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// O BUSYBOX É O TERCEIRO KCONFIG — e era o único sem gate.
//
// `assert-config.mjs` cobre os `BR2_*` do Buildroot; `assert-kernel-config.mjs`
// cobre os `CONFIG_*` do kernel. O busybox resolve o próprio `.config` com um
// `olddefconfig` próprio, e ninguém verificava o resultado.
//
// Medido em 08/11/2026 no `.config` real do busybox 1.36.1 do build do R35S —
// quatro linhas do `config/common.busybox.fragment`, o arquivo que define o
// "sistema base" de TODO aparelho, não faziam o que diziam:
//
//   CONFIG_FEATURE_TAR_GZIP=y    -> símbolo NÃO EXISTE desde o 1.31
//   CONFIG_FEATURE_TAR_XZ=y      -> idem
//   CONFIG_FEATURE_PS_WIDE=y     -> `depends on ... && !DESKTOP`, e DESKTOP=y
//   CONFIG_FEATURE_CROND_DIR=y   -> o símbolo é STRING, não bool
//
// Nenhum com aviso. O `tar xzf` que o fragmento prometia simplesmente não
// funcionava no aparelho.

const FRAGMENT = path.join(ROOT, "config", "common.busybox.fragment");
const ASSERT = path.join(ROOT, "scripts", "assert-busybox-config.mjs");

function configSintetico(linhas) {
  const dir = mkdtempSync(path.join(tmpdir(), "giochi-bb-"));
  const arquivo = path.join(dir, ".config");
  writeFileSync(arquivo, linhas.join("\n") + "\n");
  return arquivo;
}

function rodar(config, fragment) {
  return execFileSync("node", [ASSERT, "--config", config, "--fragment", fragment], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

test("o assert morde: símbolo inexistente reprova", () => {
  const frag = path.join(mkdtempSync(path.join(tmpdir(), "giochi-bbf-")), "f.g");
  writeFileSync(frag, "CONFIG_FEATURE_TAR_GZIP=y\n");
  const config = configSintetico(["CONFIG_DESKTOP=y"]);
  assert.throws(() => rodar(config, frag), (erro) => {
    const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
    assert.match(saida, /AUSENTE no busybox/);
    assert.match(saida, /CONFIG_FEATURE_TAR_GZIP/);
    return true;
  });
});

test("o assert morde: símbolo que cai para 'is not set' reprova", () => {
  // O caso do FEATURE_PS_WIDE: existe no Kconfig, mas `depends on !DESKTOP`
  // não é satisfeito, então o valor pedido é descartado.
  const frag = path.join(mkdtempSync(path.join(tmpdir(), "giochi-bbf-")), "f.g");
  writeFileSync(frag, "CONFIG_FEATURE_PS_WIDE=y\n");
  const config = configSintetico(["CONFIG_DESKTOP=y", "# CONFIG_FEATURE_PS_WIDE is not set"]);
  assert.throws(() => rodar(config, frag), (erro) => {
    const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
    assert.match(saida, /VALOR DIFERENTE/);
    assert.match(saida, /ficou is not set/);
    return true;
  });
});

test("o assert morde: símbolo STRING pedido como booleano reprova", () => {
  // `FEATURE_CROND_DIR` é `string` no Kconfig do busybox. `=y` é descartado e
  // o default fica — o efeito desejado por um caminho que não era o escrito.
  const frag = path.join(mkdtempSync(path.join(tmpdir(), "giochi-bbf-")), "f.g");
  writeFileSync(frag, "CONFIG_FEATURE_CROND_DIR=y\n");
  const config = configSintetico(['CONFIG_FEATURE_CROND_DIR="/var/spool/cron"']);
  assert.throws(() => rodar(config, frag), (erro) => {
    const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
    assert.match(saida, /VALOR DIFERENTE/);
    assert.match(saida, /\/var\/spool\/cron/);
    return true;
  });
});

test("símbolo presente com o valor certo passa", () => {
  const frag = path.join(mkdtempSync(path.join(tmpdir(), "giochi-bbf-")), "f.g");
  writeFileSync(frag, "CONFIG_UDHCPD=y\nCONFIG_TIMEOUT=y\n");
  const config = configSintetico(["CONFIG_UDHCPD=y", "CONFIG_TIMEOUT=y"]);
  const saida = rodar(config, frag);
  assert.match(saida, /assert-busybox-config: OK — 2 applet/);
});

test("o fragmento comum não repete os quatro símbolos que não funcionavam", () => {
  const texto = readFileSync(FRAGMENT, "utf8");
  const codigo = texto
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  for (const morto of [
    "CONFIG_FEATURE_TAR_GZIP",
    "CONFIG_FEATURE_TAR_XZ",
    "CONFIG_FEATURE_PS_WIDE",
    "CONFIG_FEATURE_CROND_DIR",
  ]) {
    assert.ok(!new RegExp(`^${morto}=`, "m").test(codigo), `${morto} voltou (não existe/são impossíveis)`);
  }
  // E os nomes CERTOS do Kconfig 1.36.1 têm de estar lá, senão `tar xzf` some.
  assert.match(codigo, /^CONFIG_FEATURE_SEAMLESS_GZ=y$/m);
  assert.match(codigo, /^CONFIG_FEATURE_SEAMLESS_XZ=y$/m);
});

test("o build chama o assert do busybox, e antes de coletar artefatos", () => {
  const build = readFileSync(path.join(ROOT, "scripts", "build-device.sh"), "utf8");
  const chamada = build.indexOf("assert-busybox-config.mjs");
  assert.ok(chamada > 0, "o gate do busybox não está ligado no build");

  const coleta = build.indexOf('echo "Coletando artefatos..."');
  assert.ok(coleta > chamada, "o gate tem de rodar antes de os artefatos serem copiados");

  // Falha de gate tem de derrubar o build, não avisar.
  const trecho = build.slice(chamada - 400, chamada + 900);
  assert.match(trecho, /exit 1/, "gate que avisa e segue não é gate");
});

test("o fragmento comum não manda scp/sftp virem do dropbear", () => {
  // §10-A: dropbear foi REMOVIDO da imagem (os dois disputavam a porta 22 e o
  // `scp` do OpenSSH 9+ é SFTP, que o dropbear não tem). O comentário dizia o
  // contrário, e comentário que contradiz a imagem manda a próxima pessoa
  // procurar `scp` no lugar errado.
  //
  // A asserção é sobre a AFIRMAÇÃO ("vêm do dropbear"), não sobre a palavra
  // `dropbear`: o comentário corrigido cita o dropbear justamente para dizer que
  // ele não está mais lá, e uma regex frouxa reprovaria a própria correção.
  const texto = readFileSync(FRAGMENT, "utf8");
  const afirmacao = texto
    .split("\n")
    .filter((l) => l.trimStart().startsWith("#"))
    .find((l) => /scp[^.]*\b(do|pelo|via)\s+dropbear/i.test(l));
  assert.equal(afirmacao, undefined, `comentário desatualizado: ${afirmacao}`);
});
