import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

function run(script) {
  return execFileSync("sh", ["-c", script], { encoding: "utf8" });
}

// O QUE O APARELHO DESMENTIU NO SELFTEST, MEDIDO NO X55 EM 08/11/2026.
//
// Três avisos apareceram num aparelho que funciona:
//
//   1. `[WARN] model "Powkiddy x55" não corresponde ao compatible` — os dois
//      dizem a MESMA coisa em convenções diferentes:
//          /model      -> "Powkiddy x55"      (espaço, maiúscula — comercial)
//          /compatible -> "powkiddy,x55 ..."  (vírgula, minúscula — DT)
//   2. `[WARN] console sem rotação (rotate=0)` — a rotação estava configurada
//      nos dois lugares (cmdline e CONFIG); o fbcon é que não tinha assumido.
//   3. `[PASS] bateria: 0%` — com `present=0`, que quer dizer "não há célula",
//      não "bateria vazia".
//
// Os três mandavam procurar no lugar errado. A regra do §12.30 vale: o teste
// tem de perguntar pela CONSEQUÊNCIA e pelo caso que ele quer distinguir.

const SELFTEST = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-selftest");
const texto = readFileSync(SELFTEST, "utf8");

test("a comparação model x compatible é normalizada", () => {
  // A função `_norm` é EXTRAÍDA do script e executada num shell de verdade.
  // Reimplementar em JS provaria só que a minha cópia funciona: se o `tr` do
  // script mudar, o teste continuaria verde enquanto o aparelho avisa.
  const linha = texto.match(/^\s*_norm\(\) \{.*\}$/m);
  assert.ok(linha, "a função _norm sumiu");
  const fn = linha[0].trim();

  const casos = [
    // (compatible, model, deveAvisar) — os três medidos em hardware.
    ["powkiddy,x55 rockchip,rk3566", "Powkiddy x55", false], // mesmo aparelho, convenções diferentes
    ["powkiddy,x35h rockchip,rk3566", "RG353M m", true], // U-Boot reescreveu /model (§12.30)
    ["gameconsole,r35s rockchip,rk3326", "Game Console R36S", true], // r35s != r36s: é aviso real
  ];
  for (const [compat, model, deveAvisar] of casos) {
    const saida = run(`${fn}
_nc=$(_norm ${JSON.stringify(compat)})
_nm=$(_norm ${JSON.stringify(model)})
case "$_nc" in *"$_nm"*) echo COMBINA ;; *) echo DIFERE ;; esac`);
    assert.equal(
      saida.trim() === "COMBINA",
      !deveAvisar,
      `${JSON.stringify(model)} em ${JSON.stringify(compat)}: esperado avisar=${deveAvisar}`,
    );
  }

  // E o código tem de usar a normalização, não comparar cru.
  assert.match(texto, /_norm "\$COMPAT"/, "a comparação tem de passar pela normalização");
  assert.match(texto, /_norm "\$MODEL"/);
});

test("bateria com present=0 não é reportada como 0%", () => {
  // `capacity=0` num aparelho sem célula é indistinguível de bateria
  // descarregada — e a ação do operador é oposta (procurar o chicote vs
  // carregar). O bloco é EXTRAÍDO do script e rodado contra um sysfs
  // sintético, porque um `assert.match` no texto passaria com `-eq` trocado
  // por `-lt`, que é justamente o erro que muda o veredito.
  const ini = texto.indexOf('BAT=""');
  assert.ok(ini > 0, "o bloco da bateria sumiu");
  const fim = texto.indexOf("\nfi", texto.indexOf("sem bateria detectada")) + 3;
  const bloco = texto.slice(ini, fim);
  assert.match(bloco, /present/, "o selftest tem de ler o atributo present");

  const rodar = (arquivos) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bat-"));
    for (const [nome, attrs] of Object.entries(arquivos)) {
      mkdirSync(path.join(dir, nome), { recursive: true });
      for (const [k, v] of Object.entries(attrs)) writeFileSync(path.join(dir, nome, k), `${v}\n`);
    }
    const script = `
read_or() { cat "$1" 2>/dev/null || true; }
pass() { echo "PASS $*"; }
warn() { echo "WARN $*"; }
${bloco.replaceAll("/sys/class/power_supply", dir)}
`;
    const saida = run(script);
    rmSync(dir, { recursive: true, force: true });
    return saida;
  };

  // Sem célula: era isto que saía como "[PASS] bateria: 0% (Discharging)".
  const ausente = rodar({
    "rk817-battery": { type: "Battery", present: 0, capacity: 0, status: "Discharging" },
  });
  assert.match(ausente, /WARN .*AUSENTE \(present=0/, `saída inesperada: ${ausente}`);
  assert.ok(!/^PASS/m.test(ausente), "bateria ausente não pode virar PASS");

  // Com célula: o caminho normal continua funcionando.
  const presente = rodar({
    "rk817-battery": { type: "Battery", present: 1, capacity: 57, status: "Charging" },
  });
  assert.match(presente, /PASS bateria: 57% \(Charging\)/, `saída inesperada: ${presente}`);

  // Sem nenhum power_supply de bateria (só o carregador USB).
  const semBateria = rodar({
    "rk817-charger": { type: "USB", online: 1 },
  });
  assert.match(semBateria, /WARN sem bateria detectada/, `saída inesperada: ${semBateria}`);
});

test("o aviso de rotação distingue fbcon ausente de rotação desligada", () => {
  // Medido no X55: com `fbcon=rotate:3` na cmdline e CONFIG_ROTATION=y, o sysfs
  // dizia `rotate=0` e o console saía 80x25 — porque o DEFERRED_TAKEOVER espera
  // alguém escrever em /dev/tty0 e o getty está na serial. O aviso antigo
  // apontava para o Kconfig, que estava certo. Depois de `echo >/dev/tty0`:
  // rotate=3 e `45 160`, provando que só faltava o gatilho.
  //
  // O bloco é EXTRAÍDO e rodado: `assert.match` no texto passaria com a decisão
  // trocada por `if false`, que é o defeito que o teste existe para pegar.
  const ini = texto.indexOf("FBCON_ROT=");
  assert.ok(ini > 0, "o bloco de rotação sumiu");
  const fim = texto.indexOf("\nfi", texto.indexOf("CONFIG_FRAMEBUFFER_CONSOLE_ROTATION desligado")) + 3;
  const bloco = texto.slice(ini, fim);
  assert.match(bloco, /FBCON_ATIVO/, "o selftest tem de olhar o vtconsole");

  const rodar = ({ vtcons, rotate, modo }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "rot-"));
    mkdirSync(path.join(dir, "vtconsole"), { recursive: true });
    vtcons.forEach((nome, i) => {
      mkdirSync(path.join(dir, "vtconsole", `vtcon${i}`), { recursive: true });
      writeFileSync(path.join(dir, "vtconsole", `vtcon${i}`, "name"), `${nome}\n`);
    });
    mkdirSync(path.join(dir, "graphics", "fb0"), { recursive: true });
    writeFileSync(path.join(dir, "graphics", "fb0", "virtual_size"), "720,1280\n");
    if (rotate !== null) {
      mkdirSync(path.join(dir, "graphics", "fbcon"), { recursive: true });
      writeFileSync(path.join(dir, "graphics", "fbcon", "rotate"), `${rotate}\n`);
    }
    mkdirSync(path.join(dir, "drm", "card0-DSI-1"), { recursive: true });
    writeFileSync(path.join(dir, "drm", "card0-DSI-1", "modes"), `${modo}\n`);

    let b = bloco
      .replaceAll("/sys/class/vtconsole", path.join(dir, "vtconsole"))
      .replaceAll("/sys/class/graphics/fb0", path.join(dir, "graphics", "fb0"))
      .replaceAll("/sys/class/graphics/fbcon", path.join(dir, "graphics", "fbcon"))
      .replaceAll("/sys/class/drm", path.join(dir, "drm"));
    const script = `
dmesg() { echo "[    1.1] Console: switching to colour frame buffer device 160x45"; }
pass() { echo "PASS $*"; }
warn() { echo "WARN $*"; }
${b}
`;
    const saida = run(script);
    rmSync(dir, { recursive: true, force: true });
    return saida;
  };

  // 1) O estado medido na X55 antes do gatilho: fbcon/rotate existe (=0), o
  //    vtconsole só tem o dummy, e o painel é retrato. A causa NÃO é o Kconfig.
  const antes = rodar({ vtcons: ["(S) dummy device"], rotate: 0, modo: "720x1280" });
  assert.match(antes, /WARN .*NÃO está na tela/, `saída inesperada: ${antes}`);
  assert.ok(!/CONFIG_FRAMEBUFFER_CONSOLE/.test(antes), "não pode culpar o Kconfig, que está certo");

  // 2) Depois do `echo >/dev/tty0`: fbcon assumiu (M) e a rotação aparece.
  const depois = rodar({
    vtcons: ["(S) dummy device", "(M) frame buffer device"],
    rotate: 3,
    modo: "720x1280",
  });
  assert.match(depois, /PASS console rotacionado \(rotate=3/, `saída inesperada: ${depois}`);

  // 3) Agora sim o Kconfig: o sysfs não existe.
  const semSysfs = rodar({ vtcons: ["(M) frame buffer device"], rotate: null, modo: "720x1280" });
  assert.match(semSysfs, /WARN .*CONFIG_FRAMEBUFFER_CONSOLE_ROTATION desligado/, `saída inesperada: ${semSysfs}`);
});

test("os utilitários do rootfs não citam dropbear como servidor ativo", () => {
  // A imagem usa OpenSSH. `pidof dropbear` no `giochi-usbnet --status` dizia
  // "dropbear NÃO está rodando" para sempre — medido no X55, onde o `sshd` está
  // no ar. Status que aponta para o servidor errado manda caçar defeito onde
  // não há.
  const usbnet = readFileSync(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-usbnet"),
    "utf8",
  );
  const executavel = usbnet
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(!/pidof dropbear/.test(executavel), "o status tem de consultar o sshd");
  assert.match(executavel, /pidof sshd/);
});

test("giochi-usb sabe responder sem usb-role-switch", () => {
  // A X55 tem `dr_mode = "otg"` no DT, nenhum `/sys/class/usb_role/*`, e o USB
  // funciona como device. O `--status` respondia "papel desconhecido: o DTS
  // tem usb-role-switch?" — mandando procurar um nó que não falta.
  const usb = readFileSync(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-usb"),
    "utf8",
  );
  assert.match(usb, /\/sys\/class\/udc/, "sem role-switch, a resposta vem do UDC");
  assert.match(usb, /fixo no DT, sem role-switch/, "e o texto tem de dizer isso");
  assert.match(usb, /--host\/--device não se aplicam/, "inclusive que não é alternável");
});
