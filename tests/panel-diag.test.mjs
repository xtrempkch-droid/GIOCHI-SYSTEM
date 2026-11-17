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

test("--iface existe, e por causa de §12.64", () => {
    // Todo aparelho atende em 10.55.0.2 com o mesmo MAC do gadget. Com dois
    // plugados, sem `--iface` o diagnóstico leria o dmesg do OUTRO aparelho e
    // daria um veredito confiante sobre ele — o pior erro possível para uma
    // ferramenta de diagnóstico, porque parece certo.
    //
    // `ssh -o BindInterface=` não resolve (medido: o tráfego continua saindo
    // pela interface do primeiro); o que funciona é SO_BINDTODEVICE, que é o
    // que scripts/ssh-por-iface.py faz.
    assert.match(FONTE, /--iface/,
        "sem --iface o script aponta para o aparelho errado quando há dois plugados");
    assert.match(FONTE, /ssh-por-iface\.py/,
        "o vínculo à interface tem de ser por SO_BINDTODEVICE, não por BindInterface");
    assert.match(FONTE, /UserKnownHostsFile=\/dev\/null/,
        "o IP é compartilhado entre aparelhos: a host key muda a cada troca, e " +
        "sem isso o SSH recusa a conexão com 'HOST IDENTIFICATION HAS CHANGED'");
});

test("--iface sem valor é erro, não silêncio", () => {
    assert.throws(() => execFileSync("bash", [SCRIPT, "--iface"], { encoding: "utf8", stdio: "pipe" }),
        /./, "`--iface` sem argumento não pode seguir com a interface vazia");
});

// ── O falso negativo que o hardware denunciou (17/11/2026, R35S) ───────────
//
// A primeira versão procurava "st7703" no log — o driver do X35H. Rodada no
// R35S, cujo painel é `panel-generic-dsi`, ela imprimiu:
//
//   (nenhuma linha do st7703 — o painel não foi inicializado neste boot)
//   -> o veredito era "o painel NÃO aparece no log deste boot"
//
// num aparelho com `card0-DSI-1: connected`, `backlight 63/255` e a tela
// desenhando a interface. Falso negativo na direção mais cara: manda caçar um
// probe que não existe num aparelho que está funcionando.
//
// É o §12.30 pela enésima vez — o teste perguntou pelo NOME do driver em vez da
// CONSEQUÊNCIA. E listar nomes não resolveria, porque o que cada driver
// imprime também varia (medido nos fontes do 6.12):
//
//   hx8394 (X55)              dev_dbg("... ready")   -> NÃO aparece sem dyndbg
//   st7703 (X35H)             dev_info("... ready")  -> aparece
//   panel-generic-dsi (R35S)  dev_info("lanes ...")  -> aparece, com outro texto
//
// O X55 acende a tela sem imprimir UMA LINHA sobre o painel. A pergunta que
// funciona nos três é "o DRM chegou a ter framebuffer / o conector está
// connected?", e é ela que o veredito passou a fazer.

test("o log real do R35S (panel-generic-dsi) dá PASS, não 'não inicializou'", () => {
    const log = `[    0.773848] dw-mipi-dsi-rockchip ff450000.dsi: Fixed dependency cycle(s) with /dsi@ff450000/panel@0
[    1.139177] panel-generic-dsi ff450000.dsi.0: lanes 4, format 0, mode e03
[    1.143125] rockchip-drm display-subsystem: bound ff450000.dsi (ops dw_mipi_dsi_rockchip_ops)
[    1.149824] rockchip-drm display-subsystem: [drm] fb0: rockchipdrmfb frame buffer device
[    2.524617] Console: switching to colour frame buffer device 80x30
=== estado
  card0-DSI-1/status: connected
  backlight/brightness: 63
`;
    const saida = analisar("r35s.log", log);
    assert.match(saida, /driver detectado no log[\s\S]*panel-generic-dsi/,
        "o script tem de reconhecer o driver do R35S, não só o do X35H");
    assert.match(saida, /O painel inicializou NESTE boot/,
        "fb0 + conector connected = o painel inicializou; dizer o contrário é " +
        "falso negativo num aparelho com a tela acesa");
    assert.match(saida, /framebuffer \(fb0\)/,
        "o veredito tem de citar a prova, não só afirmar");
    assert.doesNotMatch(saida.split("=== veredito")[1].split("=== detecção")[0],
        /NÃO aparece no log/,
        "não pode continuar dizendo que o painel não apareceu");
});

test("o X55 acende a tela SEM imprimir linha de painel — e não pode reprovar", () => {
    // `panel-himax-hx8394.c` só tem `dev_dbg` para o caminho feliz: num kernel
    // sem dynamic debug, o boot bom do X55 não tem NENHUMA linha sobre o
    // painel. Um diagnóstico que exigisse a linha daria "não inicializou" no
    // aparelho que mais roda no projeto.
    const log = `[    1.141954] rockchip-drm display-subsystem: bound ff460000.vop (ops vop_component_ops)
[    1.143125] rockchip-drm display-subsystem: bound ff450000.dsi (ops dw_mipi_dsi_rockchip_ops)
[    1.149824] rockchip-drm display-subsystem: [drm] fb0: rockchipdrmfb frame buffer device
=== estado
  card0-DSI-1/status: connected
  backlight/brightness: 833
`;
    const saida = analisar("x55.log", log);
    assert.match(saida, /O painel inicializou NESTE boot/,
        "sem linha de painel mas com fb0 + connected, o painel inicializou");
    assert.match(saida, /Ausência de linha aqui NÃO significa painel quebrado/,
        "e o script tem de AVISAR que ausência de linha não prova nada — senão " +
        "o próximo leitor do log tira a conclusão errada por conta própria");
});

test("sem fb0 e sem conector, aí sim não inicializou", () => {
    // O outro lado: se o veredito passasse a dar PASS sempre, viraria um
    // teste-verde inútil. Sem framebuffer e sem conector connected, o DRM
    // subiu e o painel não concluiu — é FAIL de verdade.
    const log = `[    1.143125] rockchip-drm display-subsystem: bound ff450000.dsi (ops dw_mipi_dsi_rockchip_ops)
=== estado
  card0-DSI-1/status: disconnected
`;
    const saida = analisar("ruim.log", log);
    assert.match(saida, /NÃO concluiu a inicialização|NÃO aparece no log/,
        "sem prova de framebuffer nem de conector, não pode dar PASS");
    assert.doesNotMatch(saida, /O painel inicializou NESTE boot/);
});

test("--iface chega ao ssh como UM argumento, não seis", () => {
    // Defeito real, medido no R35S em 17/11/2026: eu montei as opções numa
    // variável (`SSH_OPTS="... -o ProxyCommand=python3 ... --iface usb0 %h %p"`)
    // e chamei `ssh $SSH_OPTS`. Sem aspas, o shell parte em palavras e o
    // `--iface` vira opção do ssh:
    //
    //   unknown option -- -
    //   usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] ...
    //
    // É exatamente o defeito que o `gpu-bench.sh` já documenta ter corrigido, e
    // o comentário dele explica a causa. Repeti mesmo assim.
    //
    // O teste anterior só olhava o TEXTO do script (`/ssh-por-iface\.py/`) e por
    // isso passou verde com o script quebrado. Este executa com um `ssh` falso
    // que grava os próprios argv: se o ProxyCommand não chegar inteiro num
    // único argumento, o `--iface` aparece solto e o teste reprova.
    const lixo = join(TMP, "fake-bin-iface");
    mkdirSync(lixo, { recursive: true });
    const registro = join(TMP, "argv.txt");
    writeFileSync(join(lixo, "ssh"), `#!/bin/sh
: > ${registro}
for a in "$@"; do
    printf '%s\\n' "$a" >> ${registro}
done
cat >/dev/null
cat <<'FIM'
=== dmesg
[    1.1] dw-mipi-dsi ff450000.dsi: ok
=== fim-dmesg
=== estado
drm card0-DSI-1: connected
FIM
`, { mode: 0o755 });

    execFileSync("bash", [SCRIPT, "--iface", "usb0", "10.0.0.9"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${lixo}:${process.env.PATH}` },
    });

    const argv = readFileSync(registro, "utf8").split("\n").filter(Boolean);

    // O ProxyCommand tem de ser UM argumento só, com o `--iface usb0` dentro.
    const proxy = argv.filter((a) => a.startsWith("ProxyCommand="));
    assert.equal(proxy.length, 1,
        `esperava um único argumento ProxyCommand, achei ${proxy.length}:\n` +
        argv.map((a) => `  [${a}]`).join("\n"));
    assert.match(proxy[0], /ssh-por-iface\.py --iface usb0 %h %p/,
        `o ProxyCommand perdeu pedaços: ${proxy[0]}`);

    // E nada de `--iface` solto: seria interpretado pelo ssh, não pelo proxy.
    assert.equal(argv.includes("--iface"), false,
        `o "--iface" vazou como argumento do ssh — é o "unknown option" medido:\n` +
        argv.map((a) => `  [${a}]`).join("\n"));

    // O alvo continua sendo o último argumento, e as opções usuais estão lá.
    assert.ok(argv.includes("root@10.0.0.9"), "o alvo do ssh se perdeu");
    assert.ok(argv.includes("UserKnownHostsFile=/dev/null"),
        "o IP é compartilhado entre aparelhos; sem isso o ssh recusa a conexão");
});

test("sem --iface, nenhum ProxyCommand é montado", () => {
    const lixo = join(TMP, "fake-bin-sem-iface");
    mkdirSync(lixo, { recursive: true });
    const registro = join(TMP, "argv2.txt");
    writeFileSync(join(lixo, "ssh"), `#!/bin/sh
: > ${registro}
for a in "$@"; do printf '%s\\n' "$a" >> ${registro}; done
cat >/dev/null
cat <<'FIM'
=== dmesg
[    1.1] dw-mipi-dsi ok
=== fim-dmesg
=== estado
drm card0-DSI-1: connected
FIM
`, { mode: 0o755 });

    execFileSync("bash", [SCRIPT, "10.0.0.9"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${lixo}:${process.env.PATH}` },
    });
    const argv = readFileSync(registro, "utf8").split("\n").filter(Boolean);
    assert.equal(argv.filter((a) => a.startsWith("ProxyCommand=")).length, 0,
        "o caminho padrão (um aparelho) não precisa de proxy, e ele custa um " +
        "processo python por conexão");
});

test("o log de boot bom do X35H (st7703) é reconhecido — e é OUTRO aparelho", () => {
    // R35S e X35H são aparelhos diferentes, e o teste anterior (R35S) não cobre
    // este. Aqui o painel é `panel-sitronix-st7703`, no RK3566, e o driver TEM
    // `dev_info` no caminho feliz:
    //
    //   drivers/gpu/drm/panel/panel-sitronix-st7703.c:895
    //     dev_info(dev, "%ux%u@%u %ubpp dsi %udl - ready\n", ...)
    //
    // O log abaixo é MONTADO a partir desse formato — não é de um boot medido,
    // porque nenhum log do X35H foi lido ainda (AGENTS §31.3-A). Ele prende o
    // reconhecimento do driver; a medição no aparelho continua pendente.
    const log = `[    1.140000] dw-mipi-dsi-rockchip fe060000.dsi: Fixed dependency cycle(s)
[    2.310000] panel-sitronix-st7703 fe060000.dsi.0: 640x480@60 24bpp dsi 4dl - ready
[    2.315000] rockchip-drm display-subsystem: [drm] fb0: rockchipdrmfb frame buffer device
=== estado
  card0-DSI-1/status: connected
  backlight/brightness: 128
`;
    const saida = analisar("x35h-bom.log", log);
    assert.match(saida, /driver: st7703/, "o st7703 tem de ser reconhecido pelo nome");
    assert.match(saida, /O painel inicializou NESTE boot/);
    // E o script não pode atribuir este log ao R35S: o diagnóstico é do
    // aparelho de onde o log veio, e quem diz qual é é o `device=` do
    // build-info, não o script.
    assert.doesNotMatch(saida, /panel-generic-dsi/,
        "st7703 e generic-dsi são de aparelhos diferentes; misturar os dois é o " +
        "erro que o alerta de 17/11 pediu para evitar");
});

test("o log de boot RUIM do X35H diz onde parou, e não 'detecção falhou'", () => {
    // O caso do relato: boot frio, tela apagada. `st7703_enable()` devolve
    // `dsi_ctx.accum_err`, então um comando DCS que expira aparece como erro.
    const log = `[    2.310000] panel-sitronix-st7703 fe060000.dsi.0: Failed to write init sequence: -110
[    2.315000] rockchip-drm display-subsystem: failed to enable panel: -110
`;
    const saida = analisar("x35h-ruim.log", log);
    assert.match(saida, /REPORTou erro ao inicializar/);
    assert.match(saida, /não de detecção/,
        "a resposta à pergunta de origem: o defeito não é detecção de painel");
    assert.doesNotMatch(saida, /O painel inicializou NESTE boot/,
        "com erro de init não pode dar PASS");
});

test("funciona sobre o giochi-boot.log real do S96bootlog", () => {
    // O caminho de uso no X35H: o `S96bootlog` grava o log na FAT do cartão, o
    // log é copiado para o PC, e `panel-diag.sh --log` analisa. Verificado no
    // R35S em 17/11/2026 — o formato abaixo é um recorte do arquivo real
    // (482 linhas), não um fixture inventado.
    //
    // O log já traz as DUAS metades que o veredito precisa: o dmesg (`## dmesg`)
    // e o estado do conector (`## DRM: conectores, status e modos`). Por isso
    // `--log` funciona sem nenhuma adaptação — e é o que faz o diagnóstico do
    // X35H ser possível sem ninguém com SSH no aparelho.
    const log = `=== giochi-boot.log — fase early — 2026-11-17T18:59:07Z (UTC) ===

## cmdline
console=ttyS2,1500000n8

## dmesg
[    1.139177] panel-generic-dsi ff450000.dsi.0: lanes 4, format 0, mode e03
[    1.149824] rockchip-drm display-subsystem: [drm] fb0: rockchipdrmfb frame buffer device
[    2.524617] Console: switching to colour frame buffer device 80x30

## DRM: conectores, status e modos
/sys/class/drm/card0-DSI-1/status: connected
/sys/class/drm/card0-DSI-1/modes: 640x480

## selftest
  [PASS] conector card0-DSI-1: connected 640x480
=== fim — 2026-11-17T18:59:21Z (UTC) ===
`;
    const saida = analisar("bootlog.log", log);
    assert.match(saida, /O painel inicializou NESTE boot/);
    assert.match(saida, /o conector DSI está 'connected'/,
        "a seção '## DRM' do S96bootlog é o que responde a consequência; se o " +
        "formato mudar, o veredito perde a metade que prova");
});
