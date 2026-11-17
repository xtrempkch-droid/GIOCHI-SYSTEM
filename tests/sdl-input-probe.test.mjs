// O probe que pergunta ao SDL2 o que ele vê como controle, e a convenção de
// botões que ele expõe.
//
// Existe por causa de uma medição de 17/11/2026 no R35S: o `evtest` mostrava
// `BTN_DPAD_*`/`BTN_SOUTH` corretos, o jogo se comportava como se os botões
// estivessem trocados, e a explicação não estava no kernel nem no DTS — estava
// no mapeamento que o SDL2 **gera sozinho** para um nó que ele reconhece como
// gamepad. Ver AGENTS §12.74.
//
// O que estes testes prendem:
//   1. o probe não pode voltar a ser um contador de joysticks (a pergunta é
//      `SDL_IsGameController`, e a resposta útil é o mapeamento);
//   2. o probe não pode abrir vídeo por padrão — KMSDRM disputa o DRM master
//      com o launcher (§12.72), e um diagnóstico que derruba o produto não
//      presta;
//   3. o runner compila de verdade, sem fixar o trio do toolchain;
//   4. a convenção `a = BTN_EAST` / `b = BTN_SOUTH` dos `buttons.map` é a
//      **oposta** da que o SDL2 gera automático (`a = BTN_SOUTH`). Quem mexer
//      nela tem de saber disso aqui, não num aparelho.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const PROBE = readFileSync(join(RAIZ, "scripts/sdl-input-probe.c"), "utf8");
const RUNNER = readFileSync(join(RAIZ, "scripts/sdl-input-probe.sh"), "utf8");

test("o probe pergunta ao SDL o que ele vê, e imprime o mapeamento", () => {
    assert.match(PROBE, /SDL_NumJoysticks\s*\(/,
        "sem num_joysticks o probe não sabe quantos devices o SDL listou");
    assert.match(PROBE, /SDL_IsGameController\s*\(/,
        "a pergunta que decide o caminho SDL do jogo é SDL_IsGameController");
    assert.match(PROBE, /SDL_GameControllerMappingForDeviceIndex\s*\(/,
        "sem o mapeamento o probe diz 'tem controle' e não diz QUAL mapa — " +
        "foi comparando o mapa com o buttons.map que o defeito apareceu");
    assert.match(PROBE, /SDL_GameControllerOpen\s*\(/,
        "'é gamecontroller' e 'abre' são coisas diferentes; medir as duas");
});

test("o probe não abre vídeo sem --video (KMSDRM rouba o DRM master)", () => {
    // O `SDL_INIT_VIDEO` tem de estar atrás do flag. Se virar incondicional,
    // rodar o probe com o launcher no ar derruba a interface (§12.72).
    // Comparar **código**, não comentário: o cabeçalho do arquivo cita
    // `SDL_Init(SDL_INIT_VIDEO)` explicando exatamente este risco.
    const codigo = PROBE.split("\n").filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));
    const iFlag = codigo.findIndex((l) => /com_video\s*=\s*1/.test(l));
    const iInit = codigo.findIndex((l) => /SDL_INIT_VIDEO/.test(l));
    assert.ok(iFlag >= 0, "o probe perdeu o flag --video");
    assert.ok(iInit > iFlag,
        "SDL_INIT_VIDEO aparece no código antes de o flag ser lido — não pode ser incondicional");
    assert.match(PROBE, /bandeiras\s*\|=\s*SDL_INIT_VIDEO/,
        "o vídeo entra somado às bandeiras, sob a condição do flag");
});

test("o runner compila com a toolchain do build, sem trio fixo", () => {
    assert.match(RUNNER, /set -eu/, "o runner tem de falhar alto");
    assert.match(RUNNER, /\*-buildroot-linux-gnu-gcc/,
        "o trio vem do work/<device>; fixar `aarch64-linux-gnu` quebra em arm");
    assert.doesNotMatch(RUNNER, /aarch64-linux-gnu-gcc/,
        "trio fixo no runner");
    assert.match(RUNNER, /sysroot/,
        "o SDL2 vem do sysroot do build — sem ele não há o que linkar");
    assert.match(RUNNER, /--run/);
});

test("buttons.map declara a convenção que o SDL2 automapeia ao contrário", () => {
    // O SDL2, sem libudev, gera o mapeamento em LINUX_JoystickGetGamepadMapping
    // exigindo BTN_SOUTH e ligando `a` a BTN_SOUTH (a posição de baixo). O
    // projeto adota a convenção do plástico: A fica à direita (BTN_EAST) e B
    // embaixo (BTN_SOUTH). As duas convivem, mas **divergem** — e é essa
    // divergência que fez o jogo parecer errado só no R35S (§12.74).
    //
    // Um mapa pode divergir (o do X35S herda do antecessor e diz por quê), mas
    // não em silêncio: divergir sem o aviso escrito é como o defeito volta sem
    // ninguém ver.
    const dirDevice = join(RAIZ, "device");
    let naConvencao = 0;
    for (const pasta of readdirSync(dirDevice)) {
        const mapa = join(dirDevice, pasta, "buttons.map");
        if (!existsSync(mapa)) continue;
        const texto = readFileSync(mapa, "utf8");
        const a = texto.match(/^a\s*=\s*(\S+)/m);
        const b = texto.match(/^b\s*=\s*(\S+)/m);
        if (!a || !b) continue;

        if (a[1] === "BTN_EAST" && b[1] === "BTN_SOUTH") {
            naConvencao++;
            continue;
        }
        assert.match(texto, /herdado|n[ãa]o foi conferid/i,
            `${pasta}: declara a = ${a[1]} / b = ${b[1]}, divergindo de ` +
            `a = BTN_EAST / b = BTN_SOUTH sem dizer que não foi conferido. ` +
            `Divergência silenciosa é o defeito do §12.74 de novo.`);
    }
    assert.ok(naConvencao >= 3,
        `esperava os três aparelhos medidos na convenção do plástico; achei ${naConvencao}`);
});

// --- a tradução `bN` -> código evdev, com os números MEDIDOS no R35S ---

// Saída de `sdl-input-probe` no R35S em 17/11/2026, com o launcher no ar.
// Fixture de propósito: é o dado do aparelho, não uma dedução do código do SDL.
const MAPA_MEDIDO = {
    device: "/dev/input/event2",
    // ordem crescente dos códigos EV_KEY que o device declara
    codigos: [304, 305, 307, 308, 310, 311, 312, 313, 314, 315, 316, 317, 318,
        544, 545, 546, 547],
    // `bN` que o SDL atribuiu a cada Button
    botoes: {
        A: 0, B: 1, X: 2, Y: 3,
        BACK: 8, GUIDE: 10, START: 9,
        LEFTSTICK: 11, RIGHTSTICK: 12,
        LEFTSHOULDER: 4, RIGHTSHOULDER: 5,
        DPAD_UP: 13, DPAD_DOWN: 14, DPAD_LEFT: 15, DPAD_RIGHT: 16,
    },
};

function lerMapa(pasta) {
    const texto = readFileSync(join(RAIZ, "device", pasta, "buttons.map"), "utf8");
    const mapa = {};
    for (const linha of texto.split("\n")) {
        const m = linha.match(/^(\w+)\s*=\s*(\S+)/);
        if (m) mapa[m[1]] = m[2];
    }
    return mapa;
}

const CODIGO_DE = {
    BTN_SOUTH: 304, BTN_EAST: 305, BTN_NORTH: 307, BTN_WEST: 308,
    BTN_TL: 310, BTN_TR: 311, BTN_TL2: 312, BTN_TR2: 313,
    BTN_SELECT: 314, BTN_START: 315, BTN_MODE: 316,
    BTN_THUMBL: 317, BTN_THUMBR: 318,
    BTN_DPAD_UP: 544, BTN_DPAD_DOWN: 545, BTN_DPAD_LEFT: 546, BTN_DPAD_RIGHT: 547,
};

test("o SDL2 chama de A o mesmo código que o mapa chama de b (R35S, medido)", () => {
    // Esta é a asserção que prende o §12.74: se alguém "consertar" o probe para
    // que o SDL concorde com o plástico, isto falha e obriga a reler a seção.
    // O automático do SDL2 nunca vai concordar — a correção tem de ser no app.
    const mapa = lerMapa("r35s");
    const codigoDoBotao = (nome) =>
        MAPA_MEDIDO.codigos[MAPA_MEDIDO.botoes[nome]];

    assert.equal(codigoDoBotao("A"), 304, "Button::A do SDL = b0 = 304");
    assert.equal(codigoDoBotao("B"), 305, "Button::B do SDL = b1 = 305");

    // e o que o mapa do projeto diz desses dois códigos
    assert.equal(CODIGO_DE[mapa.b], 304,
        "o 304 é o `b` do mapa — e é o que o SDL entrega como Button::A");
    assert.equal(CODIGO_DE[mapa.a], 305,
        "o 305 é o `a` do mapa — e é o que o SDL entrega como Button::B");

    // a conclusão, escrita de forma executável: um app que use Button::A está
    // lendo o `b` do plástico, não o `a`.
    assert.notEqual(mapa.a, "BTN_SOUTH",
        "se o mapa passasse a chamar o 304 de `a`, o SDL concordaria por " +
        "acidente e o §12.74 viraria história sem sentido");
});

test("o probe traduz bN para código evdev, em vez de só imprimir o mapa", () => {
    // O mapeamento cru (`a:b0`) não diz qual botão do plástico é: sem a lista
    // de códigos EV_KEY, `b0` é só um índice. Foi essa tradução que faltava
    // para o defeito aparecer sem abrir o código do SDL.
    assert.match(PROBE, /EVIOCGBIT\s*\(/,
        "sem EVIOCGBIT o probe não tem a ordem dos códigos");
    assert.match(PROBE, /SDL_GameControllerGetBindForButton\s*\(/,
        "é essa chamada que devolve o `bN` de cada Button");
    assert.match(PROBE, /SDL_JoystickPath\s*\(/,
        "o caminho do /dev/input/event* vem do SDL, não de adivinhar o número");
});
