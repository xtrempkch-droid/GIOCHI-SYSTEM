// ============================================================
// Giochi System — descrição de painel MIPI-DSI (`panel_description`)
// ============================================================
// O R36S e seus clones saem de fábrica com pelo menos cinco painéis
// diferentes, e o mesmo cartão tem de ligar em todos. O ROCKNIX resolve isso
// com o driver `rocknix,generic-dsi`, que NÃO tem timing de painel no código:
// recebe a descrição como DADO, na propriedade `panel_description` de um
// overlay `.dtbo`.
//
// Este módulo lê esse formato. Não é curiosidade: é a única forma de comparar
// dois painéis sem ter os dois aparelhos na mão.
//
// O formato, medido nos cinco overlays de `device/r35s/panels/`:
//
//   G size=<largura>,<altura> delays=<5 números> format=rgb888 lanes=4 flags=0xe03
//   M clock=<kHz> horizontal=<ativo>,<fp>,<sw>,<bp> vertical=<...> [default=1] [# <Hz>]
//   I seq=<hex> [wait=<ms>] [# orig_cmd=0x..]
//   #END
//
// `G` é geral, `M` é um modo de vídeo, `I` é um comando DCS da sequência de
// inicialização. As linhas vêm separadas por NUL, não por newline — isso não é
// detalhe de estilo: procurar por `\n` devolve a propriedade inteira como uma
// linha só e todo parse por linha falha em silêncio.
//
// SOBRE `clock`: é o pixel clock em kHz. Verificado nos três modos do painel 4,
// que declaram o refresh desejado em comentário (`# 60`, `# 50`, `# 75`):
//
//   htotal = 640+46+2+44 = 732   vtotal = 480+165+2+14 = 661
//   29_000_000 / (732 × 661) = 59,94 Hz   ← bate com o `# 60` declarado
//
// É essa conferência que dá sentido ao módulo: quando o comentário e a conta
// divergem, um dos dois está errado, e o sintoma no aparelho é tela que não
// sincroniza — sem mensagem nenhuma.

const SEPARATOR = "\u0000";

function numbers(text, count, field) {
  const parts = text.split(",").map((item) => item.trim());
  const values = parts.map(Number);
  if (values.length !== count || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`campo ${field}: esperava ${count} números, veio "${text}"`);
  }
  return values;
}

/** Divide a propriedade em linhas. Aceita NUL (do DTBO) e newline (texto salvo). */
export function splitLines(text) {
  return text
    .split(SEPARATOR)
    .flatMap((chunk) => chunk.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Separa `chave=valor` de comentário `# ...`.
 * O comentário é preservado porque carrega o refresh declarado — é a única
 * testemunha de qual painel o autor tinha em mente.
 */
function splitComment(line) {
  const hash = line.indexOf("#");
  if (hash === -1) return { body: line.trim(), comment: "" };
  return { body: line.slice(0, hash).trim(), comment: line.slice(hash + 1).trim() };
}

function refreshHz(clockKhz, horizontal, vertical) {
  const hTotal = horizontal.reduce((a, b) => a + b, 0);
  const vTotal = vertical.reduce((a, b) => a + b, 0);
  if (hTotal <= 0 || vTotal <= 0) return null;
  return (clockKhz * 1000) / (hTotal * vTotal);
}

/**
 * Lê uma `panel_description`.
 *
 * Devolve:
 *   { general, modes: [...], init: [...], counts: {...} }
 *
 * Cada modo traz `refreshHz` CALCULADO e `declaredHz` LIDO do comentário — são
 * coisas diferentes e o relatório mostra as duas lado a lado de propósito.
 */
export function parsePanelDescription(text) {
  const lines = splitLines(text);
  if (lines.length === 0) throw new Error("panel_description vazia");

  let general = null;
  let ended = false;
  const modes = [];
  const init = [];

  for (const line of lines) {
    // `#END` tem de ser reconhecido ANTES do descarte de corpo vazio: ele começa
    // com `#`, então para o separador de comentário o corpo é vazio e a linha
    // seria descartada em silêncio. Foi o que aconteceu na primeira versão —
    // todo painel saía como "SEM #END".
    if (line === "#END") {
      ended = true;
      continue;
    }

    const { body, comment } = splitComment(line);
    if (body.length === 0) continue;

    const tag = body[0];
    if (tag === "G") {
      if (general !== null) throw new Error("duas linhas G: só uma descrição geral é esperada");
      const size = /size=([\d,]+)/.exec(body);
      const delays = /delays=([\d,]+)/.exec(body);
      const format = /format=(\w+)/.exec(body);
      const lanes = /lanes=(\d+)/.exec(body);
      const flags = /flags=(0x[0-9a-f]+|\d+)/.exec(body);
      if (!size) throw new Error("linha G sem size=");
      const [width, height] = numbers(size[1], 2, "size");
      general = {
        width,
        height,
        delays: delays ? numbers(delays[1], delays[1].split(",").length, "delays") : [],
        format: format ? format[1] : null,
        lanes: lanes ? Number(lanes[1]) : null,
        flags: flags ? Number(flags[1]) : null,
      };
      continue;
    }

    if (tag === "M") {
      const clock = /clock=(\d+)/.exec(body);
      const horizontal = /horizontal=([\d,]+)/.exec(body);
      const vertical = /vertical=([\d,]+)/.exec(body);
      if (!clock || !horizontal || !vertical) {
        throw new Error(`linha M incompleta: "${body}"`);
      }
      const h = numbers(horizontal[1], 4, "horizontal");
      const v = numbers(vertical[1], 4, "vertical");
      const declared = /(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/.exec(comment);
      modes.push({
        clockKhz: Number(clock[1]),
        horizontal: h,
        vertical: v,
        hTotal: h.reduce((a, b) => a + b, 0),
        vTotal: v.reduce((a, b) => a + b, 0),
        active: { width: h[0], height: v[0] },
        isDefault: /\bdefault=1\b/.test(body),
        refreshHz: refreshHz(Number(clock[1]), h, v),
        declaredHz: declared ? Number(declared[1]) : null,
        comment,
      });
      continue;
    }

    if (tag === "I") {
      const seq = /seq=([0-9a-fA-F]+)/.exec(body);
      if (!seq) throw new Error(`linha I sem seq=: "${body}"`);
      const hex = seq[1];
      if (hex.length % 2 !== 0) throw new Error(`seq com número ímpar de dígitos: "${hex}"`);
      const bytes = Buffer.from(hex, "hex");
      const wait = /wait=(\d+)/.exec(body);
      const orig = /orig_cmd=(0x[0-9a-fA-F]+)/.exec(comment);
      init.push({
        command: bytes[0],
        data: bytes.subarray(1),
        waitMs: wait ? Number(wait[1]) : 0,
        origCmd: orig ? Number(orig[1]) : null,
      });
      continue;
    }

    throw new Error(`linha desconhecida (esperava G, M ou I): "${line}"`);
  }

  if (general === null) throw new Error("sem linha G: a descrição não diz o tamanho do painel");
  if (modes.length === 0) throw new Error("sem linha M: a descrição não tem modo de vídeo");

  return {
    general,
    modes,
    init,
    counts: {
      modes: modes.length,
      init: init.length,
      initDelayMs: init.reduce((sum, item) => sum + item.waitMs, 0),
    },
    ended,
  };
}

/** O modo que o driver escolhe sem `--mode`: o marcado `default=1`, ou o primeiro. */
export function defaultMode(panel) {
  return panel.modes.find((mode) => mode.isDefault) ?? panel.modes[0];
}

/**
 * Confere o refresh declarado em comentário contra o calculado.
 * Devolve a lista de divergências (vazia = tudo bate).
 * Tolerância de 1%: o clock é declarado em kHz inteiro, então 59,94 contra 60
 * é arredondamento, não erro.
 */
export function checkDeclaredRefresh(panel, tolerance = 0.01) {
  const problems = [];
  for (const [index, mode] of panel.modes.entries()) {
    if (mode.declaredHz === null) continue;
    const drift = Math.abs(mode.refreshHz - mode.declaredHz) / mode.declaredHz;
    if (drift > tolerance) {
      problems.push({
        mode: index,
        declaredHz: mode.declaredHz,
        computedHz: mode.refreshHz,
        drift,
      });
    }
  }
  return problems;
}

/**
 * Confere a razão de aspecto do modo ativo contra o tamanho físico declarado.
 *
 * `size` é o tamanho físico do painel em milímetros. **Medido: a ordem é
 * (lado curto, lado longo)**, não (largura, altura) — `size=52,70` num painel
 * 640x480 dá 70/52 = 1,346 contra 640/480 = 1,333, que confere; lido como
 * (largura, altura) daria 0,743 e acusaria erro em quatro painéis que estão
 * certos. Então a comparação aqui é **sem rotação**: razão longa/curta dos dois
 * lados. Um painel montado em retrato não deve ser acusado.
 *
 * Quando as duas razões divergem, o sintoma no aparelho não é tela preta — é
 * **imagem esticada**, que é mais difícil de reconhecer porque "funciona".
 *
 * Medido em 06/11/2026 nos overlays do R35S: `r36s_clone` declara `size=153,85`
 * (razão 1,80, um painel de ~7" 16:9) com todos os 12 modos em 640x480
 * (razão 1,33). Os outros quatro declaram 52,70 e conferem. Não se sabe qual
 * dos dois lados está errado naquele overlay, e por isso isto é aviso.
 */
export function checkGeometry(panel, tolerance = 0.05) {
  const mode = defaultMode(panel);
  const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);
  const physical = ratio(panel.general.width, panel.general.height);
  const active = ratio(mode.active.width, mode.active.height);
  const drift = Math.abs(physical - active) / active;
  if (drift <= tolerance) return [];
  return [
    {
      physical,
      active,
      drift,
      size: `${panel.general.width}x${panel.general.height} mm`,
      mode: `${mode.active.width}x${mode.active.height}`,
    },
  ];
}

/**
 * Resumo em uma linha, para comparar painéis numa tabela.
 * `refreshHz` é o do modo padrão.
 */
export function summarize(name, panel) {
  const mode = defaultMode(panel);
  return {
    name,
    width: panel.general.width,
    height: panel.general.height,
    lanes: panel.general.lanes,
    clockKhz: mode.clockKhz,
    hTotal: mode.hTotal,
    vTotal: mode.vTotal,
    refreshHz: mode.refreshHz,
    modes: panel.modes.length,
    initCommands: panel.init.length,
  };
}
