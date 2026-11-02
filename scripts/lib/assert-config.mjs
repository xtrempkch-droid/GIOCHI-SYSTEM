// Núcleo da verificação pós-`olddefconfig`.
//
// Por que existe: o `olddefconfig` do Buildroot descarta símbolo em silêncio.
// Ele some quando o nome não existe na versão usada, quando o símbolo virou
// legacy, ou quando o pai de um filho está unset ("depends on" não satisfeito).
// Em todos os casos o build fica verde e a imagem sai sem o que foi pedido.
//
// Este módulo é puro: não escreve, não sai do processo. O CLI fica em
// scripts/assert-config.mjs e os testes importam daqui.
import { readFileSync } from "node:fs";

const BOOL_VALUES = new Set(["y", "m", "n"]);

function readLines(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/);
}

/**
 * Lê os fragmentos e devolve os símbolos pedidos.
 * A primeira ocorrência de cada símbolo vence: o que importa é o que foi pedido,
 * não a ordem de mesclagem (essa é responsabilidade do prepare-config).
 */
export function collectRequested(fragments, allowed = new Set()) {
  const requested = new Map();

  for (const fragment of fragments) {
    for (const rawLine of readLines(fragment)) {
      const line = rawLine.trim();
      if (!line) continue;

      const allow = line.match(/^#\s*giochi-system:allow-drop\s+(BR2_[A-Za-z0-9_]+)/);
      if (allow) {
        allowed.add(allow[1]);
        continue;
      }

      const notSet = line.match(/^#\s*(BR2_[A-Za-z0-9_]+)\s+is not set$/);
      if (notSet) {
        if (!requested.has(notSet[1])) {
          requested.set(notSet[1], { value: null, origin: fragment });
        }
        continue;
      }

      if (line.startsWith("#")) continue;

      const assignment = line.match(/^(BR2_[A-Za-z0-9_]+)=(.+)$/);
      if (!assignment) continue;

      const [, symbol, value] = assignment;
      if (!requested.has(symbol)) {
        requested.set(symbol, { value, origin: fragment });
      }
    }
  }

  return requested;
}

/** Lê o .config resolvido: símbolo → valor, ou null para "is not set". */
export function readConfig(configPath) {
  const values = new Map();
  for (const rawLine of readLines(configPath)) {
    const line = rawLine.trim();
    if (!line) continue;

    const notSet = line.match(/^#\s*(BR2_[A-Za-z0-9_]+)\s+is not set$/);
    if (notSet) {
      values.set(notSet[1], null);
      continue;
    }

    const assignment = line.match(/^(BR2_[A-Za-z0-9_]+)=(.*)$/);
    if (assignment) {
      values.set(assignment[1], assignment[2]);
    }
  }
  return values;
}

/**
 * Compara o pedido com o resultado.
 * Retorna listas separadas para que a mensagem de erro diga o que fazer.
 */
export function verify({ configPath, fragments, allowDrop = [] }) {
  const allowed = new Set(allowDrop.filter(Boolean));
  const requested = collectRequested(fragments, allowed);
  const actual = readConfig(configPath);

  const missing = [];
  const reverted = [];
  const disabled = [];
  const normalize = (item) => (item === null ? null : item.replace(/^"|"$/g, "").trim());

  for (const [symbol, { value, origin }] of requested) {
    if (!actual.has(symbol)) {
      // Ausência no .config = símbolo não existe nesta versão do Buildroot.
      // Para um pedido de "is not set" isso é inofensivo: o intento (desligado)
      // está satisfeito. Para um pedido de valor, é o descarte silencioso.
      if (value !== null && !allowed.has(symbol)) {
        missing.push({ symbol, requested: value, origin });
      }
      continue;
    }

    const got = actual.get(symbol);

    if (value === null) {
      if (got !== null && !allowed.has(symbol)) {
        reverted.push({ symbol, requested: "is not set", got, origin });
      }
      continue;
    }

    if (BOOL_VALUES.has(value)) {
      if (got !== value && !allowed.has(symbol)) {
        disabled.push({
          symbol,
          requested: value,
          got: got === null ? "is not set" : got,
          origin,
        });
      }
      continue;
    }

    // Valores string/numéricos: o olddefconfig pode reescrever aspas e espaços.
    if (normalize(got) !== normalize(value) && !allowed.has(symbol)) {
      disabled.push({
        symbol,
        requested: value,
        got: got === null ? "is not set" : got,
        origin,
      });
    }
  }

  const total = missing.length + reverted.length + disabled.length;
  return {
    ok: total === 0,
    requestedCount: requested.size,
    allowedCount: allowed.size,
    missing,
    disabled,
    reverted,
    total,
  };
}

export function describeValue(value) {
  return value === null ? "is not set" : value;
}
