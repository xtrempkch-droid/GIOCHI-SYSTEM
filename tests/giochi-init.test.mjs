import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do `giochi-init` que o time do app levantou em 04/11/2026 (canal,
// mensagem das 20:10, itens 3, 4 e 5). Três defeitos reais, cada um com a
// mesma assinatura: o sistema não faz nada de errado *visivelmente*, e o
// sintoma aparece longe da causa.
//
//   1. `/user` não existe na imagem, e o init declara `GIOCHI_CONFIG_DIR` lá.
//      O app ficava sem onde gravar estado.
//   2. o sinalizador de setup era apagado mesmo quando o configurador FALHAVA,
//      deixando o usuário sem mapa e sem segunda chance.
//   3. o cabeçalho dizia `exec`; o launcher faz `fork`+`wait`. A premissa errada
//      muda o que `RESTART_MAX` significa.
//
// Os testes abaixo executam o script de verdade num diretório temporário — não
// só leem o texto. Ler o texto não pega off-by-one nem código de saída.

const INIT = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-init");
const execFileAsync = promisify(execFile);

async function montaRaiz({ comLauncher = true, saidaLauncher = 0, comConfigurador = false,
                           saidaConfigurador = 0, comFlag = false, corpoLauncher = null } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-init-"));
  const bin = path.join(dir, "opt/giochi/apps");
  await mkdir(path.join(bin, "launcher/bin"), { recursive: true });
  await mkdir(path.join(bin, "controllers/bin"), { recursive: true });
  await mkdir(path.join(dir, ".config/giochi"), { recursive: true });

  if (comLauncher) {
    const p = path.join(bin, "launcher/bin/giochi-launcher");
    await writeFile(p, corpoLauncher ?? `#!/bin/sh\nexit ${saidaLauncher}\n`);
    await chmod(p, 0o755);
  }
  if (comConfigurador) {
    const p = path.join(bin, "controllers/bin/giochi-controllers");
    await writeFile(p, `#!/bin/sh\nexit ${saidaConfigurador}\n`);
    await chmod(p, 0o755);
  }
  if (comFlag) {
    await writeFile(path.join(dir, ".config/giochi/controller-setup"), "");
  }
  return dir;
}

async function roda(dir, timeoutMs = 4000, extraEnv = {}) {
  const env = {
    ...process.env,
    GIOCHI_LAUNCHER: path.join(dir, "opt/giochi/apps/launcher/bin/giochi-launcher"),
    GIOCHI_CONTROLLERS: path.join(dir, "opt/giochi/apps/controllers/bin/giochi-controllers"),
    GIOCHI_CONFIG_DIR: path.join(dir, ".config/giochi"),
    GIOCHI_LAUNCHER_WAIT: "1",
    GIOCHI_PARADA_FILE: path.join(dir, "run/giochi/launcher-parado"),
    ...extraEnv,
  };
  try {
    const { stderr } = await execFileAsync("sh", [INIT], { env, timeout: timeoutMs });
    return stderr;
  } catch (error) {
    // timeout mata o processo; o stderr ate ali e o que interessa
    return error.stderr ?? "";
  }
}

const existe = async (p) => {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
};

test("o init cria o diretório de configuração, que a imagem não tem", async () => {
  // Medido no rootfs.ext4 de 04/11: `/user` não existia. O launcher grava
  // brilho, volume e rotação ali, então sem o diretório ele fica sem estado.
  const dir = await montaRaiz({ comLauncher: true });
  const config = path.join(dir, ".config/giochi");
  await rm(config, { recursive: true, force: true });

  const stderr = await roda(dir);
  assert.match(stderr, /diretório de configuração pronto/);
  // `stat`, nao `readFile`: ler um diretorio falha com EISDIR.
  const criado = await stat(config).then(
    (info) => info.isDirectory(),
    () => false,
  );
  assert.ok(criado, `${config} deveria existir como diretório`);
  await rm(dir, { recursive: true, force: true });
});

test("com configurador FALHANDO, o sinalizador sobrevive", async () => {
  // Era o bug: `rm -f` incondicional. Num aparelho sem SSH, apagar o pedido de
  // socorro deixa o usuário com o mapa errado e sem como pedir de novo.
  const dir = await montaRaiz({
    comConfigurador: true,
    saidaConfigurador: 1,
    comFlag: true,
  });
  await roda(dir);
  assert.ok(
    await existe(path.join(dir, ".config/giochi/controller-setup")),
    "o sinalizador tem de permanecer para nova tentativa",
  );
  await rm(dir, { recursive: true, force: true });
});

test("com configurador OK, o sinalizador é removido", async () => {
  const dir = await montaRaiz({
    comConfigurador: true,
    saidaConfigurador: 0,
    comFlag: true,
  });
  await roda(dir);
  assert.ok(
    !(await existe(path.join(dir, ".config/giochi/controller-setup"))),
    "sucesso apaga o sinalizador",
  );
  await rm(dir, { recursive: true, force: true });
});

test("RESTART_MAX=5 significa cinco tentativas, não seis", async () => {
  // Medido antes da correção: o log dizia "reinício 6 de 5", porque a contagem
  // era incrementada e só então comparada com `-gt`.
  //
  // A janela é fixada em 1 h (`GIOCHI_RESTART_WINDOW`): com os 60 s de fábrica a
  // contagem depende do relógio da máquina, e o teste ficou intermitente no CI
  // (passou num run e deu "esperado 5, veio 9" em outro, mesmo commit). Com a
  // janela fora de alcance, a ÚNICA coisa que pode zerar `restarts` é a própria
  // cota — que é o que este teste existe para medir.
  const dir = await montaRaiz({ comLauncher: true, saidaLauncher: 7 });
  const stderr = await roda(dir, 12000, { GIOCHI_RESTART_WINDOW: "3600" });
  const tentativas = (stderr.match(/launcher saiu com 7/g) ?? []).length;
  assert.equal(
    tentativas,
    5,
    `esperado 5 tentativas, veio ${tentativas}\n--- stderr capturado ---\n${stderr}`,
  );
  assert.match(stderr, /já caiu 5 vezes/);
  await rm(dir, { recursive: true, force: true });
});

test("uptime ilegível NÃO zera a cota: a tela não volta a piscar", async () => {
  // Medido no CI em 08/11/2026: o mesmo commit passou num run e falhou no outro
  // com "esperado 5 tentativas, veio 9". A causa não era a cota — era a leitura
  // do uptime. Com `now` vazio valendo 0, na volta seguinte `now - 0` passava de
  // 60 s, a janela reiniciava e a cota de 5 era derrotada. No aparelho isso é a
  // tela piscando para sempre, que é o que a cota existe para impedir.
  const dir = await montaRaiz({ comLauncher: true, saidaLauncher: 7 });
  const vazio = path.join(dir, "uptime-vazio");
  await writeFile(vazio, "");
  const stderr = await roda(dir, 12000, {
    GIOCHI_UPTIME_FILE: vazio,
    GIOCHI_RESTART_WINDOW: "1",
  });
  const tentativas = (stderr.match(/launcher saiu com 7/g) ?? []).length;
  assert.equal(tentativas, 5, `uptime ilegível não pode zerar a cota, veio ${tentativas}`);
  await rm(dir, { recursive: true, force: true });
});

test("um salto real de uptime ZERA a cota, de propósito", async () => {
  // O outro lado: a janela existe para "se passou tempo suficiente desde a
  // primeira falha, comece a contar de novo". Saltar de 100 para 10 000 tem de
  // zerar — senão a cota puniria quedas espaçadas por horas.
  const dir = await montaRaiz({ comLauncher: true, saidaLauncher: 7 });
  const relogio = path.join(dir, "uptime");
  await writeFile(relogio, "00100.00 00099.00\n");
  // O launcher move o relógio a cada queda: 100 -> 10000 (bem além da janela).
  const corpo = `#!/bin/sh
echo "10000.00 00099.00" > ${relogio}
exit 7
`;
  await writeFile(
    path.join(dir, "opt/giochi/apps/launcher/bin/giochi-launcher"),
    corpo,
  );
  const stderr = await roda(dir, 9000, {
    GIOCHI_UPTIME_FILE: relogio,
    GIOCHI_RESTART_WINDOW: "60",
  });
  const tentativas = (stderr.match(/launcher saiu com 7/g) ?? []).length;
  assert.ok(tentativas > 5, `o salto deveria zerar a cota, mas parou em ${tentativas}`);
  assert.match(stderr, /queda 1 de 5/);
  await rm(dir, { recursive: true, force: true });
});

// ── encerramento deliberado (relato da equipe do app, 06/11/2026) ──────────
//
// Medido no R35S: cada `verificar` da ferramenta deles derruba o launcher uma
// vez (o KMSDRM é exclusivo; não há como ler o framebuffer com ele vivo). Em
// duas horas de bancada as cinco quedas da cota se esgotaram e o `giochi-init`
// parou de reiniciar — a tela ficou parada, sem erro visível.
//
// A cota existe para o DEFEITO; a ferramenta de diagnóstico não pode consumi-la.

test("SIGTERM no launcher ZERA a cota em vez de consumi-la", async () => {
  // Mata a si mesmo com SIGTERM: é o que acontece quando o app derruba o
  // launcher para capturar o quadro. O shell devolve 143 (128+15).
  const dir = await montaRaiz({
    corpoLauncher: "#!/bin/sh\nkill -TERM $$\nsleep 1\n",
  });
  const stderr = await roda(dir, 8000);
  assert.match(stderr, /encerramento deliberado/, "não reconheceu a morte por SIGTERM");
  // Nenhuma linha pode chamar isso de queda; se chamar, a cota é consumida.
  assert.doesNotMatch(stderr, /queda \d+ de 5/);
  assert.doesNotMatch(stderr, /já caiu 5 vezes/);
  await rm(dir, { recursive: true, force: true });
});

test("exit 0 do launcher é saída normal, não queda", async () => {
  const dir = await montaRaiz({ saidaLauncher: 0 });
  const stderr = await roda(dir, 4000);
  assert.match(stderr, /encerramento deliberado/);
  assert.doesNotMatch(stderr, /já caiu 5 vezes/);
  await rm(dir, { recursive: true, force: true });
});

test("crash de verdade CONTINUA consumindo a cota", async () => {
  // O espelho do teste acima: afrouxar a proteção contra laço de crash seria
  // trocar um problema visível por um pior. Segfault = 139.
  const dir = await montaRaiz({ saidaLauncher: 139 });
  const stderr = await roda(dir, 12000);
  assert.match(stderr, /já caiu 5 vezes/, "crash deixou de consumir a cota");
  assert.doesNotMatch(stderr, /encerramento deliberado/);
  assert.equal((stderr.match(/launcher saiu com 139/g) ?? []).length, 5);
  await rm(dir, { recursive: true, force: true });
});

test("a desistência deixa rastro em arquivo, não só no console", async () => {
  // "Tela parada" num handheld é indistinguível de "não ligou". A equipe do app
  // pediu explicitamente um lugar visível; o console serial não é visível para
  // quem só tem o aparelho na mão.
  const dir = await montaRaiz({ saidaLauncher: 7 });
  await roda(dir, 12000);
  const marca = path.join(dir, "run/giochi/launcher-parado");
  const texto = await readFile(marca, "utf8");
  assert.match(texto, /^motivo=quedas_repetidas$/m);
  assert.match(texto, /^quedas=5$/m);
  assert.match(texto, /^ultimo_status=7$/m);
  assert.match(texto, /^launcher=\/.*giochi-launcher$/m);
  await rm(dir, { recursive: true, force: true });
});

test("o cabeçalho descreve fork+wait, não exec", async () => {  // A premissa errada é perigosa: com `exec`, `RESTART_MAX` contaria o fim
  // normal de cada jogo; com `fork`+`wait`, toda saída é anormal. Um watchdog
  // escrito sobre a premissa errada mata launcher saudável no meio da partida.
  const texto = await readFile(INIT, "utf8");
  // O cabecalho usa markdown no meio da frase: "**não** faz `exec`" e
  // "`fork` + `wait`". O regex tolera asteriscos e crases entre as palavras.
  assert.match(texto, /fork`?\s*\+\s*`?wait/i);
  assert.match(texto, /n[ãa]o\*?\*? faz `exec`/i);
  assert.match(texto, /toda saída do launcher vista aqui é anormal/i);
  // O diagrama antigo (exec) não pode voltar.
  assert.doesNotMatch(texto, /launcher ──exec──▶ jogo/);
});

test("o contrato do giochi-controllers está escrito", async () => {
  // O binário é do app; sem o contrato escrito, cada lado implementa uma
  // leitura e a divergência aparece só no aparelho.
  const texto = await readFile(INIT, "utf8");
  assert.match(texto, /argv\s+nenhum/);
  assert.match(texto, /saída 0/);
  assert.match(texto, /saída ≠0|saída diferente/);
});
