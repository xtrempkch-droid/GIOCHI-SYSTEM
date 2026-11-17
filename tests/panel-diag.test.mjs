// O diagnóstico de painel: quatro causas, quatro vereditos.
//
// Existe por causa da pergunta de 17/11/2026 sobre o X35H: "em alguns boots
// frios a tela não acende; apertar reset faz funcionar. Isso é detecção de
// painel (suporta várias telas) ou é modelo fixo (e pode ser um bug)?".
//
// A resposta tem duas metades, e as duas ficam presas aqui:
//
//   1. **Detecção não existe.** Painel MIPI-DSI não se anuncia — não há EDID, e
//      o modo vem de uma `struct drm_display_mode` escrita em C. O kernel casa
//      `compatible` do device tree com uma tabela. Então "às vezes detecta" é
//      impossível: se o `compatible` estivesse errado, a tela nunca acenderia.
//
//   2. **A intermitência é bug de verdade**, na classe inicialização/timing, e
//      se manifesta em três pontos independentes cujo sintoma visual é o mesmo
//      (tela apagada): controlador DSI, painel, backlight. Só o log separa.
//
// O script roda a MESMA análise sobre o log de um boot que falhou e sobre o de
// um boot bom. É a única comparação possível, porque `dmesg` em memória se
// perde no reset — e o X35H grava `giochi-boot.log` no cartão justamente por
// isso.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = new URL("..", import.meta.url).pathname;
const SCRIPT = join(RAIZ, "scripts/panel-diag.sh");
const FONTE = readFileSync(SCRIPT, "utf8");

const TMP = mkdtempSync(join(tmpdir(), "panel-diag-"));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

function analisar(nome, conteudo) {
    const caminho = join(TMP, nome);
    writeFileSync(caminho, conteudo);
    return execFileSync("bash", [SCRIPT, "--log", caminho], { encoding: "utf8" });
}

test("o script não usa `grep -c || echo 0` — o defeito do §12.56", () => {
    // `grep -c` imprime "0" E sai com 1 quando não casa, então
    // `$(grep -c ... || echo 0)` produz "0\n0" e o `[ -gt ]` seguinte falha em
    // silêncio: o veredito passaria justamente no caso que existe para pegar.
    //
    // Eu reproduzi este defeito escrevendo o script — o veredito de um boot BOM
    // saía com "esperava número inteiro". Está registrado na seção que o
    // próprio repositório mantém sobre a armadilha.
    const semComentario = FONTE.split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
    assert.doesNotMatch(semComentario, /grep -c[^|]*\|\|\s*echo 0/,
        "`grep -c || echo 0` devolve \"0\\n0\" e o teste seguinte passa no caso errado");
    assert.match(semComentario, /\|\|\s*erros_dsi=0/,
        "o tratamento certo é deixar o `0` do grep valer e só cuidar do status");
});

test("os quatro cenários dão quatro vereditos distintos", () => {
    // Se dois cenários diferentes dessem o mesmo veredito, o teste não
    // distingue nada e o diagnóstico seria decorativo.
    const casos = {
        bom: "[ 1.0] panel-sitronix-st7703 fe060000.dsi.0: Panel init sequence done\n",
        painel: "[ 2.0] panel-sitronix-st7703 fe060000.dsi.0: failed to enable panel: -5\n",
        dsi: "[ 1.0] dw-mipi-dsi fe060000.dsi: dsi phy timeout\n",
        vazio: "",
    };
    const vereditos = {};
    for (const [nome, log] of Object.entries(casos)) {
        const saida = analisar(`${nome}.log`, log);
        const m = saida.split("=== veredito")[1] || "";
        vereditos[nome] = m.split("\n").filter((l) => l.trim().startsWith(("O painel")))[0]?.trim() || m.trim().split("\n")[0];
    }
    const distintos = new Set(Object.values(vereditos));
    assert.equal(distintos.size, 4,
        `esperava 4 vereditos distintos, achei ${distintos.size}:\n` +
        Object.entries(vereditos).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
});

test("o veredito de painel aponta a inicialização, não a detecção", () => {
    const saida = analisar("p.log", "[ 2.0] panel-sitronix-st7703 x: failed to enable panel: -5\n");
    assert.match(saida, /inicialização \(sequência DCS ou alimentação\)/,
        "a conclusão tem de ser 'falha de inicialização', com a causa provável nomeada");
    // A frase tem de NEGAR a detecção explicitamente. Procurar "detec" e
    // proibir casaria com a própria negação ("não de detecção") — o teste
    // perguntaria pela palavra em vez do sentido, e reprovaria o texto certo.
    assert.match(saida, /não de detecção/,
        "o veredito tem de dizer que a falha não é de detecção, para o operador " +
        "não sair procurando uma detecção que não existe");
});

test("o script diz que detecção não existe, e por quê", () => {
    // Esta é a resposta à pergunta do dono do projeto, e ela tem de estar no
    // diagnóstico — não só na documentação, que ninguém lê com o aparelho na mão.
    const saida = analisar("d.log", "");
    assert.match(saida, /MIPI-DSI não se anuncia/);
    assert.match(saida, /compatible/,
        "a explicação tem de citar o mecanismo real: casamento por compatible");
    assert.match(saida, /Painel diferente = DTS diferente/,
        "e a consequência prática: trocar de painel exige DTS novo");
});

test("o script separa DSI, painel e backlight, e não os confunde", () => {
    // Os três dão o mesmo sintoma visual (tela apagada) e são causas
    // independentes. Um diagnóstico que só olhasse "a tela acendeu?" não
    // distinguiria nenhum.
    for (const secao of ["--- DSI (controlador)", "--- PAINEL", "--- BACKLIGHT", "--- ALIMENTAÇÃO do LCD"]) {
        assert.ok(FONTE.includes(secao), `falta a seção "${secao}"`);
    }
});

test("o X35H declara o trilho do LCD sem delay de partida — a pista a medir", () => {
    // O `vcc_lcd` do X55/X35H é `regulator-fixed` chaveado por GPIO, e NÃO
    // declara `startup-delay-us`. O `st7703_prepare()` dá só 10-20 ms entre
    // ligar o trilho e soltar o reset — e no R35S o mesmo trilho é um LDO de
    // PMIC, com rampa conhecida. É a assimetria que a medição precisa separar.
    //
    // Este teste não afirma que o delay é a causa: afirma que a DIFERENÇA
    // existe, para o número não ser "corrigido" por analogia com outro SoC.
    const dts = readFileSync(
        join(RAIZ, "device/powkiddy x35h/patches/0001-giochi-system-x35h-dts.patch"),
        "utf8");
    // O X35H herda o nó do X55 e só troca compatible/rotation — conferido.
    assert.match(dts, /compatible = "powkiddy,x35h-panel"/);
    assert.match(dts, /rotation = <0>/);

    // E a herança é o que importa: se um dia o X35H declarar o próprio
    // regulador, este teste avisa que o raciocínio mudou.
    assert.doesNotMatch(dts, /vcc_lcd|startup-delay-us|regulator-ramp-delay/,
        "o X35H não redeclara o regulador do LCD — ele herda o do X55. Se isso " +
        "mudar, a análise de timing do §31 precisa ser refeita.");
});

test("o caminho por SSH analisa o dmesg que coletou", () => {
    // Defeito real, medido ao revisar o script: `--local` e `--log` chamavam
    // `analisar()`, e o caminho por SSH — o mais usado — imprimia o dmesg cru e
    // parava ali. Três modos analisavam e um não, e o que faltava era o do
    // aparelho ao vivo. Afirmar por texto ("o arquivo chama analisar") não
    // pegaria a próxima versão do mesmo erro; aqui um `ssh` falso devolve o
    // formato que o script espera, e a asserção é sobre o VEREDITO sair.
    const lixo = join(TMP, "fake-bin");
    mkdirSync(lixo, { recursive: true });
    // Emite exatamente o que o bloco remoto emite: build-info, dmesg entre
    // marcadores, e o estado.
    writeFileSync(join(lixo, "ssh"), `#!/bin/sh
cat >/dev/null
cat <<'FIM'
=== aparelho
device=powkiddy-x35h
commit=abc1234

=== dmesg
[    1.100000] dw-mipi-dsi fe060000.dsi: probe ok
[    1.200000] panel-sitronix-st7703 0.0: st7703_prepare
[    1.300000] panel-sitronix-st7703 0.0: Failed to write init sequence: -110
=== fim-dmesg
=== estado
drm card0-DSI-1: connected
backlight backlight: 833
FIM
`, { mode: 0o755 });

    const saida = execFileSync("bash", [SCRIPT, "10.0.0.9"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${lixo}:${process.env.PATH}` },
    });

    assert.match(saida, /=== veredito/,
        "o caminho por SSH tem de dar veredito — era o único dos três que não dava");
    assert.match(saida, /REPORTou erro ao inicializar/,
        "e o veredito tem de usar o log coletado: o painel falhou neste fixture");
    assert.match(saida, /=== estado ao vivo/,
        "o estado vivo continua sendo impresso, depois da análise");
    assert.match(saida, /card0-DSI-1: connected/);
});
