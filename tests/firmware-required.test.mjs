import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, lstat, readlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Regressão de um bug real: o pacote linux-firmware NÃO instala o rádio do X55
// sozinho — `BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT` só pega `rtl_bt/rtl88*.bin`.
// O acréscimo vive em config/package-overrides.mk.
//
// E ele deixou de ser "acrescente os dois nomes": o linux-firmware de-duplicou
// `rtl8821cs_config.bin` num LINK para `rtl8761b_config.bin`, e o tarball de
// release não carrega links. Pedir aquele nome ao tar mata o build em
// linux-firmware, ~1 h depois de começar (CI de 14/11/2026):
//
//   tar: rtl_bt/rtl8821cs_config.bin: Cannot stat: No such file or directory

async function readOverrides() {
  return readFile(path.join(ROOT, "config/package-overrides.mk"), "utf8");
}

test("package-overrides.mk pede o fw do 8821CS e o config pelo nome que EXISTE no tarball", async () => {
  const text = await readOverrides();
  for (const file of ["rtl8821cs_fw.bin", "rtl8761b_config.bin"]) {
    assert.ok(
      text.includes(file),
      `package-overrides.mk não menciona ${file}: sem ele o rádio não funciona`,
    );
  }
});

test("nenhuma linha de LINUX_FIRMWARE_FILES pede rtl8821cs_config.bin", async () => {
  // Este é o defeito que quebrou o build de release: o nome existe no WHENCE
  // como LINK, não como arquivo no tarball. O tar falha com "Cannot stat", e a
  // mensagem não diz que o arquivo foi transformado em link.
  const text = await readOverrides();
  const linhas = text
    .split("\n")
    .filter((linha) => /^LINUX_FIRMWARE_FILES\s*\+=/.test(linha));
  assert.ok(linhas.length > 0, "o override precisa acrescentar algum firmware");
  for (const linha of linhas) {
    assert.ok(
      !linha.includes("rtl8821cs_config.bin"),
      `LINUX_FIRMWARE_FILES pede um nome que o tarball não tem como arquivo: ${linha}`,
    );
  }
});

test("o nome que o driver pede é criado por hook do pacote, não por mágica", async () => {
  const text = await readOverrides();
  assert.match(
    text,
    /^define GIOCHI_RTL8821CS_CONFIG_ALIAS$/m,
    "falta o hook que cria rtl8821cs_config.bin",
  );
  assert.match(
    text,
    /^LINUX_FIRMWARE_POST_INSTALL_TARGET_HOOKS \+= GIOCHI_RTL8821CS_CONFIG_ALIAS$/m,
    "o hook existe mas não foi pendurado no pacote linux-firmware",
  );
  assert.match(
    text,
    /ln -sf rtl8761b_config\.bin [^\n]*rtl8821cs_config\.bin/,
    "o hook precisa ligar rtl8821cs_config.bin ao arquivo oficial",
  );
});

// Comportamental, não textual: um `+=` numa variável dá para ler no arquivo,
// mas um hook que não roda, roda fora de ordem ou cria link pendurado só
// aparece executando. `make` não existe em toda máquina de desenvolvimento
// (Windows), então o teste se declara skip em vez de reprovar o ambiente.
function makeDisponivel() {
  return spawnSync("make", ["--version"], { encoding: "utf8" }).status === 0;
}

async function montarTree() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "giochi-fw-"));
  const rtlBt = path.join(dir, "target/lib/firmware/rtl_bt");
  await mkdir(rtlBt, { recursive: true });
  await writeFile(
    path.join(dir, "Makefile"),
    [
      "BR2_PACKAGE_LINUX_FIRMWARE := y",
      "BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT := y",
      "BR2_PACKAGE_PSPLASH_IMAGE :=",
      `TARGET_DIR := ${path.join(dir, "target")}`,
      `include ${path.join(ROOT, "config/package-overrides.mk")}`,
      "",
      ".PHONY: vars hooks",
      "vars:",
      "\t@echo \"FILES=[$(LINUX_FIRMWARE_FILES)]\"",
      "\t@echo \"HOOKS=[$(LINUX_FIRMWARE_POST_INSTALL_TARGET_HOOKS)]\"",
      "hooks:",
      "\t$(call GIOCHI_RTL8821CS_CONFIG_ALIAS)",
      "",
    ].join("\n"),
  );
  return { dir, rtlBt };
}

test("com make: o hook cria o link e falha alto quando o alvo não chegou", async (t) => {
  if (!makeDisponivel()) {
    t.skip("make não está disponível nesta máquina");
    return;
  }
  const { dir, rtlBt } = await montarTree();
  try {
    const vars = spawnSync("make", ["-s", "-C", dir, "vars"], { encoding: "utf8" });
    assert.equal(vars.status, 0, vars.stderr);
    assert.match(vars.stdout, /FILES=\[[^\]]*rtl_bt\/rtl8761b_config\.bin[^\]]*\]/);
    assert.match(vars.stdout, /HOOKS=\[GIOCHI_RTL8821CS_CONFIG_ALIAS\]/);

    // Sem o arquivo oficial o build TEM de parar: um link pendurado passa por
    // `ls` e falha no request_firmware, que é o defeito silencioso do §12.15.
    const semAlvo = spawnSync("make", ["-C", dir, "hooks"], { encoding: "utf8" });
    assert.notEqual(semAlvo.status, 0, "o hook aceitou instalar link pendurado");
    assert.match(semAlvo.stderr, /rtl8761b_config\.bin/);

    // Com o arquivo, o link é relativo e resolve dentro de /lib/firmware/rtl_bt.
    await writeFile(path.join(rtlBt, "rtl8761b_config.bin"), "config\n");
    const comAlvo = spawnSync("make", ["-C", dir, "hooks"], { encoding: "utf8" });
    assert.equal(comAlvo.status, 0, comAlvo.stderr);
    const link = path.join(rtlBt, "rtl8821cs_config.bin");
    assert.ok((await lstat(link)).isSymbolicLink(), "não criou link simbólico");
    assert.equal(await readlink(link), "rtl8761b_config.bin");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o acréscimo usa LINUX_FIRMWARE_FILES, que é a variável do pacote", async () => {
  const text = await readOverrides();
  assert.match(text, /^LINUX_FIRMWARE_FILES \+= [^\n]*rtl8821cs_fw\.bin/m);
});

test("o acréscimo e o hook são condicionais ao pacote do rádio existir no aparelho", async () => {
  // O override vale para TODOS os aparelhos. A X35H não tem o RTL8821CS e o
  // defconfig dela desliga BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT de propósito:
  // um `+=` incondicional punha os blobs no rootfs dela mesmo assim, firmware
  // para um chip ausente, contradizendo o próprio defconfig.
  const text = await readOverrides();
  assert.match(text, /^ifeq \(\$\(BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT\),y\)$/m);
  assert.match(text, /^endif$/m);
  const inicio = text.search(/^ifeq \(\$\(BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT\),y\)$/m);
  const fim = text.indexOf("\nendif", inicio);
  const bloco = text.slice(inicio, fim);
  assert.ok(bloco.includes("GIOCHI_RTL8821CS_CONFIG_ALIAS"), "o hook ficou fora do ifeq");
});

test("o X55 declara os firmwares obrigatórios do rádio", async () => {
  const required = await readFile(
    path.join(ROOT, "device/powkiddy x55/firmware-required.txt"),
    "utf8",
  );
  for (const file of [
    "rtw88/rtw8821c_fw.bin",
    "rtl_bt/rtl8821cs_fw.bin",
    "rtl_bt/rtl8761b_config.bin",
    "rtl_bt/rtl8821cs_config.bin",
  ]) {
    assert.ok(required.includes(file), `firmware-required.txt não lista ${file}`);
  }
});

test("firmware-required.txt não usa caminho absoluto nem ..", async () => {
  const required = await readFile(
    path.join(ROOT, "device/powkiddy x55/firmware-required.txt"),
    "utf8",
  );
  for (const raw of required.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    assert.ok(!line.startsWith("/"), `caminho absoluto: ${line}`);
    assert.ok(!line.includes(".."), `caminho com ..: ${line}`);
  }
});

test("main.conf do bluetooth liga o rádio no boot", async () => {
  const conf = await readFile(
    path.join(ROOT, "device/powkiddy x55/rootfs-overlay/etc/bluetooth/main.conf"),
    "utf8",
  );
  // Sem AutoEnable o controlador fica "Powered: no" e parece defeito.
  assert.match(conf, /^\[Policy\]$/m);
  assert.match(conf, /^AutoEnable\s*=\s*true$/m);
});
