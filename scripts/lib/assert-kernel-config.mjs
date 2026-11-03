// Verificação do fragmento de KERNEL (`linux.fragment`) contra o `.config` que
// o kernel realmente usou.
//
// Por que existe: `scripts/assert-config.mjs` cobre símbolos `BR2_*` — a
// configuração do Buildroot. Os `CONFIG_*` do kernel são outro Kconfig, outro
// `olddefconfig`, e ninguém verificava o resultado. Medido no primeiro build
// real do X55: dois dos 57 símbolos pedidos simplesmente não existiam no kernel
// 6.12 (`CONFIG_ARM_ROCKCHIP_CPUFREQ` foi removido; `CONFIG_JOYSTICK_ROCKNIX` é
// driver fora da árvore) e um terceiro virou módulo. O build ficou verde.
//
// Convenção para exceção justificada, escrita no próprio fragmento:
//   # giochi-system:allow-drop CONFIG_ALGUM_SIMBOLO motivo curto
import { readFileSync } from "node:fs";

function readLines(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/);
}

/** Símbolos `CONFIG_*` pedidos pelo fragmento, com a origem de cada um. */
export function collectRequested(fragments) {
  const requested = new Map();
  const allowed = new Map();

  for (const fragment of fragments) {
    for (const rawLine of readLines(fragment)) {
      const line = rawLine.trim();
      if (!line) continue;

      const allow = line.match(/^#\s*giochi-system:allow-drop\s+(CONFIG_[A-Za-z0-9_]+)(.*)$/);
      if (allow) {
        allowed.set(allow[1], allow[2].trim());
        continue;
      }

      if (line.startsWith("#")) continue;

      const assignment = line.match(/^(CONFIG_[A-Za-z0-9_]+)=(.*)$/);
      if (!assignment) continue;

      const [, symbol, value] = assignment;
      if (!requested.has(symbol)) {
        requested.set(symbol, { value, origin: fragment });
      }
    }
  }

  return { requested, allowed };
}

/** Lê o `.config` do kernel: símbolo → valor, ou null para "is not set". */
export function readConfig(configPath) {
  const values = new Map();
  for (const rawLine of readLines(configPath)) {
    const line = rawLine.trim();
    if (!line) continue;

    const notSet = line.match(/^#\s*(CONFIG_[A-Za-z0-9_]+)\s+is not set$/);
    if (notSet) {
      values.set(notSet[1], null);
      continue;
    }

    const assignment = line.match(/^(CONFIG_[A-Za-z0-9_]+)=(.*)$/);
    if (assignment) {
      values.set(assignment[1], assignment[2]);
    }
  }
  return values;
}

function describe(value) {
  return value === null ? "is not set" : `=${value}`;
}

/**
 * Compara o pedido com o obtido. Devolve as listas de problemas; não lança,
 * para que o CLI decida a saída e os testes possam inspecionar.
 */
export function verify(requested, config, allowed = new Map()) {
  const missing = [];
  const changed = [];

  for (const [symbol, { value, origin }] of requested) {
    if (allowed.has(symbol)) continue;

    if (!config.has(symbol)) {
      missing.push({ symbol, expected: value, origin });
      continue;
    }

    const actual = config.get(symbol);
    if (actual !== value) {
      changed.push({ symbol, expected: value, actual, origin });
    }
  }

  return { missing, changed, checked: requested.size - allowed.size };
}
