// ============================================================
// Giochi System — linha de comando do kernel, por aparelho
// ============================================================
// A cmdline ficou cravada no `make-sd-image.sh` com os valores da X55
// (`ttyS2,1500000n8`, `earlycon=...0xfe660000`, `fbcon=rotate:3`). Isso não é
// um problema enquanto existe um aparelho só; a partir do segundo é a mesma
// falha silenciosa que este repositório combate: o cartão boota, o console não
// aparece, e nada diz que a UART errada foi usada.
//
// Então os valores passam a ser declarados em `device.json`, campo
// `kernelCmdline`, e este módulo compõe a string. O `root=` fica de fora do
// device.json porque depende do PARTUUID, que só existe quando o cartão é
// montado (ver `DISK_ID` no make-sd-image.sh).
//
// SOBRE RESOLUÇÃO, que é o motivo desta mudança existir:
//
//   `video=` NÃO cria um modo novo. Ele escolhe entre os modos que o conector
//   já anuncia. Num painel DSI o modo é NATIVO e vem do driver do painel —
//   `video=DSI-1:800x600` num painel 640x480 não vira 800x600, ele é ignorado
//   (ou pior, aplica um modo inexistente e a tela fica preta).
//
//   Ou seja: resolução de painel se muda no DTS/driver do painel, não aqui.
//   `video=` serve para saídas que suportam mode setting de verdade (HDMI,
//   VGA, virtio-gpu do QEMU). Para um aparelho com painel de 800x600, o que
//   este campo precisa declarar é o resto (console, earlycon, rotação).

// `ttyS2` tem maiúscula: o nome é do driver (8250), não uma escolha nossa.
const CONSOLE_RE = /^[a-z][a-z0-9]*$/i;
const EARLYCON_RE = /^[a-z0-9]+,[a-z0-9]+,[a-z0-9]+(?:,[0-9a-fx]+)?$/;

/**
 * Valida o bloco `kernelCmdline` de um device.json.
 * Devolve array de erros (vazio = ok). Não lança: quem chama decide.
 */
export function validateCmdlineSpec(spec) {
  const errors = [];
  const require = (cond, message) => {
    if (!cond) errors.push(message);
  };

  if (spec === undefined) {
    return ["kernelCmdline não declarado: sem ele o cartão não tem console."];
  }
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return ["kernelCmdline deve ser um objeto."];
  }

  require(
    typeof spec.console === "string" && CONSOLE_RE.test(spec.console),
    "kernelCmdline.console deve ser um nome de tty (ex.: ttyS2, ttyFIQ0).",
  );

  if (spec.baud !== undefined) {
    require(
      Number.isInteger(spec.baud) && spec.baud >= 1200 && spec.baud <= 4_000_000,
      "kernelCmdline.baud deve ser inteiro entre 1200 e 4000000.",
    );
  }

  if (spec.earlycon !== undefined) {
    require(
      typeof spec.earlycon === "string" && EARLYCON_RE.test(spec.earlycon),
      "kernelCmdline.earlycon deve ser <driver>,<tipo>,<endereço> (ex.: uart8250,mmio32,0xfe660000).",
    );
  }

  if (spec.fbconRotate !== undefined) {
    // 0..3 = 0°, 90°, 180°, 270° no sentido anti-horário (definição do fbcon).
    require(
      Number.isInteger(spec.fbconRotate) && spec.fbconRotate >= 0 && spec.fbconRotate <= 3,
      "kernelCmdline.fbconRotate deve ser inteiro de 0 a 3.",
    );
  }

  if (spec.video !== undefined) {
    require(
      typeof spec.video === "string" && /^[\w.:@-]+$/.test(spec.video) && !spec.video.includes(" "),
      "kernelCmdline.video deve ser um modo sem espaço (ex.: HDMI-A-1:800x600@60).",
    );
  }

  if (spec.extra !== undefined) {
    require(
      typeof spec.extra === "string" && !spec.extra.includes("\n"),
      "kernelCmdline.extra deve ser string de uma linha.",
    );
  }

  const known = new Set([
    "console",
    "baud",
    "earlycon",
    "fbconRotate",
    "video",
    "extra",
    "rootfstype",
    "rootwait",
    "rw",
  ]);
  for (const key of Object.keys(spec)) {
    require(known.has(key), `kernelCmdline: campo desconhecido "${key}".`);
  }

  if (spec.rootfstype !== undefined) {
    require(
      typeof spec.rootfstype === "string" && /^[a-z0-9]+$/.test(spec.rootfstype),
      "kernelCmdline.rootfstype deve ser um nome de filesystem (ex.: ext4).",
    );
  }
  if (spec.rootwait !== undefined) {
    require(typeof spec.rootwait === "boolean", "kernelCmdline.rootwait deve ser booleano.");
  }
  if (spec.rw !== undefined) {
    require(typeof spec.rw === "boolean", "kernelCmdline.rw deve ser booleano.");
  }

  return errors;
}

/**
 * Compõe a cmdline. `partuuid` é o da partição do rootfs (ex.: `47494f43-02`).
 */
export function buildKernelCmdline(spec, { partuuid } = {}) {
  const errors = validateCmdlineSpec(spec);
  if (partuuid === undefined) {
    errors.push("partuuid não informado: o kernel precisa saber onde está o rootfs.");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const parts = [`root=PARTUUID=${partuuid}`];

  // Ordem preservada da cmdline que bootou na X55. Não é cosmético: a ordem dos
  // `console=` define qual vira o console primário, e o `/dev/console` do init
  // segue o último registrado.
  if (spec.rootwait !== false) parts.push("rootwait");
  if (spec.rw !== false) parts.push("rw");
  parts.push(`rootfstype=${spec.rootfstype ?? "ext4"}`);
  parts.push(
    spec.baud ? `console=${spec.console},${spec.baud}n8` : `console=${spec.console}`,
  );
  if (spec.earlycon) parts.push(`earlycon=${spec.earlycon}`);
  if (spec.fbconRotate !== undefined) parts.push(`fbcon=rotate:${spec.fbconRotate}`);
  if (spec.video) parts.push(`video=${spec.video}`);
  if (spec.extra) parts.push(spec.extra.trim());

  return parts.join(" ");
}
