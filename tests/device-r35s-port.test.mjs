#!/usr/bin/env node
// O port do R35S: o que foi extraído do aparelho e o encanamento de DTS.
//
// Contexto medido em 06/11/2026: com a console serial funcionando, extraí do
// R35S a config do kernel que boota nele, e provei que DTS e os dois drivers
// fora da árvore compilam contra o NOSSO kernel 6.12. Este teste prende as duas
// metades para não virarem ficção quando alguém mexer.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const DEVICE = `${ROOT}device/r35s`;
const device = JSON.parse(readFileSync(`${DEVICE}/device.json`, "utf8"));

// ── artefatos extraídos do aparelho ─────────────────────────

test("a config do kernel veio do aparelho e o md5 é o medido", () => {
  // O md5 foi lido no aparelho com `md5sum` e conferido do lado de cá pelo
  // serial-pull.py. Fixar aqui impede que um arquivo trocado passe como se
  // fosse a medição original.
  const raw = readFileSync(`${DEVICE}/extracted/kernel-config.gz`);
  const md5 = createHash("md5").update(raw).digest("hex");
  assert.equal(md5, "93bf213f1cbaed4f5867236cdfb4c13c");
  assert.equal(raw.length, 41849);
});

test("a config descomprime e é um kernel config de verdade", () => {
  const text = gunzipSync(readFileSync(`${DEVICE}/extracted/kernel-config.gz`)).toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  assert.ok(lines.length > 5000, `só ${lines.length} linhas`);
  assert.match(text, /^CONFIG_ARM64=y$/m);
  // Deve ser a config do vendor, não a nossa: é o que dá valor comparativo.
  assert.match(text, /^CONFIG_DEFAULT_HOSTNAME="ROCKNIX"$/m);
  assert.match(text, /^CONFIG_ARCH_ROCKCHIP=y$/m);
});

test("os símbolos do fragmento existem na config do vendor", () => {
  // Cada símbolo que afirmamos ser necessário deve ter sido OBSERVADO no
  // aparelho. Se um saiu daqui sem estar lá, é invenção.
  const vendor = gunzipSync(readFileSync(`${DEVICE}/extracted/kernel-config.gz`)).toString("utf8");
  const fragment = readFileSync(`${DEVICE}/linux.fragment`, "utf8");
  const symbols = [...fragment.matchAll(/^CONFIG_([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  assert.ok(symbols.length > 40, `fragmento com só ${symbols.length} símbolos`);

  const missing = symbols.filter((symbol) => !new RegExp(`^CONFIG_${symbol}=`, "m").test(vendor));
  // Exceções têm de ser EXPLÍCITAS e ter motivo. Silêncio aqui transformaria
  // "achei no aparelho" em "inventei", que é a diferença entre medir e supor.
  const allowed = new Set([
    // Sub-símbolo do MFD no 6.12; o vendor o embute de outra forma.
    "MFD_RK8XX_I2C",
    // ESCOLHA NOSSA, não medição: o vendor usa outro governor. O `schedutil` é
    // o padrão do mainline para ARM e é o que interage bem com `cpufreq-dt`.
    "CPU_FREQ_DEFAULT_GOV_SCHEDUTIL",
    // ESCOLHA NOSSA (AGENTS §12.31): o dongle barato de hoje é o 8188FU, que só
    // é coberto com UNTESTED ligado. O vendor não precisa porque não empacota
    // driver de dongle.
    "RTL8XXXU_UNTESTED",
  ]);
  const unexpected = missing.filter((symbol) => !allowed.has(symbol));
  assert.deepEqual(unexpected, [], `símbolos inventados: ${unexpected.join(", ")}`);
});

// ── os drivers fora da árvore estão vendorizados ────────────

test("os dois drivers GPL estão no repositório, com licença", () => {
  for (const file of [
    "kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c",
    "kernel-modules/rocknix-joypad/rocknix-joypad.c",
    "kernel-modules/rocknix-joypad/CREDITS",
    "kernel-modules/generic-dsi/panel-generic-dsi.c",
  ]) {
    assert.ok(existsSync(`${DEVICE}/${file}`), `falta ${file}`);
  }
  // GPL declarada nos fontes: é o que torna legítimo trazer para cá.
  const joypad = readFileSync(`${DEVICE}/kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c`, "utf8");
  assert.match(joypad, /MODULE_LICENSE\("GPL"\)/);
});

test("a correção do joypad_input_g está declarada, não escondida", () => {
  // O vendor declara `extern struct input_dev *joypad_input_g;` e NUNCA define.
  // Compilar os dois módulos separados dá `modpost: undefined!` — e o Makefile
  // do upstream esconde isso por acidente: sem DEVICE definido, `$(filter
  // $(DEVICE), S922X RK3588)` também é vazio, `empty == empty` é verdadeiro e
  // ele compila SÓ o rocknix-joypad.o, sem nunca tocar no arquivo problemático.
  const source = readFileSync(`${DEVICE}/kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c`, "utf8");
  const hasExtern = /^extern struct input_dev \* joypad_input_g;/m.test(source);
  const hasDefinition = /^struct input_dev \*joypad_input_g;/m.test(source);
  assert.ok(
    !hasExtern || hasDefinition,
    "ou o `extern` sai, ou uma definição precisa existir — senão o modpost quebra",
  );
});

// ── encanamento de DTS fora da árvore ───────────────────────

test("o device.json declara dtsPaths relativos e todos existem", () => {
  assert.ok(Array.isArray(device.dtsPaths) && device.dtsPaths.length > 0);
  for (const relative of device.dtsPaths) {
    assert.ok(!relative.startsWith("/"), `caminho absoluto em dtsPaths: ${relative}`);
    assert.ok(existsSync(`${DEVICE}/${relative}`), `dtsPaths aponta para arquivo inexistente: ${relative}`);
  }
});

test("o DTS do R35S chega ao build: o painel entra pelo include gerado", () => {
  const wrapper = `${DEVICE}/dts/generated/rk3326-gameconsole-r36s-giochi.dts`;
  const text = readFileSync(wrapper, "utf8");
  // O include é o ÚNICO desvio do DTS vendorizado.
  assert.match(text, /#include "panel-panel4\.dtsi"/);
  // E tem de vir DEPOIS do include do grupo, porque o painel sobrescreve o
  // `internal_display` que o grupo declara. Ordem trocada = painel ignorado.
  const includePanel = text.indexOf('#include "panel-panel4.dtsi"');
  const includeGroup = text.indexOf('#include "rk3326-device-group-r36.dtsi"');
  assert.ok(includePanel > includeGroup, "o include do painel precisa vir depois do grupo");
});

test("o dtsi do painel traz a lista de strings, não uma linha só", () => {
  const text = readFileSync(`${DEVICE}/dts/generated/panel-panel4.dtsi`, "utf8");
  const match = text.match(/panel_description = ([\s\S]*?);\n/);
  assert.ok(match, "panel_description ausente");
  const quoted = match[1].match(/"[^"]*"/g) ?? [];
  // 1 G + 3 M + 155 I + #END. O driver lê com of_property_read_string_index,
  // então uma string gigante com \n dentro seria UM elemento e ele leria lixo.
  assert.equal(quoted.length, 160, `esperava 160 strings, veio ${quoted.length}`);
  assert.ok(quoted[0].startsWith('"G size=52,70'));
  assert.equal(quoted[159], '"#END"');
});

test("o gerador reproduz o dtsi versionado", () => {
  // Se a descrição do painel mudar e ninguém regenerar, o DTS e o `.txt` passam
  // a divergir em silêncio — build verde, painel errado.
  const fresh = execFileSync(
    process.execPath,
    [`${ROOT}scripts/panel-to-dtsi.mjs`, `${DEVICE}/panels/r36s-panel4.txt`],
    { encoding: "utf8", maxBuffer: 4 << 20 },
  );
  const committed = readFileSync(`${DEVICE}/dts/generated/panel-panel4.dtsi`, "utf8");
  // Compara o corpo (o cabeçalho tem o caminho do arquivo, que não muda).
  const body = (text) => text.slice(text.indexOf("&internal_display"));
  assert.equal(body(fresh), body(committed), "regenere com panel-to-dtsi.mjs");
});

// ── o bloqueio que resta está declarado ─────────────────────

test("o device.json diz que a imagem ainda depende do carregador de boot", () => {
  // Sem isto, alguém tenta `build-device.sh r35s`, recebe erro de defconfig
  // vazio e conclui que o problema é o DTS — que já funciona.
  assert.match(device.bootNotes, /idbloader|U-Boot|carregador/i);
  assert.equal(device.buildrootDefconfig, "", "defconfig vazio é intencional: falta o loader");
});
