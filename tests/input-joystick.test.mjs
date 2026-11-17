#!/usr/bin/env node
// Um handheld precisa de `/dev/input/js0`.
//
// Medido no R35S em 17/11/2026, no aparelho ligado, com a imagem `58510df`:
//
//   $ awk '/^N: Name=/{n=$0} /^H: Handlers=/{print n " -> " $0}' /proc/bus/input/devices
//   rk817_int Headphones -> event0
//   gpio-keys-vol -> kbd event1            <- teclado, e é legítimo (volume)
//   r36s_Gamepad -> event2                 <- gamepad SEM `js0`
//
//   $ ls /dev/input/mouse* ; echo $?
//   nenhum                                 <- o kernel não criou ponteiro
//   $ cat /sys/class/input/event2/device/capabilities/rel
//   0                                      <- nenhum eixo relativo
//
// Ou seja: o kernel NÃO trata os botões como teclado nem gera mouse. O que
// faltava era outra coisa — o `CONFIG_INPUT_JOYDEV`, que o defconfig arm64 deixa
// desligado em todos os três aparelhos.
//
// Por que isso importa, se o `evdev` funciona:
//
//   * `INPUT_EVDEV` entrega os EVENTOS. É dele que saem `/dev/input/event*`, e é
//     o que o `giochi-buttons` e o `giochi-selftest` leem.
//   * `INPUT_JOYDEV` dá a IDENTIDADE. `/dev/input/js0` existir é o kernel
//     afirmando "isto é um joystick" — no `H: Handlers=` e no nome do node.
//
// Sem o segundo, o controle é um fluxo de eventos indistinguível de teclado para
// qualquer programa que não leia capabilities. Nenhum dos dois substitui o outro.
//
// A invariante: **quem tem driver de joystick tem joystick no userspace.**

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const PASTA = path.join(ROOT, "device");

/** Aparelhos cujo fragmento de kernel declara algum driver de joystick. */
function aparelhosComJoystick() {
  const resultado = [];
  for (const device of readdirSync(PASTA)) {
    let fragmento;
    try {
      fragmento = readFileSync(path.join(PASTA, device, "linux.fragment"), "utf8");
    } catch {
      continue;
    }
    if (!/^CONFIG_JOYSTICK_[A-Z0-9_]+=y$/m.test(fragmento)) continue;
    resultado.push({ device, fragmento });
  }
  return resultado;
}

test("todo aparelho com driver de joystick liga o JOYDEV", () => {
  // Invariante, não lista: o §12.50 já mostrou duas vezes que cobertura por caso
  // num defeito de classe deixa o próximo aparelho de fora. O R35S entrou na
  // matriz em 15/11 e herdou um `defconfig` sem `JOYDEV`; a X55 e a X35H também.
  const comJoystick = aparelhosComJoystick();
  assert.ok(
    comJoystick.length >= 3,
    `esperava os três aparelhos com joystick, achei ${comJoystick.length}`,
  );

  for (const { device, fragmento } of comJoystick) {
    assert.match(
      fragmento,
      /^CONFIG_INPUT_JOYDEV=y$/m,
      `${device}: tem driver de joystick e não liga CONFIG_INPUT_JOYDEV — ` +
        `sem ele não existe /dev/input/js0, e o kernel não rotula o controle ` +
        `como joystick em /proc/bus/input/devices (medido no R35S em 17/11/2026)`,
    );
  }
});

test("o JOYDEV também está na lista do que o aparelho PRECISA ter", () => {
  // O fragmento é delta; a `kernel-required.txt` é o contrato mínimo. Se o
  // defconfig arm64 mudar, o símbolo some sem uma linha de erro e o
  // `assert-kernel-config` só pega se ele estiver na lista.
  for (const { device } of aparelhosComJoystick()) {
    const required = readFileSync(path.join(PASTA, device, "kernel-required.txt"), "utf8");
    assert.match(
      required,
      /^CONFIG_INPUT_JOYDEV=y$/m,
      `${device}: CONFIG_INPUT_JOYDEV fora da kernel-required.txt`,
    );
  }
});

test("nenhum aparelho troca o EVDEV pelo JOYDEV", () => {
  // São complementares. Desligar o EVDEV para "resolver" o teclado tiraria
  // `/dev/input/event*` — e com ele o `giochi-buttons`, o `giochi-selftest` e o
  // próprio launcher, que lê evdev cru.
  for (const { device, fragmento } of aparelhosComJoystick()) {
    assert.match(
      fragmento,
      /^CONFIG_INPUT_EVDEV=y$/m,
      `${device}: o EVDEV continua obrigatório — o JOYDEV não o substitui`,
    );
  }
});

test("os códigos de botão do DTS do R35S são de gamepad, não de teclado", () => {
  // A medição que descarta a hipótese "o sistema trata os botões como teclado":
  // o DTS mapeia 17 BTN_* e só KEY_VOLUMEUP/DOWN. Se algum botão de jogo virasse
  // KEY_*, aí sim o kernel o classificaria como teclado.
  const patch = readFileSync(
    path.join(PASTA, "r35s", "patches", "0001-giochi-system-r35s-dts-e-painel.patch"),
    "utf8",
  );
  const codigos = [...patch.matchAll(/linux,code = <([A-Z0-9_]+)>/g)].map((m) => m[1]);
  assert.ok(codigos.length >= 17, `esperava >= 17 botões, achei ${codigos.length}`);

  const doGamepad = codigos.filter((c) => c.startsWith("BTN_"));
  const doTeclado = codigos.filter((c) => c.startsWith("KEY_"));
  assert.ok(doGamepad.length >= 15, `só ${doGamepad.length} BTN_* — o DTS virou teclado?`);
  assert.deepEqual(
    doTeclado.sort(),
    ["KEY_VOLUMEDOWN", "KEY_VOLUMEUP"],
    "as únicas teclas do DTS têm de ser as de volume — qualquer outra vira teclado",
  );

  // E nenhum código de ponteiro: um BTN_LEFT aqui faria o kernel classificar o
  // device como mouse, e o cursor na tela passaria a ter causa no DTS.
  for (const proibido of ["BTN_LEFT", "BTN_RIGHT", "BTN_MIDDLE", "BTN_MOUSE", "BTN_TOUCH"]) {
    assert.ok(
      !codigos.includes(proibido),
      `${proibido} no DTS faria o kernel tratar o controle como ponteiro`,
    );
  }
});
