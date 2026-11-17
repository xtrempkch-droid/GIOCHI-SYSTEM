#!/usr/bin/env node
// "O sistema trata os botões como teclado?" — o teste da ferramenta que responde.
//
// Em 17/11/2026 a suspeita foi: no R35S os botões viram teclado e aparece um
// cursor de mouse na tela. As duas fontes que havia não fechavam a pergunta:
//
//   * o DTS mapeia tudo para `BTN_*` — 17 códigos de gamepad e só
//     `KEY_VOLUMEUP`/`KEY_VOLUMEDOWN` para as teclas de volume. Correto.
//   * o kernel não tem `CONFIG_INPUT_MOUSEDEV` nem `CONFIG_INPUT_UINPUT`, então
//     não existe `/dev/input/mouse*` e nenhum processo cria ponteiro virtual.
//
// Nenhuma das duas responde "como o kernel classificou o dispositivo". Quem
// responde é a linha `H: Handlers=` de `/proc/bus/input/devices`, que o PRÓPRIO
// kernel escreve. `scripts/input-diag.sh` lê essa linha e classifica.
//
// Este teste prende a classificação, porque ela é a única coisa que o script
// afirma. Um erro aqui manda a investigação para o lado errado — que é o que
// este repositório registrou cinco vezes como o pior tipo de defeito.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const SCRIPT = path.join(ROOT, "scripts", "input-diag.sh");

/// Um `/proc/bus/input/devices` sintético, no formato real do kernel.
///
/// Os quatro casos são os que existem num handheld: o gamepad (que é o que se
/// quer), o teclado de volume (que existe e é legítimo), um ponteiro (que NÃO
/// deve existir) e um dispositivo sem handler de classe (acelerômetro, etc.).
const DEVICES = `I: Bus=0019 Vendor=0001 Product=0001 Version=0100
N: Name="gpio-keys-vol"
P: Phys=gpio-keys/input0
S: Sysfs=/devices/platform/gpio-keys/input/input1
U: Uniq=
H: Handlers=kbd event1
B: PROP=0

I: Bus=0019 Vendor=0001 Product=0001 Version=0100
N: Name="r36s_Gamepad"
P: Phys=odroidgo3-joypad/input0
S: Sysfs=/devices/platform/odroidgo3-joypad/input/input2
U: Uniq=
H: Handlers=js0 event2
B: PROP=0

I: Bus=0003 Vendor=046d Product=c077 Version=0111
N: Name="USB OPTICAL MOUSE "
P: Phys=usb-0000:00:14.0-1/input0
S: Sysfs=/devices/pci0000:00/input/input3
U: Uniq=
H: Handlers=mouse0 event3
B: PROP=0

I: Bus=0019 Vendor=0000 Product=0000 Version=0000
N: Name="rk805-pwrkey"
P: Phys=
S: Sysfs=/devices/platform/rk805-pwrkey/input/input0
U: Uniq=
H: Handlers=event0
B: PROP=0
`;

function roda(conteudo) {
  const raiz = mkdtempSync(path.join(tmpdir(), "giochi-input-"));
  const arquivo = path.join(raiz, "devices");
  writeFileSync(arquivo, conteudo);
  try {
    return execFileSync("bash", [SCRIPT, "--local"], {
      env: { ...process.env, GIOCHI_DEVICES_FILE: arquivo, PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

test("o gamepad é classificado como joystick, e o teclado de volume como teclado", () => {
  // Se os dois saírem iguais, a ferramenta não distingue o que existe do que é
  // defeito — e um handheld TEM os dois dispositivos ao mesmo tempo.
  const saida = roda(DEVICES);
  const veredito = saida.slice(saida.indexOf("=== veredito por dispositivo"));

  assert.match(
    veredito,
    /r36s_Gamepad\s+joystick/,
    "o gamepad tem de sair como joystick (H: js0 event2)",
  );
  assert.match(
    veredito,
    /gpio-keys-vol\s+TECLADO/,
    "o gpio-keys-vol tem de sair como teclado — ele É um teclado (KEY_VOLUME*)",
  );
});

test("um dispositivo com mouse0 é apontado como PONTEIRO", () => {
  // É o que o teste tem de gritar: se aparecer `mouse0` num handheld sem
  // touchpad, o kernel criou um ponteiro e a investigação vai para o lado dele.
  const saida = roda(DEVICES);
  assert.match(
    saida,
    /USB OPTICAL MOUSE\s+PONTEIRO/,
    "device com Handlers=mouse0 tem de sair como PONTEIRO",
  );
});

test("dispositivo sem handler de classe não é chutado", () => {
  // `Handlers=event0` sozinho não diz nada. Classificar como "joystick" seria
  // inventar; o `?` obriga a olhar as capabilities.
  const saida = roda(DEVICES);
  assert.match(
    saida,
    /rk805-pwrkey\s+\?/,
    "sem js/kbd/mouse, a classe é desconhecida — não se adivinha",
  );
});

test("a ferramenta também lista a classe bruta, para conferência", () => {
  // O veredito é derivado; a linha original fica ao lado para que o operador
  // possa discordar da classificação vendo o dado cru.
  const saida = roda(DEVICES);
  assert.match(saida, /r36s_Gamepad -> js0 event2/, "a lista crua tem de aparecer");
  assert.match(saida, /gpio-keys-vol -> kbd event1/, "a lista crua tem de aparecer");
});

test("um handheld limpo não mostra nenhum ponteiro", () => {
  // O controle negativo do teste: o mesmo script, sem o mouse na entrada, não
  // pode produzir a palavra PONTEIRO. Sem isto, uma classificação que sempre
  // acusa mouse passaria nos três testes acima.
  const semMouse = DEVICES.split("\n\n")
    .filter((bloco) => !bloco.includes("OPTICAL MOUSE"))
    .join("\n\n");
  const saida = roda(semMouse);
  const veredito = saida.slice(saida.indexOf("=== veredito por dispositivo"));
  assert.doesNotMatch(
    veredito,
    /PONTEIRO/,
    "sem mouse0 na entrada, o veredito não pode acusar ponteiro",
  );
});

test("o script não usa ps nem fatia --help por número de linha", () => {
  // Duas regras do projeto que já custaram sessão: `ps` desta imagem mostra só a
  // própria TTY (§12.46) e `sed -n '2,20p'` na ajuda já vazou prosa (§12.60).
  const texto = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(texto, /^\s*ps(\s|$)/m, "a ferramenta não pode usar ps (§12.46)");
  assert.match(texto, /giochi-system:help:begin/, "a ajuda tem de usar sentinelas");
  assert.match(texto, /giochi-system:help:end/, "a ajuda tem de usar sentinelas");
});
