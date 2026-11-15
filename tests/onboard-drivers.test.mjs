#!/usr/bin/env node
// Hardware ONBOARD não pode ficar como módulo.
//
// A regra, e por que ela precisou de um teste no plural.
//
// O rootfs do Buildroot não tem `/etc/modules` nem `modules-load`: nada faz
// autoload por modalias com mdev. Então `CONFIG_X=m` significa "o driver está no
// disco e ninguém o carrega". Para hardware que pode não estar lá — dongle Wi-Fi
// (§12.31) — `=m` é certo: carrega quando o acessório aparece. Para hardware que
// sustenta o aparelho, é o mesmo que não ter driver.
//
// Medido no R35S em 06/11/2026, na mesma imagem, três vezes seguidas:
//
//   CONFIG_DRM_PANFROST=m      → /dev/dri sem render node; Mesa cai em `softpipe`
//                                com GL_VERSION IDÊNTICA (§12.51)
//   CONFIG_CHARGER_RK817=m     → /sys/class/power_supply VAZIO: sem bateria
//   CONFIG_ROCKCHIP_THERMAL=m  → `cooling_device*` órfãos, nenhum `thermal_zone*`
//
// Nos três casos o hardware respondeu a um `modprobe` manual (panfrost criou
// renderD128; rk817_charger criou `rk817-battery` com PRESENT=1; rockchip_thermal
// criou `thermal_zone0 = 44090`). Ou seja: o defeito nunca foi o hardware nem o
// driver — era a ausência de quem os carregasse, com build verde.
//
// O teste prende a INVARIANTE, não os três casos: todo símbolo de hardware
// onboard listado aqui tem de estar `=y`, no fragmento E na `kernel-required.txt`
// (o fragmento é delta; sem o gate, o símbolo some e a imagem sai verde).
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DEVICE = fileURLToPath(new URL("../device/", import.meta.url));
const OVERLAY = fileURLToPath(new URL("../device/common/rootfs-overlay", import.meta.url));

function read(device, file) {
  try {
    return readFileSync(`${DEVICE}${device}/${file}`, "utf8");
  } catch {
    return "";
  }
}

// `=y` efetivo: a linha existe e não está comentada.
function declares(text, symbol, value) {
  const re = new RegExp(`^\\s*${symbol}\\s*=\\s*${value}\\s*$`, "m");
  return re.test(
    text
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n"),
  );
}

// Hardware que existe em TODO boot destes aparelhos. Se um deles deixar de ser
// onboard (o aparelho perder a bateria, por exemplo), corrija esta lista — com
// uma medição, não por conveniência.
const ONBOARD = {
  r35s: ["CONFIG_DRM_PANFROST", "CONFIG_CHARGER_RK817", "CONFIG_ROCKCHIP_THERMAL"],
  "powkiddy x55": ["CONFIG_DRM_PANFROST", "CONFIG_CHARGER_RK817", "CONFIG_ROCKCHIP_THERMAL"],
  "powkiddy x35h": ["CONFIG_DRM_PANFROST", "CONFIG_CHARGER_RK817", "CONFIG_ROCKCHIP_THERMAL"],
};

for (const [device, symbols] of Object.entries(ONBOARD)) {
  test(`${device}: hardware onboard é =y no fragmento, nunca =m`, () => {
    const fragment = read(device, "linux.fragment");
    assert.ok(fragment.length > 0, `${device}: linux.fragment não encontrado`);

    for (const symbol of symbols) {
      assert.ok(
        declares(fragment, symbol, "y"),
        `${device}: ${symbol} deve ser =y (onboard, presente em todo boot)`,
      );
      assert.ok(
        !declares(fragment, symbol, "m"),
        `${device}: ${symbol}=m deixa o driver no disco sem quem o carregue`,
      );
    }
  });

  test(`${device}: a kernel-required.txt exige os mesmos símbolos`, () => {
    const required = read(device, "kernel-required.txt");
    assert.ok(required.length > 0, `${device}: kernel-required.txt não encontrado`);

    for (const symbol of symbols) {
      assert.ok(
        declares(required, symbol, "y"),
        `${device}: kernel-required.txt deve exigir ${symbol}=y — ` +
          `o fragmento é delta e o símbolo pode sumir em silêncio`,
      );
    }
  });
}

test("os aparelhos x86_64 não entram na regra (hardware é o do PC)", () => {
  // Steam Deck e generic-x64 não têm rk817 nem Mali: exigir estes símbolos ali
  // faria o `olddefconfig` descartá-los e o build falhar no `assert-config`
  // por um motivo que não é defeito.
  for (const device of ["steamdeck", "generic-x64"]) {
    const fragment = read(device, "linux.fragment");
    assert.ok(
      !declares(fragment, "CONFIG_CHARGER_RK817", "y"),
      `${device}: CHARGER_RK817 não existe nesta arquitetura`,
    );
  }
});

// ── áudio: o `Playback Mux` é fato de HARDWARE, não do roteamento do DTS ────
//
// Até 15/11/2026 estes testes exigiam que o `asound.state` do R35S pedisse
// `SPK`, deduzido de o DTS rotear `Speaker -> SPKO`. A dedução parte de uma
// premissa falsa, dita pelo próprio driver (6.12,
// `sound/soc/codecs/rk817_codec.c`):
//
//   /* the speaker output and L headphone pin are internally the same */
//
// `SPKO` e `HPOL` são o MESMO pino; o mux escolhe o estágio que o alimenta
// (analógico de fone, ou class-D). Qual dos dois o falante de uma placa toca é
// fato de hardware e não sai do DTS.
//
// Medido no R35S em 15/11/2026, com o mesmo tom: `SPK` -> PCM em RUNNING, DAPM
// ligado, registradores certos e **silêncio**; `HP` -> som no falante.
//
// O que os testes prendem agora é o que dá para provar sem aparelho:
//   1. o `asound.state` do R35S declara um valor ÚNICO e válido (HP);
//   2. o `S51mixer` existe e é executável (sem `+x` o estado não é aplicado);
//   3. o `giochi-selftest` compara o mixer com o DECLARADO, não com o DTS —
//      e não voltou a derivar expectativa da rota.

test("R35S: o asound.state declara Playback Mux = HP (medido no aparelho)", async () => {
  const { readFileSync } = await import("node:fs");
  const state = readFileSync(`${DEVICE}r35s/rootfs-overlay/etc/giochi/asound.state`, "utf8");

  const mux = state.match(/name 'Playback Mux'\s*\n\s*value (\w+)/);
  assert.ok(mux, "asound.state sem o controle Playback Mux");
  assert.equal(
    mux[1],
    "HP",
    "medido em 15/11/2026: com SPK o PCM roda, o DAPM fica On e o aparelho fica MUDO",
  );
});

test("o selftest compara o mixer com o DECLARADO, não com o roteamento do DTS", async () => {
  // A regra antiga derivava a expectativa de `simple-audio-card,routing`. Ela
  // produzia PASS falso na X55 e, depois de corrigida com a mesma lógica,
  // produzia FAIL falso no R35S — porque a pergunta certa é outra: "o mixer
  // está no estado que ESTE aparelho declara?".
  const { readFileSync } = await import("node:fs");
  const selftest = readFileSync(`${OVERLAY}/usr/bin/giochi-selftest`, "utf8");
  assert.match(
    selftest,
    /DECLARED_MUX=.*asound\.state/s,
    "o selftest tem de ler o estado declarado pelo aparelho",
  );
  assert.ok(
    !/EXPECT_MUX=\$\{PARSED/.test(selftest),
    "o selftest voltou a derivar o mux esperado do device tree",
  );
});

test("o S51mixer aplica o estado declarado e é executável", async () => {
  const { readFileSync, statSync } = await import("node:fs");
  const caminho = `${OVERLAY}/etc/init.d/S51mixer`;
  const script = readFileSync(caminho, "utf8");
  assert.match(script, /alsactl -f "\$STATE" restore/, "o S51mixer tem de restaurar o estado");
  assert.ok(
    (statSync(caminho).mode & 0o111) !== 0,
    "S51mixer sem bit de execução: o rcS não o roda e o som fica mudo (§12.50)",
  );
});

test("a X55 não declara asound.state — fica no default do driver (HP)", async () => {
  // A X55 nunca teve estado de mixer: o amplificador dela é alimentado por
  // HPOL/HPOR, que é o caminho do default `HP`. O que este teste impede é
  // alguém "resolver" o áudio de outro aparelho criando um asound.state aqui
  // sem medir — o R35S passou por isso, ao contrário.
  const { existsSync } = await import("node:fs");
  assert.ok(
    !existsSync(`${DEVICE}powkiddy x55/rootfs-overlay/etc/giochi/asound.state`),
    "só declare estado de mixer quando o default do driver estiver errado no aparelho",
  );
});

test("o S51mixer restaura só quando o aparelho declara estado", async () => {
  const { readFileSync, statSync } = await import("node:fs");
  const script = readFileSync(`${DEVICE}common/rootfs-overlay/etc/init.d/S51mixer`, "utf8");

  assert.match(script, /STATE=\/etc\/giochi\/asound\.state/);
  // Sem o arquivo tem de SAIR antes de chamar alsactl — um restore de arquivo
  // inexistente a cada boot é ruído no console, e ruído ensina a ignorar log.
  assert.match(script, /\[ -r "\$STATE" \] \|\| exit 0/);
  assert.match(script, /alsactl -f "\$STATE" restore/);
  // E não pode falhar o boot: áudio não é o canal de acesso.
  assert.ok(!/exit 1\s*\}\s*$/m.test(script.split("case")[1] ?? ""), "start não deve abortar o boot");

  const mode = statSync(`${DEVICE}common/rootfs-overlay/etc/init.d/S51mixer`).mode;
  assert.ok(mode & 0o111, "S51mixer precisa do bit de execução (§12.50)");
});

// O módulo que não existe, e a falha que não aparecia.
//
// Medido no X55 em 08/11/2026: o `S15modules` chamava `modprobe rtl_bt`, e
// `rtl_bt.ko` NÃO existe — o suporte RTL do RTL8821CS por UART é compilado
// DENTRO de `hci_uart.ko` por `CONFIG_BT_HCIUART_RTL=y`. A linha nunca podia
// funcionar, e ninguém notava porque o helper era:
//
//     modprobe "$1" 2>/dev/null && echo "  $1" || true
//
// Ou seja: o módulo que falhava apenas não aparecia na lista, e o cabeçalho
// "Carregando módulos do X55:" fazia a saída parecer sucesso. Mesma família do
// §12.15: dispositivo que existe pela metade é pior que ausente.
test("S15modules não pede módulo que não existe, e reporta o que falha", () => {
  const script = readFileSync(
    `${DEVICE}powkiddy x55/rootfs-overlay/etc/init.d/S15modules`,
    "utf8",
  );
  const codigo = script
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  assert.ok(
    !/load_module\s+rtl_bt\b/.test(codigo),
    "rtl_bt não é módulo: BT_HCIUART_RTL=y o compila dentro de hci_uart",
  );
  assert.match(codigo, /load_module hci_uart/, "hci_uart é o que carrega o BT de fato");

  // O `&& echo || true` engolia a falha. O ramo de erro tem de existir e citar
  // o módulo, senão o operador não sabe qual faltou.
  assert.ok(!/&& echo .* \|\| true/.test(codigo), "falha de modprobe não pode ser silenciosa");
  assert.match(codigo, /else/, "tem de haver ramo de erro");
  assert.match(codigo, /FALHOU/, "e a mensagem tem de dizer que falhou");

  // E o Kconfig que sustenta a correção continua no fragmento.
  const frag = readFileSync(`${DEVICE}powkiddy x55/linux.fragment`, "utf8");
  assert.match(
    frag,
    /^CONFIG_BT_HCIUART_RTL=y$/m,
    "sem BT_HCIUART_RTL=y o BT do RTL8821CS não existe em módulo nenhum",
  );
});

test("S15modules tem bit de execução no índice", () => {
  // §12.50: o rcS chama "$script start" — sem +x o serviço não sobe, o build
  // fica verde e os módulos nunca carregam.
  const mode = statSync(`${DEVICE}powkiddy x55/rootfs-overlay/etc/init.d/S15modules`).mode;
  assert.ok(mode & 0o111, "S15modules precisa de +x");
});
