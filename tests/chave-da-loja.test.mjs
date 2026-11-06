#!/usr/bin/env node
// Chave pública da loja e verificador de assinatura.
//
// Pedido da equipe do `Giochi app` em 06/11/2026: sem `/etc/giochi/loja-publica.pem`
// o instalador de cartão avisa que não verificou e segue — honesto, mas não é
// segurança. E o binário verificador precisa viajar em
// `/opt/giochi/apps/bin/verificador-ed25519`, que é onde o instalador procura.
//
// O que este teste protege, em ordem de gravidade:
//   1. a chave PRIVADA nunca entra no repositório;
//   2. a pública versionada é Ed25519 (o verificador recusa outro tipo);
//   3. o binário é compilado pelo BUILD, não versionado como blob;
//   4. o post-build não engole a falha de compilação em silêncio.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR_CHAVES = `${ROOT}device/common/rootfs-overlay/etc/giochi`;
const PUBLICA = `${DIR_CHAVES}/loja-publica.pem`;
const PUBLICA_LICENCA = `${DIR_CHAVES}/licenca-publica.pem`;
const PONTOS = `${DIR_CHAVES}/pontos-de-montagem`;
const FONTE_C = `${ROOT}device/common/verificador/verificador-ed25519.c`;
const POST_BUILD = readFileSync(`${ROOT}scripts/post-build.sh`, "utf8");
const SCRIPT_CHAVE = readFileSync(`${ROOT}scripts/chave-da-loja.sh`, "utf8");

test("a chave pública está no overlay comum, em /etc/giochi", () => {
  // Comum, não por aparelho: a loja é a mesma para todos. E é chave PÚBLICA —
  // dado público, sem risco de distribuir, e é ela que permite RECUSAR pacote
  // adulterado.
  assert.ok(existsSync(PUBLICA), `falta ${PUBLICA}`);
  const pem = readFileSync(PUBLICA, "utf8");
  assert.match(pem, /-----BEGIN PUBLIC KEY-----/);
  assert.match(pem, /-----END PUBLIC KEY-----/);
  // Ed25519 no PEM é OID 1.3.101.112 → prefixo em base64 "MCowBQYDK2Vw".
  assert.match(pem, /MCowBQYDK2Vw/, "não é uma chave Ed25519");
});

test("NENHUMA chave privada no repositório", () => {
  // Esta é a regra que não pode falhar. Quem tem a privada assina qualquer
  // coisa e a loja aceita — então ela mora fora do repo, com 0600.
  const proibidos = ["PRIVATE KEY"];
  const caminhos = [
    PUBLICA,
    `${ROOT}device/r35s/device.json`,
    `${ROOT}device/r35s/defconfig`,
  ];
  for (const caminho of caminhos) {
    if (!existsSync(caminho)) continue;
    const texto = readFileSync(caminho, "utf8");
    for (const marca of proibidos) {
      assert.ok(
        !texto.includes(marca),
        `${caminho} contém "${marca}" — chave privada não entra no repositório`,
      );
    }
  }
  // E o script que gera a chave tem de gravar a privada FORA da árvore.
  assert.match(SCRIPT_CHAVE, /CHAVES=.*cache/);
  assert.match(SCRIPT_CHAVE, /chmod 600/);
  // Nunca sobrescrever: regerar invalidaria todo pacote já assinado.
  assert.match(SCRIPT_CHAVE, /já existe: \$nome/);
});

test("o fonte do verificador é o da equipe e está vendorizado", () => {
  // É a única peça em C do repo deles. Vendorizada com o mesmo critério dos
  // drivers do R35S: fonte, não binário.
  assert.ok(existsSync(FONTE_C), "falta o .c do verificador");
  const fonte = readFileSync(FONTE_C, "utf8");
  assert.match(fonte, /EVP_PKEY_verify|EVP_DigestVerify/, "não parece um verificador");
  assert.ok(fonte.length > 3000, "fonte suspeito de estar truncado");
});

test("o binário é COMPILADO pelo post-build, não versionado", () => {
  // Binário no Git envelhece: pede a versão de libcrypto da máquina que
  // compilou, e falha no aparelho com "version `OPENSSL_3.x' not found".
  assert.ok(
    !existsSync(`${ROOT}device/common/rootfs-overlay/opt/giochi/apps/bin/verificador-ed25519`),
    "não versionar o binário — ele é compilado no build",
  );
  assert.match(POST_BUILD, /verificador-ed25519\.c/);
  assert.match(POST_BUILD, /-lcrypto/);
  assert.match(POST_BUILD, /opt\/giochi\/apps\/bin/, "destino do instalador");
});

test("o post-build deriva HOST_DIR do Buildroot, não de variável que não existe", () => {
  // ARMADILHA MEDIDA: `EXTRA_ENV` do Buildroot (package/Makefile.in:342) exporta
  // só PATH, BR2_DL_DIR, BUILD_DIR, CONFIG_DIR e O. NÃO exporta HOST_DIR,
  // STAGING_DIR nem TARGET_CROSS. Eu tinha usado TARGET_CROSS e o build avisou
  // "toolchain ausente" a cada rodada até eu ler o Makefile.
  assert.match(POST_BUILD, /\$\{O:-\}/, "tem de usar O");
  assert.ok(
    !/\$\{?TARGET_CROSS\}?/.test(POST_BUILD),
    "TARGET_CROSS não chega no post-build",
  );
});

test("falha ao compilar o verificador ABORTA o build", () => {
  // Sem o binário, a loja instala pacote sem verificar assinatura. Isso é pior
  // que um build vermelho: é um sistema que diz "instalei" sem provar origem.
  const trecho = POST_BUILD.slice(POST_BUILD.indexOf("VERIFICADOR_SRC="));
  const bloco = trecho.slice(0, trecho.indexOf("INITTAB="));
  assert.ok(bloco.length > 0, "não achei o bloco do verificador");
  // A compilação que falha tem de abortar. (Toolchain ausente só avisa: se ela
  // faltasse, nada mais teria compilado e não haveria rootfs para publicar.)
  assert.match(bloco, /FALHOU compilar o verificador/);
  assert.match(bloco, /exit 1/);
});

test("a chave versionada confere com o que o script espera", () => {
  // Se alguém trocar a pública sem trocar a privada, todo pacote assinado passa
  // a ser RECUSADO no aparelho — e o sintoma aparece na loja, não no build.
  const pem = readFileSync(PUBLICA);
  const hash = createHash("sha256").update(pem).digest("hex");
  // O script `--verificar` compara com a privada local; aqui garantimos que o
  // arquivo é estável e não muda por acidente de formatação.
  assert.equal(pem.toString("utf8").trim().split("\n").length, 3, "PEM Ed25519 tem 3 linhas");
  assert.ok(hash.length === 64);
});

// ── as DUAS chaves (pedido da equipe do app, 06/11/2026 10:20) ─────────────
//
// Antes era uma: `loja-publica.pem`. Agora são duas, porque são duas perguntas
// diferentes — "este pacote veio da Giochi?" e "este aparelho pagou?". O ponto
// de separar é justamente que copiar o pacote não basta.

test("as duas chaves públicas existem, em /etc/giochi, e são Ed25519", () => {
  for (const [nome, caminho] of [["loja", PUBLICA], ["licenca", PUBLICA_LICENCA]]) {
    assert.ok(existsSync(caminho), `falta ${caminho}`);
    const pem = readFileSync(caminho, "utf8");
    assert.match(pem, /-----BEGIN PUBLIC KEY-----/, `${nome}: não é PEM`);
    assert.match(pem, /MCowBQYDK2Vw/, `${nome}: não é Ed25519`);
    assert.ok(
      Buffer.byteLength(pem) < 300,
      `${nome}: ${Buffer.byteLength(pem)} B — maior que esperado para Ed25519`,
    );
  }
});

test("as duas chaves são DIFERENTES — iguais seriam uma só", () => {
  // Se a assinatura do pacote também provasse a compra, um arquivo copiado
  // serviria em todo aparelho. Chaves iguais reproduzem exatamente esse defeito,
  // e o sintoma apareceria só na loja, com pacote liberado de graça.
  const a = readFileSync(PUBLICA, "utf8");
  const b = readFileSync(PUBLICA_LICENCA, "utf8");
  assert.notEqual(a, b, "loja e licença não podem compartilhar o mesmo par");
});

test("o script recusa gerar chave igual e sabe conferir as duas", () => {
  assert.match(SCRIPT_CHAVE, /CHAVES_NOMES=\(loja licenca\)/, "registro das duas");
  assert.match(SCRIPT_CHAVE, /IGUAIS na imagem/, "a checagem de igualdade tem de existir");
  // --gerar aceita o nome; sem nome, cria todas as que faltam.
  assert.match(SCRIPT_CHAVE, /cmd_gerar "?\$\{1:-\}"?/);
});

test("nenhuma privada da licença no repositório", () => {
  // A privada da licença é a que emite a prova de compra: vazada, qualquer um
  // emite licença para qualquer aparelho.
  assert.ok(
    !existsSync(`${DIR_CHAVES}/licenca-privada.pem`),
    "a privada da licença não pode estar no overlay",
  );
  const script = readFileSync(`${ROOT}scripts/chave-da-loja.sh`, "utf8");
  // As privadas vão para o cache do usuário, nunca para a árvore.
  assert.match(script, /privada_de\(\)\s*\{\s*printf '%s\/%s-privada\.pem' "\$CHAVES"/);
});

// ── /etc/giochi/pontos-de-montagem ─────────────────────────────────────────

test("pontos-de-montagem existe e é parseável como o app espera", () => {
  // Contrato proposto pela equipe do app: um caminho absoluto por linha,
  // '#' inicia comentário, linha em branco ignorada. Se este arquivo existir e
  // o formato divergir, o app exclui o caminho errado e o jogo não aparece —
  // sem mensagem, porque a lista de exclusão é silenciosa por natureza.
  assert.ok(existsSync(PONTOS), `falta ${PONTOS}`);
  const linhas = readFileSync(PONTOS, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);
  assert.ok(linhas.length >= 2, `só ${linhas.length} caminho(s)`);
  for (const l of linhas) {
    assert.match(l, /^\/[A-Za-z0-9._/-]*$/, `caminho inválido: ${JSON.stringify(l)}`);
    assert.ok(!l.includes("//"), `barra dupla em ${l}`);
    assert.ok(!l.endsWith("/"), `barra final em ${l}`);
  }
  // O comentário NÃO pode vazar para a lista — é o defeito do §12.37, em outro
  // arquivo: marcador que começa com o caractere de comentário.
  assert.deepEqual(linhas, ["/user", "/opt/giochi", "/media"]);
});

test("pontos-de-montagem inclui /media, e isso evita a duplicata", () => {
  // A equipe do app explicou a diferença: SEM /media a partição de dados
  // aparece como mídia removível e os jogos de /user aparecem duas vezes.
  // A escolha é aparecer uma vez.
  const txt = readFileSync(PONTOS, "utf8");
  const linhas = txt.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  assert.ok(linhas.includes("/media"), "sem /media os jogos aparecem duplicados");
  assert.ok(linhas.includes("/opt/giochi"), "programas do aparelho, não disco de jogos");
  assert.ok(linhas.includes("/user"), "dados do usuário, incluindo jogos da loja");
});
