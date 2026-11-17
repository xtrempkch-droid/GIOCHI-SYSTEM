// O controle virtual: a garantia de que todo aparelho responde IGUAL.
//
// Existe por causa da pergunta que fechou a sessão de 17/11/2026: "qualquer jogo
// vai funcionar igual em consoles diferentes, ou vou viver adaptando código?".
// A resposta que este repositório passou a dar é: **igual**, porque o serviço
// `giochi-gamepad` publica UM device com o layout do contrato, e cada aparelho
// entra no ecossistema editando o próprio `buttons.map`.
//
// O que estes testes prendem, em ordem de importância:
//
//   1. o layout canônico é o mesmo, e o mapa consegue traduzir mapas reais dos
//      três aparelhos — inclusive o X35S, que troca A/B de propósito;
//   2. a normalização do eixo está certa, com faixa invertida incluída (o
//      `adc-joystick` da X55 declara o Y como 1023..15);
//   3. o kernel tem `CONFIG_INPUT_UINPUT` nos três, senão o daemon não cria
//      nada e o sistema volta ao comportamento por aparelho — em SILÊNCIO;
//   4. o `gamecontrollerdb.txt` cobre o GUID que o daemon realmente cria, e o
//      `giochi-init` o exporta (sem isso o `Button::A` do SDL é o botão de
//      baixo, e as duas vias discordam de novo).
//
// Os testes 1 e 2 executam o binário de verdade (`--listar`), compilado com o
// gcc do host. Não precisam de `/dev/uinput`, de aparelho nem de root — o que os
// torna baratos e utilizáveis no CI.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("..", import.meta.url).pathname;
const SRC = join(RAIZ, "device/common/giochi-gamepad/giochi-gamepad.c");
const DB = join(RAIZ, "device/common/giochi-gamepad/gamecontrollerdb.txt");
const INIT = join(RAIZ, "device/common/rootfs-overlay/usr/bin/giochi-init");
const S52 = join(RAIZ, "device/common/rootfs-overlay/etc/init.d/S52gamepad");


// Tira comentário antes de afirmar sobre CÓDIGO.
//
// Lição paga duas vezes nesta sessão: os comentários deste repositório citam os
// mecanismos proibidos para explicar por que são proibidos ("não usamos
// EVIOCGRAB porque…"), e um `doesNotMatch` no arquivo inteiro reprova o arquivo
// certo. O teste tem de perguntar pelo código.
function semComentario(fonte, linguagem) {
    let s = fonte;
    if (linguagem === "c") {
        s = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    } else {
        // Shell: linha inteira de comentário e comentário após espaço.
        s = s.split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
    }
    return s;
}

const FONTE = readFileSync(SRC, "utf8");
const MAPA_DB = readFileSync(DB, "utf8");

// Compila uma vez por execução da suíte. `cc` existe no CI (ubuntu-latest) e
// nesta máquina; se não existir, os testes que executam viram skip explícito em
// vez de falha — a regra do §12.34: "não deu para medir" não é "está errado".
const TMP = mkdtempSync(join(tmpdir(), "giochi-gamepad-"));
const BIN = join(TMP, "giochi-gamepad");
let temCompilador = true;
try {
    execFileSync("cc", ["-O1", "-Wall", "-Wextra", "-o", BIN, SRC], {
        stdio: "pipe",
    });
} catch {
    temCompilador = false;
}

test.after(() => {
    rmSync(TMP, { recursive: true, force: true });
});

function listar(mapaRelativo) {
    const saida = execFileSync(BIN, ["--mapa", join(RAIZ, mapaRelativo), "--listar"], {
        encoding: "utf8",
    });
    return saida;
}

test("o layout canônico é o mesmo para os três aparelhos", { skip: !temCompilador }, () => {
    const mapas = [
        "device/r35s/buttons.map",
        "device/powkiddy x55/buttons.map",
        "device/powkiddy x35h/buttons.map",
    ];
    const assinaturas = mapas.map((m) => {
        const saida = listar(m);
        // A assinatura é o conjunto de códigos CANÔNICOS que o virtual declara.
        // Se um aparelho produzir um conjunto diferente, um jogo veria um
        // controle diferente em cada console — que é o defeito a evitar.
        const canonicos = [...saida.matchAll(/canonico=(\d+)/g)].map((x) => x[1]);
        return { mapa: m, canonicos: canonicos.sort((a, b) => a - b).join(",") };
    });
    for (const s of assinaturas) {
        assert.equal(s.canonicos, assinaturas[0].canonicos,
            `${s.mapa} produz um layout canônico diferente de ${assinaturas[0].mapa}`);
    }
    assert.equal(assinaturas[0].canonicos.split(",").length, 17,
        "o contrato tem 17 botões");
});

test("o mapa que troca A/B é traduzido, não herdado", { skip: !temCompilador }, () => {
    // O X35S declara `a = BTN_SOUTH` (troca de propósito, herdado do antecessor).
    // No virtual, o botão que o mapa chama `a` TEM de sair como BTN_EAST (305),
    // senão o contrato não vale para ele e o jogo precisa saber de mais um
    // aparelho.
    const saida = listar("device/powkiddy x35s/buttons.map");
    assert.match(saida, /a\s+fisico=304\s+-> canonico=305.*TRADUZIDO/,
        "o `a` do X35S (BTN_SOUTH físico) tem de sair como BTN_EAST canônico");
    assert.match(saida, /b\s+fisico=305\s+-> canonico=304.*TRADUZIDO/,
        "o `b` do X35S (BTN_EAST físico) tem de sair como BTN_SOUTH canônico");
});

test("a faixa do eixo é normalizada, inclusive quando é invertida", { skip: !temCompilador }, () => {
    // X55: adc-joystick declara 15..1023 com Y e RY invertidos. O virtual tem de
    // publicar -32767..32767 nos quatro, para o jogo normalizar com UMA fórmula.
    const x55 = listar("device/powkiddy x55/buttons.map");
    assert.match(x55, /axis_x\s+15\.\.1023 -> -32767\.\.32767/);
    assert.match(x55, /axis_y\s+1023\.\.15 -> -32767\.\.32767\s+\(INVERTIDO\)/,
        "o Y invertido da X55 tem de ser reconhecido como invertido");

    // R35S: o driver já normaliza, em faixa simétrica.
    const r35s = listar("device/r35s/buttons.map");
    assert.match(r35s, /axis_x\s+-1800\.\.1800 -> -32767\.\.32767/);
    assert.doesNotMatch(r35s, /INVERTIDO/, "no R35S nenhum eixo é invertido");
});

test("todo aparelho com gamepad tem CONFIG_INPUT_UINPUT no kernel e no gate", () => {
    const aparelhos = ["r35s", "powkiddy x55", "powkiddy x35h"];
    for (const d of aparelhos) {
        const frag = readFileSync(join(RAIZ, `device/${d}/linux.fragment`), "utf8");
        assert.match(frag, /^CONFIG_INPUT_UINPUT=y$/m,
            `${d}: sem UINPUT o \`giochi-gamepad\` não cria device nenhum e o ` +
            `aparelho volta a responder no formato dele — em silêncio`);
        assert.doesNotMatch(frag, /^CONFIG_INPUT_UINPUT=m$/m,
            `${d}: \`=m\` não serve — o rootfs não tem autoload (§12.51)`);

        const req = readFileSync(join(RAIZ, `device/${d}/kernel-required.txt`), "utf8");
        assert.match(req, /^CONFIG_INPUT_UINPUT=y$/m,
            `${d}: o fragmento é delta; sem o gate o símbolo pode sumir e a ` +
            `imagem sai sem controle virtual sem o build reclamar`);
    }
});

test("o gamecontrollerdb cobre o GUID que o daemon realmente cria", () => {
    // O GUID é derivado de bustype/vendor/product/version, todos fixados no
    // fonte. Se alguém mudar o `id`, o SDL deixa de casar esta linha e volta ao
    // mapeamento automático — `a` e `b` trocam de lado, sem erro em lugar algum.
    const bustype = FONTE.match(/setup\.id\.bustype = (BUS_\w+)/);
    const vendor = FONTE.match(/setup\.id\.vendor = (0x[0-9a-fA-F]+)/);
    const product = FONTE.match(/setup\.id\.product = (0x[0-9a-fA-F]+)/);
    const version = FONTE.match(/setup\.id\.version = (\d+)/);
    assert.ok(bustype && vendor && product && version,
        "o fonte do daemon perdeu o bloco `uinput_setup.id`");

    // BUS_VIRTUAL = 0x06 no Linux.
    assert.equal(bustype[1], "BUS_VIRTUAL", "o bustype do contrato é BUS_VIRTUAL");
    assert.equal(vendor[1], "0x1209",
        "o vendor mudou sem mudar o gamecontrollerdb — o SDL não vai casar o GUID");
    assert.equal(product[1], "0x0001");
    assert.equal(version[1], "1");

    // A linha do DB é a única fonte da verdade do mapeamento.
    assert.match(MAPA_DB, /^06005931091200000100000001000000,Giochi Gamepad,/m,
        "o GUID do DB tem de ser o do device criado pelo daemon");
});

test("o GUID é recalculado a partir do nome — não é literal copiado", () => {
    // O teste acima confere o literal do DB, e isso NÃO basta: se o nome do
    // device mudar, o `crc16` muda, o GUID muda, e o literal antigo continua
    // casando consigo mesmo. O SDL então não acha a linha, volta ao mapeamento
    // automático e `a`/`b` trocam de lado — sem erro em lugar nenhum.
    //
    // A conta foi lida do fonte do SDL 2.30.12 que a imagem usa
    // (`src/joystick/SDL_joystick.c`):
    //
    //   crc = SDL_crc16(crc, product_name, strlen(product_name));  /* vendor_name == NULL */
    //   *guid16++ = bus;  *guid16++ = crc;
    //   if (vendor) { *guid16++ = vendor; *guid16++ = 0;
    //                 *guid16++ = product; *guid16++ = 0;
    //                 *guid16++ = version; guid.data[14] = sig; data[15] = data; }
    //
    // e o crc16 do SDL é o CRC-16/ARC bit a bit:
    //   crc = crc16_for_byte((Uint8)crc ^ byte) ^ crc >> 8
    //   crc16_for_byte: 8× crc = ((crc ^ r) & 1 ? 0xA001 : 0) ^ crc >> 1
    function crc16ParaByte(r) {
        let crc = 0;
        for (let i = 0; i < 8; i++) {
            crc = (((crc ^ r) & 1) * 0xA001) ^ (crc >> 1);
            r >>= 1;
        }
        return crc & 0xFFFF;
    }
    function crc16(dados) {
        let crc = 0;
        for (const b of dados) {
            crc = crc16ParaByte((crc & 0xFF) ^ b) ^ (crc >> 8);
        }
        return crc & 0xFFFF;
    }

    // O nome tem de ser o mesmo que o daemon passa ao kernel. Ele é escrito
    // num `snprintf` para `setup.name`, então é de lá que sai.
    const literal = FONTE.match(/snprintf\(\s*setup\.name[^,]*,[^,]*,\s*"([^"]+)"/);
    assert.ok(literal, "o fonte do daemon perdeu o `snprintf(setup.name, ...)`");
    const nomeDevice = literal[1];

    const crc = crc16(Buffer.from(nomeDevice, "utf8"));
    const linha = MAPA_DB.split("\n").find((l) => l.includes(`,${nomeDevice},`));
    assert.ok(linha, `o DB não tem linha para "${nomeDevice}"`);

    const guid = linha.split(",")[0];
    assert.equal(guid.length, 32, `GUID tem de ter 16 bytes: ${guid}`);
    // Bytes 2-3 são o crc, em little-endian (SDL_SwapLE16 numa máquina LE).
    const crcGravado = parseInt(guid.slice(4, 6), 16) | (parseInt(guid.slice(6, 8), 16) << 8);
    assert.equal(crcGravado, crc,
        `o crc do GUID é 0x${crcGravado.toString(16)}, mas crc16("${nomeDevice}") ` +
        `dá 0x${crc.toString(16)} — o SDL não vai casar a linha, e aí A e B ` +
        `trocam de lado em silêncio (renomear o device exige regerar o GUID)`);

    // E o resto do GUID tem de bater com o `uinput_setup.id`.
    assert.equal(guid.slice(0, 4), "0600", "bus 0x0006 (BUS_VIRTUAL), LE");
    assert.equal(guid.slice(8, 12), "0912", "vendor 0x1209, LE");
    assert.equal(guid.slice(12, 16), "0000");
    assert.equal(guid.slice(16, 20), "0100", "product 0x0001, LE");
    assert.equal(guid.slice(20, 24), "0000");
    assert.equal(guid.slice(24, 28), "0100", "version 1, LE");
    assert.equal(guid.slice(28, 32), "0000", "driver_signature/driver_data = 0");
});

test("o DB mapeia `a` para b1, e não para o automático b0", () => {
    // Esta é a asserção que faz `Button::A` ser o A do plástico. O automático do
    // SDL liga `a` a b0 (BTN_SOUTH, o botão de baixo); o mapa do projeto diz que
    // `a` é BTN_EAST (o da direita). Sem a correção, as duas vias discordam.
    assert.match(MAPA_DB, /,a:b1,/, "`a` tem de apontar para b1 (BTN_EAST)");
    assert.match(MAPA_DB, /,b:b0,/, "`b` tem de apontar para b0 (BTN_SOUTH)");
    assert.match(MAPA_DB, /,x:b2,/, "x/y não mudam: BTN_NORTH já é b2");
    assert.match(MAPA_DB, /,y:b3,/);
});

test("o giochi-init exporta o mapeamento, e o daemon sobe no boot", () => {
    const init = semComentario(readFileSync(INIT, "utf8"), "sh");
    assert.match(init, /SDL_GAMECONTROLLERCONFIG/,
        "sem exportar isto, o `Button::A` do SDL volta a ser o botão de baixo");
    assert.match(init, /gamecontrollerdb\.txt/,
        "o conteúdo tem de vir do arquivo, não cravado no script");
    // A variável de CAMINHO foi medida e não funciona neste SDL.
    assert.doesNotMatch(init, /SDL_GAMECONTROLLERCONFIG_FILE/,
        "`SDL_GAMECONTROLLERCONFIG_FILE` foi medido e o SDL ignorou — " +
        "usar o caminho em vez do conteúdo silenciosamente não faz nada");

    const s52 = semComentario(readFileSync(S52, "utf8"), "sh");
    assert.match(s52, /giochi-gamepad/, "o serviço tem de subir o daemon");
    assert.match(s52, /while :; do/,
        "sem supervisão, daemon morto devolve o aparelho ao layout dele em silêncio");
    assert.match(s52, /stop\)/);
});

test("o daemon reexamina /dev/input e ignora o próprio device", () => {
    // Um controle USB plugado depois do boot não é visto por `SDL_NumJoysticks`
    // sozinho (§12.66, item 8). E ler o próprio device virtual seria
    // realimentação infinita.
    assert.match(FONTE, /strcmp\(nome, "Giochi Gamepad"\)/,
        "o daemon não pode ler o device que ele mesmo criou");
    assert.match(FONTE, /poll\(pfd, \(nfds_t\)n_fds, 2000\)/,
        "o laço de poll é a janela em que devices novos são procurados");
});

test("o daemon não faz EVIOCGRAB — o diagnóstico continua funcionando", () => {
    // A lição do §12.45: ferramenta de diagnóstico que exige o produto
    // desligado não é usável. Tomar os devices físicos deixaria `evtest`,
    // `giochi-buttons` e o selftest cegos com o serviço no ar.
    assert.doesNotMatch(semComentario(FONTE, "c"), /EVIOCGRAB/,
        "se um dia for necessário tomar os devices, isto precisa de uma " +
        "decisão registrada e de um jeito de liberar para diagnóstico");
    assert.ok(existsSync(S52), "o script de init tem de existir");
});

test("o bloco do gamepad não depende do bloco do verificador (post-build)", () => {
    // DEFEITO QUE EU INTRODUZI E CORRIGI NESTA MESMA SESSÃO, e é a classe do
    // §12.49: a derivação de `HOST_DIR` estava DENTRO do
    // `if [ -f "$VERIFICADOR_SRC" ]`. Num build sem o fonte do verificador
    // (árvore parcial, aparelho que não empacota a loja), `HOST_DIR` ficava
    // vazia e o bloco do gamepad sumia EM SILÊNCIO — a imagem sairia sem o
    // controle virtual e sem uma linha de aviso.
    const pb = readFileSync(join(RAIZ, "scripts/post-build.sh"), "utf8");
    const linhas = pb.split("\n");

    const iVerif = linhas.findIndex((l) => /VERIFICADOR_SRC=/.test(l));
    const iHost = linhas.findIndex((l) => /^\s*HOST_DIR="\$O\/host"/.test(l) || /^HOST_DIR="\$O\/host"/.test(l));
    const iGamepad = linhas.findIndex((l) => /GAMEPAD_SRC=/.test(l));
    assert.ok(iVerif > 0 && iHost > 0 && iGamepad > 0,
        "post-build perdeu um dos três marcadores: VERIFICADOR_SRC, HOST_DIR, GAMEPAD_SRC");

    assert.ok(iHost < iVerif,
        `HOST_DIR é derivada na linha ${iHost + 1} e o bloco do verificador ` +
        `começa na ${iVerif + 1}. Se a derivação voltar para dentro do ` +
        `condicional, todo bloco que a usa some quando aquele fonte faltar.`);

    assert.ok(iGamepad > iHost,
        "o bloco do gamepad vem depois da derivação de HOST_DIR");

    // E a derivação não pode ser duplicada: uma cópia dentro de um condicional
    // reintroduziria o defeito com a primeira passando no teste de ordem.
    const copias = (pb.match(/HOST_DIR="\$O\/host"/g) || []).length;
    assert.equal(copias, 1,
        `a derivação de HOST_DIR aparece ${copias} vez(es); uma cópia dentro de ` +
        `um bloco condicional é o defeito do §12.49 de volta`);
});
