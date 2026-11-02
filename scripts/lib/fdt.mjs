// Leitor de Flattened Device Tree (FDT/DTB) e extrator de mapa de botões.
//
// O DTB é binário, mas o formato é aberto e simples: cabeçalho big-endian,
// bloco de estrutura com tokens, e um bloco de strings.
//
// Por que escrever isto em vez de exigir `dtc`: o usuário tem um .dtb e nenhuma
// ferramenta de device tree na máquina Windows. Converter .dtb → buttons.map
// aqui evita instalar toolchain para uma tarefa de cinco segundos.

const FDT_MAGIC = 0xd00dfeed;

const FDT_BEGIN_NODE = 0x1;
const FDT_END_NODE = 0x2;
const FDT_PROP = 0x3;
const FDT_NOP = 0x4;
const FDT_END = 0x9;

/** Código evdev → nome do símbolo. O inverso do que o launcher usa. */
const CODE_NAMES = new Map([
  [0x130, "BTN_SOUTH"],
  [0x131, "BTN_EAST"],
  [0x133, "BTN_NORTH"],
  [0x134, "BTN_WEST"],
  [0x136, "BTN_TL"],
  [0x137, "BTN_TR"],
  [0x138, "BTN_TL2"],
  [0x139, "BTN_TR2"],
  [0x13a, "BTN_SELECT"],
  [0x13b, "BTN_START"],
  [0x13c, "BTN_MODE"],
  [0x13d, "BTN_THUMBL"],
  [0x13e, "BTN_THUMBR"],
  [0x220, "BTN_DPAD_UP"],
  [0x221, "BTN_DPAD_DOWN"],
  [0x222, "BTN_DPAD_LEFT"],
  [0x223, "BTN_DPAD_RIGHT"],
  [0x114, "KEY_VOLUMEDOWN"],
  [0x115, "KEY_VOLUMEUP"],
]);

/** Símbolo do kernel → nome lógico do mapa. */
const SYMBOL_TO_NAME = new Map([
  ["BTN_DPAD_UP", "up"],
  ["BTN_DPAD_DOWN", "down"],
  ["BTN_DPAD_LEFT", "left"],
  ["BTN_DPAD_RIGHT", "right"],
  ["BTN_EAST", "a"],
  ["BTN_SOUTH", "b"],
  ["BTN_NORTH", "x"],
  ["BTN_WEST", "y"],
  ["BTN_TL", "l"],
  ["BTN_TR", "r"],
  ["BTN_TL2", "l2"],
  ["BTN_TR2", "r2"],
  ["BTN_SELECT", "select"],
  ["BTN_START", "start"],
  ["BTN_MODE", "home"],
  ["BTN_THUMBL", "thumbl"],
  ["BTN_THUMBR", "thumbr"],
  ["KEY_VOLUMEUP", "volup"],
  ["KEY_VOLUMEDOWN", "voldown"],
]);

const AXIS_CODES = new Map([
  [0x00, "ABS_X"],
  [0x01, "ABS_Y"],
  [0x03, "ABS_RX"],
  [0x04, "ABS_RY"],
]);

function align4(value) {
  return (value + 3) & ~3;
}

/**
 * Decodifica um DTB em árvore.
 * Nó: { name, props: Map<string, Buffer>, children: [] }
 */
export function parseFdt(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("esperava um Buffer");
  }
  if (buffer.length < 40) {
    throw new Error(`arquivo curto demais para DTB (${buffer.length} bytes)`);
  }

  const magic = buffer.readUInt32BE(0);
  if (magic !== FDT_MAGIC) {
    throw new Error(
      `não é DTB: magic 0x${magic.toString(16)} (esperado 0x${FDT_MAGIC.toString(16)})`,
    );
  }

  const totalsize = buffer.readUInt32BE(4);
  const offStruct = buffer.readUInt32BE(8);
  const offStrings = buffer.readUInt32BE(12);
  const sizeStrings = buffer.readUInt32BE(32);
  const sizeStruct = buffer.readUInt32BE(36);

  if (totalsize > buffer.length) {
    throw new Error(`DTB truncado: cabeçalho diz ${totalsize}, arquivo tem ${buffer.length}`);
  }
  if (offStruct + sizeStruct > buffer.length) {
    throw new Error("bloco de estrutura fora do arquivo");
  }
  if (offStrings + sizeStrings > buffer.length) {
    throw new Error("bloco de strings fora do arquivo");
  }

  const readString = (offset) => {
    const start = offStrings + offset;
    if (offset >= sizeStrings) throw new Error(`nome de propriedade fora da tabela: ${offset}`);
    let end = start;
    while (end < offStrings + sizeStrings && buffer[end] !== 0) end += 1;
    return buffer.toString("utf8", start, end);
  };

  // O nó raiz do FDT vem como FDT_BEGIN_NODE com nome vazio. Ele **é** a raiz,
  // não filho de uma raiz inventada — por isso a pilha começa vazia.
  let root = null;
  const stack = [];
  let pos = offStruct;
  const end = offStruct + sizeStruct;

  while (pos < end) {
    const token = buffer.readUInt32BE(pos);
    pos += 4;

    if (token === FDT_NOP) continue;

    if (token === FDT_END) break;

    if (token === FDT_BEGIN_NODE) {
      let nameEnd = pos;
      while (nameEnd < end && buffer[nameEnd] !== 0) nameEnd += 1;
      const name = buffer.toString("utf8", pos, nameEnd);
      pos = align4(nameEnd + 1);

      const node = { name, props: new Map(), children: [] };
      if (stack.length === 0) {
        root = node;
        if (!node.name) node.name = "/";
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
      continue;
    }

    if (token === FDT_END_NODE) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (token === FDT_PROP) {
      const length = buffer.readUInt32BE(pos);
      const nameOffset = buffer.readUInt32BE(pos + 4);
      const dataStart = pos + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > end) throw new Error("propriedade passa do fim do bloco");

      const propName = readString(nameOffset);
      stack[stack.length - 1].props.set(propName, buffer.subarray(dataStart, dataEnd));
      pos = align4(dataEnd);
      continue;
    }

    throw new Error(`token desconhecido 0x${token.toString(16)} na posição ${pos - 4}`);
  }

  if (!root) {
    throw new Error("DTB sem nó raiz (nenhum FDT_BEGIN_NODE)");
  }

  return root;
}

/** Percorre a árvore em profundidade. */
export function walkFdt(node, visit, path = "") {
  const here = node.name === "/" ? "" : `${path}/${node.name}`;
  visit(node, here || "/");
  for (const child of node.children) {
    walkFdt(child, visit, here);
  }
}

function readU32Prop(props, name) {
  const data = props.get(name);
  if (!data || data.length < 4) return null;
  return data.readUInt32BE(0);
}

function readStringProp(props, name) {
  const data = props.get(name);
  if (!data) return null;
  let end = 0;
  while (end < data.length && data[end] !== 0) end += 1;
  return data.toString("utf8", 0, end);
}

function readStringListProp(props, name) {
  const data = props.get(name);
  if (!data) return [];
  return data
    .toString("utf8")
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Extrai botões e eixos de uma árvore já decodificada.
 *
 * Devolve { buttons: [{ name, symbol, code, label, node }], axes: [...], unknown: [...] }
 */
export function buttonsFromFdt(root) {
  const buttons = [];
  const axes = [];
  const unknown = [];

  walkFdt(root, (node, path) => {
    const compatible = readStringListProp(node.props, "compatible");
    const isKeys = compatible.includes("gpio-keys") || compatible.includes("gpio-keys-polled");
    const isAdc = compatible.includes("adc-joystick");

    if (isAdc) {
      for (const axis of node.children) {
        const code = readU32Prop(axis.props, "linux,code");
        if (code === null) continue;
        const symbol = AXIS_CODES.get(code) ?? `ABS_?0x${code.toString(16)}`;
        const range = axis.props.get("abs-range");
        const flat = readU32Prop(axis.props, "abs-flat");
        axes.push({
          symbol,
          code,
          node: `${path}/${axis.name}`,
          min: range && range.length >= 8 ? range.readUInt32BE(0) : null,
          max: range && range.length >= 8 ? range.readUInt32BE(4) : null,
          flat,
        });
      }
      return;
    }

    if (!isKeys) return;

    for (const button of node.children) {
      const code = readU32Prop(button.props, "linux,code");
      if (code === null) continue;

      const symbol = CODE_NAMES.get(code);
      const label = readStringProp(button.props, "label");
      const name = symbol ? SYMBOL_TO_NAME.get(symbol) : undefined;

      if (name && symbol) {
        buttons.push({ name, symbol, code, label, node: `${path}/${button.name}` });
      } else {
        unknown.push({
          code,
          hex: `0x${code.toString(16)}`,
          symbol: symbol ?? "desconhecido",
          label,
          node: `${path}/${button.name}`,
        });
      }
    }
  });

  return { buttons, axes, unknown };
}

/** Monta o texto de `buttons.map` a partir do resultado. */
export function renderButtonsMap({ buttons, axes, unknown }, source) {
  const lines = [
    `# Mapa de botões — gerado de ${source}`,
    "#",
    "# Gerado por scripts/dtb-buttons.mjs a partir do device tree.",
    "# O DTS é a fonte da verdade: se o hardware divergir, corrigir aqui.",
    "",
    "# ── botões ──────────────────────────────────────────────────",
  ];

  const order = [
    "up", "down", "left", "right",
    "a", "b", "x", "y",
    "l", "r", "l2", "r2",
    "start", "select", "home",
    "thumbl", "thumbr", "volup", "voldown",
  ];
  const byName = new Map(buttons.map((button) => [button.name, button]));

  for (const name of order) {
    const button = byName.get(name);
    if (!button) continue;
    const pad = name.padEnd(8);
    const label = button.label ? `   # ${button.label}` : "";
    lines.push(`${pad}= ${button.symbol.padEnd(14)}${label}`.trimEnd());
  }

  for (const button of buttons) {
    if (order.includes(button.name)) continue;
    lines.push(`${button.name.padEnd(8)}= ${button.symbol}`);
  }

  if (axes.length > 0) {
    lines.push("", "# ── analógico ───────────────────────────────────────────────");
    for (const axis of axes) {
      if (axis.min === null) {
        lines.push(`# ${axis.symbol}: abs-range ausente no DTS`);
        continue;
      }
      const key = axis.symbol.toLowerCase().replace("abs_", "axis_");
      lines.push(`${`${key}_min`.padEnd(14)}= ${axis.min}`);
      lines.push(`${`${key}_max`.padEnd(14)}= ${axis.max}`);
      if (axis.flat) lines.push(`${`${key}_flat`.padEnd(14)}= ${axis.flat}`);
    }
  }

  if (unknown.length > 0) {
    lines.push("", "# ── códigos sem nome lógico (revisar) ───────────────────────");
    for (const item of unknown) {
      lines.push(`# ${item.hex} ${item.symbol}${item.label ? ` "${item.label}"` : ""} em ${item.node}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Nomes que faltaram, comparados com o contrato do launcher. */
export function missingRequired({ buttons }) {
  const required = [
    "up", "down", "left", "right",
    "a", "b", "x", "y",
    "l", "r", "start", "select",
  ];
  const have = new Set(buttons.map((button) => button.name));
  return required.filter((name) => !have.has(name));
}
