import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT, DEVICE_ROOT } from "../scripts/lib/devices.mjs";

// DONGLE Wi-Fi USB — hardware FORNECIDO PELO USUÁRIO.
//
// A distinção que estes testes protegem (e que eu errei uma vez):
//
//   hardware ONBOARD ausente    -> NÃO empacote driver/firmware específico
//                                  (rtw88 do RTL8821CS fica fora do X35H)
//   hardware FORNECIDO pelo     -> empacote, porque a imagem é gravada uma vez
//   usuário (dongle, cartão SD)    e o hardware chega depois. Sem suporte
//                                  prévio, o usuário não tem saída.
//
// Eu havia tirado wpa_supplicant/iw do X35H com o argumento "sem rádio, sem
// pacote". A comunidade usa dongle. Estes testes impedem a recaída.

async function aparelhosComDefconfig() {
  const out = [];
  for (const e of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const defconfig = path.join(DEVICE_ROOT, e.name, "defconfig");
    const fragment = path.join(DEVICE_ROOT, e.name, "linux.fragment");
    let d, f;
    try {
      d = await readFile(defconfig, "utf8");
    } catch {
      continue;
    }
    try {
      f = await readFile(fragment, "utf8");
    } catch {
      f = "";
    }
    out.push({ pasta: e.name, defconfig: d, fragment: f });
  }
  return out;
}

test("todo aparelho com imagem tem os drivers de dongle Wi-Fi no kernel", async () => {
  const aparelhos = await aparelhosComDefconfig();
  assert.ok(aparelhos.length >= 2);
  for (const { pasta, fragment } of aparelhos) {
    for (const simbolo of ["CONFIG_RTL8XXXU", "CONFIG_MT7601U", "CONFIG_ATH9K_HTC"]) {
      assert.match(
        fragment,
        new RegExp(`^${simbolo}=m$`, "m"),
        `${pasta}: falta ${simbolo}=m — dongle é plugado e nada acontece`,
      );
    }
  }
});

test("RTL8188FU (o dongle mais comum) exige RTL8XXXU_UNTESTED", async () => {
  // "Untested" é não validado pelo autor do driver, não "quebrado". Sem esta
  // opção o rtl8xxxu não reconhece 8188FU — que é o dongle barato de hoje.
  const aparelhos = await aparelhosComDefconfig();
  for (const { pasta, fragment } of aparelhos) {
    assert.match(fragment, /^CONFIG_RTL8XXXU_UNTESTED=y$/m, `${pasta}: 8188FU fica de fora`);
  }
});

test("os drivers de dongle ficam =m, não =y", async () => {
  // =y engorda o kernel para hardware que pode nunca ser plugado. O carregamento
  // é por modalias quando o dongle entra, e o kmod/S15modules resolve.
  const aparelhos = await aparelhosComDefconfig();
  for (const { pasta, fragment } of aparelhos) {
    for (const simbolo of ["CONFIG_RTL8XXXU", "CONFIG_MT7601U", "CONFIG_ATH9K_HTC"]) {
      assert.doesNotMatch(
        fragment,
        new RegExp(`^${simbolo}=y$`, "m"),
        `${pasta}: ${simbolo}=y compila no kernel o que talvez nunca seja usado`,
      );
    }
  }
});

test("aparelho sem rádio onboard AINDA tem o userspace de Wi-Fi", async () => {
  // Dongle é hardware do usuário: precisa de wpa_supplicant e iw ANTES de ele
  // plugar. O rtw88 do RTL8821CS continua fora, porque esse é onboard.
  const x35h = await readFile(path.join(DEVICE_ROOT, "powkiddy x35h/defconfig"), "utf8");
  for (const simbolo of [
    "BR2_PACKAGE_WPA_SUPPLICANT",
    "BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE",
    "BR2_PACKAGE_IW",
    "BR2_PACKAGE_WIRELESS_REGDB",
  ]) {
    assert.match(x35h, new RegExp(`^${simbolo}=y$`, "m"), `falta ${simbolo} no X35H`);
  }
});

test("o rtw88 do RTL8821CS (ONBOARD) continua fora do X35H", async () => {
  // A distinção ao contrário: esse chip não existe nesta placa e não pode ser
  // plugado. Driver para ele seria código morto.
  const x35h = await readFile(path.join(DEVICE_ROOT, "powkiddy x35h/defconfig"), "utf8");
  assert.doesNotMatch(x35h, /^BR2_PACKAGE_LINUX_FIRMWARE_RTL_RTW88=y$/m);
  assert.doesNotMatch(x35h, /^BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT=y$/m);
});

test("firmware dos dongles está declarado", async () => {
  // Driver sem firmware é dongle morto com mensagem no dmesg que ninguém vê.
  const x35h = await readFile(path.join(DEVICE_ROOT, "powkiddy x35h/defconfig"), "utf8");
  assert.match(x35h, /^BR2_PACKAGE_LINUX_FIRMWARE_RTL_81XX=y$/m);
  assert.match(x35h, /^BR2_PACKAGE_LINUX_FIRMWARE_ATHEROS_9271=y$/m);

  // MT7601U não tem opção no Buildroot 2024.02 -> entra pelo override.
  const overrides = await readFile(path.join(ROOT, "config/package-overrides.mk"), "utf8");
  assert.match(overrides, /mediatek\/mt7601u\.bin/);
  assert.match(
    overrides,
    /ifeq \(\$\(BR2_PACKAGE_LINUX_FIRMWARE\),y\)\s*\nLINUX_FIRMWARE_FILES \+= mediatek\/mt7601u\.bin/,
    "o firmware do dongle tem de ser condicional a linux-firmware, não ao aparelho",
  );
});

test("o selftest reporta a porta host e os módulos de dongle", async () => {
  const texto = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-selftest"),
    "utf8",
  );
  assert.match(texto, /porta USB host disponível/);
  assert.match(texto, /módulos de dongle Wi-Fi/);
  assert.match(texto, /rtl8xxxu/);
});
