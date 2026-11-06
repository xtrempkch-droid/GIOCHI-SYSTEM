import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do RTC, levantado pela equipe do app em 06/11/2026:
//
//   "O relógio diz 2017, sem RTC e sem rádio. Isso quebrava a licença: emitida
//    em 2026, o veredito era 'não sei julgar'... fica a pergunta: tem como o
//    R35S guardar hora?"
//
// Medido no aparelho: **tem**. `rk808-rtc`, `/dev/rtc0`, e `hwclock -w`
// sobrevive a reboot (gravei 13:30:00, li 13:31:57 depois do ciclo de energia).
//
// O que faltava era o caminho de VOLTA: `CONFIG_RTC_HCTOSYS=y` faz o kernel ler
// o RTC e acertar o relógio do sistema no boot, mas ninguém gravava a hora
// acertada de volta. O `S50hwclock` fecha isso no `stop` do `rcK`.
//
// A guarda que estes testes protegem: um relógio de 1970 gravado no RTC é PIOR
// que um relógio que se perde — o aparelho nasce em 1970 para sempre, e nenhum
// piso de tempo (nem o do catálogo assinado do app) corrige para trás.

const SCRIPT = path.join(
  ROOT,
  "device/common/rootfs-overlay/etc/init.d/S50hwclock",
);

const ler = () => readFileSync(SCRIPT, "utf8");

// Monta uma raiz falsa com `hwclock` instrumentado, para exercitar a decisão
// sem RTC de verdade. O binário falsificado grava uma linha a cada chamada, e é
// isso que os testes leem: não basta o script sair com 0, tem de GRAVAR ou NÃO.
function monta({ piso = "2026", anoFalso = null, comRtc = true }) {
  const dir = mkdtempSync(path.join(tmpdir(), "hwclock-"));
  mkdirSync(path.join(dir, "etc/giochi"), { recursive: true });
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  mkdirSync(path.join(dir, "dev"), { recursive: true });
  mkdirSync(path.join(dir, "sys/class/rtc/rtc0"), { recursive: true });

  writeFileSync(
    path.join(dir, "etc/giochi/build-info.txt"),
    `name=Giochi System\nbuilt_at_utc=${piso}-11-06T19:37:01Z\n`,
  );
  if (comRtc) writeFileSync(path.join(dir, "dev/rtc0"), "");
  writeFileSync(path.join(dir, "sys/class/rtc/rtc0/name"), "rk808-rtc\n");

  const marcas = path.join(dir, "marcas.txt");
  writeFileSync(marcas, "");
  // `date +%Y` devolve o ano pedido; `hwclock -w` registra "gravou".
  writeFileSync(
    path.join(dir, "bin/hwclock"),
    `#!/bin/sh\necho "gravou $*" >>"${marcas}"\nexit 0\n`,
  );
  chmodSync(path.join(dir, "bin/hwclock"), 0o755);

  const dateFalso = path.join(dir, "bin/date");
  if (anoFalso !== null) {
    writeFileSync(dateFalso, `#!/bin/sh\necho "${anoFalso}"\n`);
    chmodSync(dateFalso, 0o755);
  }

  // Cópia do script com os caminhos absolutos redirecionados para a raiz falsa.
  const texto = readFileSync(SCRIPT, "utf8")
    .replace(/\/etc\/giochi\/build-info\.txt/g, path.join(dir, "etc/giochi/build-info.txt"))
    .replace(/\/sys\/class\/rtc\/rtc0/g, path.join(dir, "sys/class/rtc/rtc0"))
    .replace(/\/dev\/rtc0/g, path.join(dir, "dev/rtc0"));
  const destino = path.join(dir, "S50hwclock");
  writeFileSync(destino, texto);
  chmodSync(destino, 0o755);

  return { dir, script: destino, marcas };
}

function roda(cenario, acao) {
  const env = {
    ...process.env,
    PATH: `${cenario.dir}/bin:${process.env.PATH}`,
    GIOCHI_RELOGIO_PISO_ANO: "",
  };
  // `log()` escreve em stderr de propósito (é diagnóstico, não dado). Capturar
  // só o stdout devolveria string vazia e o teste "passaria" sem testar nada —
  // exatamente o defeito que este repositório combate.
  const r = spawnSync("sh", [cenario.script, acao], { env, encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

test("o piso vem do build-info.txt da imagem, não de um número escrito à mão", () => {
  const texto = ler();
  assert.match(texto, /built_at_utc/);
  assert.match(texto, /\/etc\/giochi\/build-info\.txt/);
  // O reserva existe para o caso de o arquivo faltar; não pode ser o caminho
  // principal, senão o piso envelhece a cada ano.
  assert.match(texto, /PISO_ANO="\$\{GIOCHI_RELOGIO_PISO_ANO:-\$\(sed[^)]*built_at_utc/s);
});

test("o build grava /etc/giochi/build-info.txt no TARGET (não só em out/)", () => {
  // O `out/<device>/build-info.txt` NÃO vai para a imagem — é o erro fácil de
  // cometer aqui, e o sintoma seria o piso caindo sempre no reserva.
  const postBuild = readFileSync(path.join(ROOT, "scripts/post-build.sh"), "utf8");
  assert.match(postBuild, /\/etc\/giochi\/build-info\.txt/);
  assert.match(postBuild, /GIOCHI_BUILD_INFO_LINHAS/);
  const build = readFileSync(path.join(ROOT, "scripts/build-device.sh"), "utf8");
  assert.match(build, /GIOCHI_BUILD_INFO_LINHAS=/, "build-device tem de exportar as linhas");
  assert.match(build, /export GIOCHI_BUILD_INFO_LINHAS/);
  // Sem senha: este arquivo vai para o cartão.
  const trecho = build.slice(build.indexOf("GIOCHI_BUILD_INFO_LINHAS="), build.indexOf("export GIOCHI_BUILD_INFO_LINHAS"));
  assert.ok(!/PASSWD|password/i.test(trecho), "build-info.txt na imagem não pode levar senha");
});

test("ano anterior ao piso NÃO é gravado no RTC", () => {
  // O caso real: bateria do RTC descarregada, relógio em 1970.
  const c = monta({ piso: "2026", anoFalso: "1970" });
  try {
    const saida = roda(c, "stop");
    assert.match(saida, /NÃO grava/, `deveria recusar; saída: ${saida}`);
    assert.equal(readFileSync(c.marcas, "utf8").trim(), "", "hwclock NÃO podia ser chamado");
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("ano igual ou posterior ao piso É gravado no RTC", () => {
  const c = monta({ piso: "2026", anoFalso: "2027" });
  try {
    const saida = roda(c, "stop");
    assert.match(readFileSync(c.marcas, "utf8"), /gravou -w/, `saída: ${saida}`);
    assert.match(saida, /RTC acertado/);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("sem /dev/rtc0 não falha — desligamento não pode travar", () => {
  // A hora é o último item da lista. Um aparelho sem RTC tem de desligar.
  const c = monta({ piso: "2026", anoFalso: "2027", comRtc: false });
  try {
    const saida = roda(c, "stop");
    assert.match(saida, /sem .*rtc0, nada a gravar/);
    assert.equal(readFileSync(c.marcas, "utf8").trim(), "");
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("data ilegível não vira gravação às cegas", () => {
  // `date +%Y` vazio acontece quando o relógio está absurdo (ano negativo) ou
  // quando o busybox não tem o applet. Casar `[` com string vazia explodiria
  // com "integer expression expected" e derrubaria o rcK.
  const c = monta({ piso: "2026", anoFalso: "" });
  try {
    const saida = roda(c, "stop");
    assert.equal(readFileSync(c.marcas, "utf8").trim(), "", "não podia gravar");
    assert.match(saida, /ilegível|NÃO grava/);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("o gancho é o `stop` do rcK, e o start não grava", () => {
  // No boot o relógio acabou de vir DO RTC: gravar de volta é escrita em NVRAM
  // sem ganho. A assimetria é o desenho, não descuido.
  const texto = ler();
  assert.match(texto, /^\s*stop\)/m);
  assert.match(texto, /^\s*start\)/m);
  const c = monta({ piso: "2026", anoFalso: "2027" });
  try {
    roda(c, "start");
    assert.equal(
      readFileSync(c.marcas, "utf8").trim(),
      "",
      "`start` não pode escrever no RTC",
    );
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

// ── o aparelho tem de CONSEGUIR responder ──────────────────────────────────
//
// A pergunta do app ("tem como guardar hora?") não pode depender de SSH nem de
// ler /sys à mão: no handheld o único canal é o que está na tela. O selftest é
// o que responde, e ele já vai para o cartão.

const SELFTEST = path.join(
  ROOT,
  "device/common/rootfs-overlay/usr/bin/giochi-selftest",
);

test("o selftest reporta o relógio, e usa o MESMO piso do S50hwclock", () => {
  const texto = readFileSync(SELFTEST, "utf8");
  assert.match(texto, /\/sys\/class\/rtc\/rtc0\/name/, "tem de reportar o nome do RTC");
  // Dois pisos diferentes seria a divergência que este repositório combate:
  // um diz "ok" e o outro recusa gravar, e ninguém sabe qual acreditar.
  assert.match(texto, /built_at_utc=/, "o piso tem de vir do build-info.txt também aqui");
  // Perguntar pela HORA, não pelo nó: /dev/rtc0 presente com data de 1970 é o
  // defeito que quebra licença com prazo, e um teste de existência daria PASS.
  assert.match(texto, /relógio em \$ANO, antes de \$PISO/);
});

test("o selftest distingue 'não tem RTC' de 'ninguém acertou o relógio'", () => {
  const texto = readFileSync(SELFTEST, "utf8");
  // Sem essa distinção o operador troca o hardware errado.
  assert.match(texto, /não é falta de RTC: ninguém acertou o relógio/);
});

// ── as duas falhas que este trabalho produziu, viradas em teste ────────────
//
// As duas foram medidas no build de 06/11/2026, as duas deixaram o build
// VERDE, e as duas são da mesma família: "funcionou na minha máquina" porque
// nada perguntou pela consequência.

const INITD = path.join(ROOT, "device/common/rootfs-overlay/etc/init.d");

test("todo script de /etc/init.d do overlay é executável", () => {
  // `S50hwclock` foi criado como 0644 e chegou assim ao `target/`: o `rcK`
  // chama `$script stop`, recebe `Permission denied`, e o RTC nunca é gravado.
  // O sintoma ("a hora não guarda") não aponta para modo de arquivo.
  //
  // O `post-build.sh` agora falha o build nisso, mas descobrir num build de
  // 40 min é caro: este teste pega em 10 ms, antes do commit.
  const scripts = readdirSync(INITD).filter((n) => /^S\d\d/.test(n));
  assert.ok(scripts.length > 0, "nenhum script de init encontrado");
  const semExec = scripts.filter((n) => {
    const m = statSync(path.join(INITD, n)).mode;
    return (m & 0o111) === 0;
  });
  assert.deepEqual(semExec, [], `sem bit +x: ${semExec.join(", ")}`);
});

test("o bloco do build-info vem ANTES do `exit 0` do inittab", () => {
  // Medido: o bloco ficou no fim do arquivo e não rodou em build RETOMADO —
  // o bloco do inittab sai com `exit 0` quando a linha já está lá, e tudo
  // depois dele é código morto. `/etc/giochi/build-info.txt` não apareceu na
  // imagem e o log não disse nada, porque o `echo` também nunca rodou.
  const texto = readFileSync(path.join(ROOT, "scripts/post-build.sh"), "utf8");
  const posBuildInfo = texto.indexOf("/etc/giochi/build-info.txt");
  const posExit = texto.indexOf('echo "post-build: inittab já chama giochi-init"');
  assert.ok(posBuildInfo > 0, "o bloco do build-info.txt sumiu");
  assert.ok(posExit > 0, "o early-exit do inittab sumiu (mudou de forma?)");
  assert.ok(
    posBuildInfo < posExit,
    "build-info.txt voltou para depois do `exit 0`: em build retomado ele não roda",
  );
});
