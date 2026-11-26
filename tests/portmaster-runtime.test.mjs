import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do RUNTIME do PortMaster na imagem (config/portmaster.fragment).
//
// A avaliação (`docs/evaluacao-portmaster.md`) responde "dá para pôr?" e "quanto
// custa". Este arquivo prende a parte que, se mudar sem ninguém notar, produz
// imagem que parece certa e GUI que não abre — que é o padrão deste repositório
// desde o §12.1.
//
// As três listas abaixo foram MEDIDAS em 20/11/2026, rodando o PortMaster de
// verdade no R35S, não lendo o código dele:
//
//   1. `xml` ausente  -> "No module named 'xml'" no import do harbourmaster
//   2. `lzma` ausente -> "unable to extract the Noto fonts"
//   3. o resto        -> os imports de `pylibs/` cruzados com o `python3.mk`

const FRAGMENT = path.join(ROOT, "config/portmaster.fragment");

async function fragmento() {
  return readFile(FRAGMENT, "utf8");
}

test("o fragmento existe e é opt-in, com o custo medido escrito nele", async () => {
  const t = await fragmento();
  // Número estimado não pode virar número medido, nem o contrário: o fragmento
  // é onde quem builda olha primeiro.
  assert.match(t, /22,7 MiB/, "o custo medido tem de estar no fragmento");
  assert.match(t, /GIOCHI_WITH_PORTMASTER=1/);
  assert.match(t, /OPCIONAL/i);
});

test("python3 entra com os módulos que o PortMaster importa", async () => {
  const t = await fragmento();
  const exigidos = [
    ["BR2_PACKAGE_PYTHON3=y", "o interpretador (o pugwash é '#!/usr/bin/env python3')"],
    ["BR2_PACKAGE_PYTHON3_SSL=y", "requests → _ssl e _hashlib"],
    ["BR2_PACKAGE_PYTHON3_ZLIB=y", "zipfile, que extrai o pylibs.zip"],
    ["BR2_PACKAGE_PYTHON3_UNICODEDATA=y", "idna importa unicodedata"],
    ["BR2_PACKAGE_PYTHON3_PYEXPAT=y", "harbourmaster/util/proxy.py → xml.etree"],
    ["BR2_PACKAGE_PYTHON3_XZ=y", "as Noto fonts do pylibs são .xz"],
  ];
  for (const [simbolo, motivo] of exigidos) {
    assert.match(t, new RegExp(`^${simbolo}$`, "m"), `falta ${simbolo} (${motivo})`);
  }
});

test("bz2 fica de fora com o motivo, e não por esquecimento", async () => {
  const t = await fragmento();
  // O único uso é o sink de log `.bz2` do loguru, que este fluxo não escolhe.
  // Se alguém acrescentar, tem de apagar a justificativa — o teste reprova nos
  // dois lados para a decisão não virar folclore.
  assert.doesNotMatch(t, /^BR2_PACKAGE_PYTHON3_BZIP2=y$/m);
  assert.match(t, /bz2/i);
  assert.match(t, /loguru/i);
});

test("bubblewrap é o sandbox, e o giochi-ports diz o que ele NÃO garante", async () => {
  const t = await fragmento();
  assert.match(t, /^BR2_PACKAGE_BUBBLEWRAP=y$/m);

  // Prometer mais do que ele entrega é o defeito do §12.15 com outra roupa: o
  // port roda como root DENTRO do namespace e /user é gravável. Quem lê o
  // `giochi-ports` tem de saber disso antes de confiar no isolamento.
  const bin = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  assert.match(bin, /N[ÃA]O garante|nao garante/i);
  assert.match(bin, /\/user.{0,40}grav[áa]vel/is, "tem de dizer que /user é gravável");
});

test("o pacote do PortMaster NÃO está no fragmento, e o motivo é licença", async () => {
  const t = await fragmento();
  // A linha que impede a recaída: o zip traz gptokeyb2 (GPL-2.0) e 7zzs
  // (LGPL-2.1). Se alguém "resolver" o problema embarcando o pacote, a imagem
  // deixa de poder ser publicada (§15).
  assert.match(t, /GPL-2\.0/);
  assert.match(t, /LGPL/);
  assert.match(t, /\/user/, "o pacote mora em /user, fora da imagem");
});

test("o giochi-ports existe, é executável e usa bubblewrap", async () => {
  const bin = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports");
  const st = await stat(bin);
  // Modo no disco; o do índice do Git é conferido pelo selftest-contract.
  assert.ok(st.mode & 0o111, "giochi-ports sem bit de execução — serviço que não sobe (§12.50)");

  const t = await readFile(bin, "utf8");
  // O desenho do sandbox, item por item. Cada um destes some em silêncio e o
  // resultado é "roda, mas sem isolamento" — que ninguém percebe.
  assert.match(t, /--ro-bind \/ \//, "rootfs tem de ser somente-leitura");
  assert.match(t, /--dev-bind \/dev \/dev/, "DRM/input/uinput/tty0/snd vêm do /dev do aparelho");
  assert.match(t, /--bind \/user \/user/, "é onde ele escreve: ports, jogos, runtimes");
  assert.match(t, /--unshare-all/, "sem namespaces não há isolamento de processo");
  assert.match(t, /--share-net/, "sem rede ele não instala nada, e o sintoma é mudo");
  assert.match(t, /--die-with-parent/, "port órfão segurando o DRM é o §12.45");
});

test("o giochi-ports recusa rodar sem sandbox a menos que seja pedido", async () => {
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // A regra do repositório: falha explícita em vez de rodar pior sem avisar.
  assert.match(t, /--sem-sandbox/);
  assert.match(t, /Recusando rodar codigo de terceiro/);
  // E o caminho de escape tem de DIZER o que está abrindo.
  assert.match(t, /rootfs gravavel/);
});

test("o giochi-ports avisa quando /roms não existe", async () => {
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // Medido no R35S: sem /roms, o control.txt falha em SILÊNCIO ao carregar
  // funcs.txt, e os ports ficam sem pm_finish/pm_message. O aviso é a única
  // pista que sobra.
  assert.match(t, /\/roms nao existe/);
  assert.match(t, /funcs\.txt/);
});

test("o build-device.sh liga o fragmento no prepare-config", async () => {
  const t = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");
  assert.match(t, /GIOCHI_WITH_PORTMASTER/);
  assert.match(t, /PORTMASTER_FRAGMENT_ARGS=\(--fragment/);
  // A linha tem de estar na chamada do prepare-config, não só declarada — foi
  // o defeito do §12.59 (achado 1: variável lida direito, gate desligado).
  const chamada = t.slice(t.indexOf('node "$ROOT/scripts/prepare-config.mjs"'));
  const fim = chamada.indexOf("make -C");
  const bloco = chamada.slice(0, fim);
  assert.match(bloco, /PORTMASTER_FRAGMENT_ARGS/, "o array não chega ao prepare-config");
});

test("o post-build grava OS_NAME e o symlink /roms", async () => {
  const t = await readFile(path.join(ROOT, "scripts/post-build.sh"), "utf8");
  // Medido no R35S: o control.txt resolve o nome por OS_NAME → NAME → ID, e sem
  // OS_NAME o CFW_NAME sai "Buildroot" — que colide com qualquer imagem
  // Buildroot do mundo e faz o mod_<CFW>.txt procurar o arquivo errado.
  assert.match(t, /OS_NAME=/, "sem OS_NAME o CFW_NAME é 'Buildroot'");
  assert.match(t, /ln -sfn \/user .*roms|ln -sfn \/user "\$TARGET_DIR\/roms"/);
  // E o motivo de ser symlink e não `directory=user` no mod: medido numa
  // amostra de 25 ports, 7 citam /roms literalmente.
  assert.match(t, /7 citam/, "o número medido tem de estar no comentário");
});

test("o giochi-ports encaminha sinal e sabe rodar um port", async () => {
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // Um `trap` de shell só roda quando o comando em PRIMEIRO PLANO termina. Com o
  // `bwrap` em foreground, o TERM ficava enfileirado enquanto o jogo rodava —
  // medido: `timeout 30` e o port seguindo por 152 s, com a interface parada
  // atrás dele. O `&` + `wait` é o que faz o sinal chegar.
  assert.match(t, /\$\{BWRAP\}|\$BWRAP[^\n]*&/, "o bwrap tem de rodar em segundo plano");
  assert.match(t, /wait "\$BW_PID"/);
  assert.match(t, /kill -TERM "\$BW_PID"/, "o trap tem de matar o filho, não só sair");
});

test("o marcador tem PID ao lado, e o init se cura quando o dono morre", async () => {
  const ports = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  // Arquivo de estado sem dono não pode ser definitivo: `kill -9` no wrapper
  // deixa o marcador, e o init respeitaria o arquivo e não subiria o launcher —
  // tela parada, sem nada dizendo por quê.
  assert.match(ports, /DEV_FREE_FILE\.pid/);
  const init = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-init"),
    "utf8",
  );
  assert.match(init, /DEV_FREE_FILE\.pid/);
  assert.match(init, /kill -0 "\$DEV_PID"/, "o init tem de perguntar se o dono ainda vive");
});

test("$HOME é gravável dentro do sandbox", async () => {
  // Medido no R35S: `can't create /root/pm_dialog.txt: Read-only file system`.
  // O `control.txt` e o `PortMasterDialog.txt` escrevem em `$HOME`.
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  assert.match(t, /--bind \/user\/home \/root/);
});

test("o gamecontrollerdb.txt do PortMaster é substituído pelo nosso", async () => {
  // O deles tem 472 KB e o `control.txt` o exporta inteiro em
  // SDL_GAMECONTROLLERCONFIG; uma string de ambiente não passa de 128 KB
  // (MAX_ARG_STRLEN), então TODO exec falha com "Argument list too long".
  // O nosso tem 2 KB — e é o mapa do projeto, com `a = BTN_EAST`.
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  assert.match(t, /MAX_ARG_STRLEN|128 KB/);
  assert.match(t, /--ro-bind \$GAMEDB \$pm\/gamecontrollerdb\.txt/);

  // E o arquivo que ele monta é o nosso, com o GUID do controle virtual.
  const db = await readFile(
    path.join(ROOT, "device/common/giochi-gamepad/gamecontrollerdb.txt"),
    "utf8",
  );
  assert.match(db, /06005931091200000100000001000000/);
  assert.ok(Buffer.byteLength(db) < 128 * 1024, "o DB tem de caber no limite do kernel");
});

test("o script roda com `set -u`: variável de um modo só existe em todos", async () => {
  // Medido no R35S em 20/11/2026, logo depois de `--rodar` ser acrescentado: a
  // GUI morria com `PORT_SH: parameter not set`, porque a variável só era
  // atribuída dentro do modo que a usa. Com `set -u`, isso derruba o caminho
  // padrão — que é o mais usado.
  const caminho = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports");
  const t = await readFile(caminho, "utf8");
  assert.match(t, /^set -u$/m, "o script usa `set -u`");

  for (const nome of ["PORT_SH", "PORT_DIR", "RODAR_PORT", "LIBERAR_DRM"]) {
    const atribuicao = t.search(new RegExp(`^${nome}=`, "m"));
    const primeiroUso = t.indexOf(`"` + "$" + nome + `"`);
    assert.ok(atribuicao > 0, `${nome} nunca é atribuído e o set -u derruba o script`);
    assert.ok(
      atribuicao < primeiroUso,
      `${nome} é usado antes de ser atribuído (posição ${primeiroUso}) — a GUI morre com "parameter not set"`,
    );
  }

  // E o caminho padrão (sem `--rodar`) tem de continuar rodando de verdade.
  const { spawnSync } = await import("node:child_process");
  // 60 s: o `--status` varre `/proc/*/fd/*` para achar quem tem o DRM, e isso
  // passa de 14 s numa máquina carregada. Um timeout apertado vira teste
  // intermitente, e intermitente é pior que lento (§12.62-B).
  const r = spawnSync("sh", [caminho, "--status"], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `--status falhou: ${r.stderr}`);
});

test("todo símbolo do fragmento existe no Kconfig do Buildroot (quando em cache)", async () => {
  // A classe do §12.71: `BR2_PACKAGE_KMOD_TOOLS` vive DENTRO de
  // `if BR2_PACKAGE_KMOD`. Sem o pai, o símbolo filho **nem existe** no Kconfig
  // — o `olddefconfig` o descarta e o `assert-config` reprova o build. E o
  // símbolo pode simplesmente ter nome errado (`FEATURE_TAR_GZIP`, §12.60).
  //
  // A pergunta certa é "este símbolo existe no Kconfig?", e ela exige a árvore
  // real. Sem a árvore em cache o teste DIZ que pulou — não inventa veredito
  // por heurística de nome: a primeira versão deste teste tentou dividir
  // `BR2_PACKAGE_CA_CERTIFICATES` em pai/filho e acusou sete pacotes corretos,
  // porque nome de pacote tem underscore à vontade.
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");
  const { homedir } = await import("node:os");

  const raizes = [];
  for (const base of [
    path.join(homedir(), ".cache/giochi-system/work"),
    "/cache/work",
  ]) {
    if (!existsSync(base)) continue;
    for (const dev of readdirSync(base)) {
      const dir = path.join(base, dev, "buildroot-2025.02");
      if (existsSync(path.join(dir, "package"))) raizes.push(dir);
    }
  }
  if (raizes.length === 0) {
    console.log("  (skip: árvore do Buildroot não está em cache nesta máquina)");
    return;
  }

  // Junta `package/**/Config.in` e o `Config.in` da raiz num só texto.
  const colher = (dir, saida, fundo = 0) => {
    if (fundo > 6) return;
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, nome.name);
      if (nome.isDirectory()) colher(p, saida, fundo + 1);
      else if (nome.name === "Config.in") saida.push(readFileSync(p, "utf8"));
    }
  };
  const textos = [];
  colher(path.join(raizes[0], "package"), textos);
  textos.push(readFileSync(path.join(raizes[0], "Config.in"), "utf8"));
  const kconfig = textos.join("\n");

  const f = await readFile(FRAGMENT, "utf8");
  const pedidos = [...f.matchAll(/^(BR2_[A-Z0-9_]+)=y$/gm)].map((m) => m[1]);
  assert.ok(pedidos.length >= 8, `esperava os símbolos do python3/bwrap, achei ${pedidos.length}`);

  const inexistentes = pedidos.filter((s) => !new RegExp(`^\\s*config ${s}$`, "m").test(kconfig));
  assert.deepEqual(
    inexistentes,
    [],
    "símbolo que não existe no Kconfig é descartado em silêncio e reprova o assert-config: " +
      inexistentes.join(", "),
  );
});

test("o replay do gate nos três handhelds está registrado", async () => {
  // O `assert-config` sobre o `.config` real é a validação que importa, e ela
  // precisa de Docker — não cabe num teste de unidade. O que cabe é garantir
  // que a MEDIÇÃO está escrita, para a próxima pessoa saber contra o que ela
  // foi feita e quando repetir.
  //
  // Medido em 20/11/2026, Buildroot 2025.02:
  //   r35s  47 símbolos de 3 fragmentos
  //   x55   35 símbolos de 3 fragmentos
  //   x35h  34 símbolos de 3 fragmentos
  const doc = await readFile(path.join(ROOT, "docs/evaluacao-portmaster.md"), "utf8");
  assert.match(doc, /47 s[íi]mbolos/);
  assert.match(doc, /35 s[íi]mbolos/);
  assert.match(doc, /34 s[íi]mbolos/);
  assert.match(doc, /assert-config/);
});

test("`--rodar` não marca console livre quando o DRM já está livre", async () => {
  // O launcher mata o `Painter` antes do `spawn` (medido no código deles:
  // "o filho recebe kmsdrm not available" sem isso). Então, quando ele chama o
  // `giochi-ports`, o DRM JÁ está livre — e criar o marcador ali seria mentir
  // para o `giochi-init` sobre um console que não está livre. Se o port
  // morresse com o marcador, o launcher não voltaria e a tela ficaria parada.
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );

  // A ordem dentro de `liberar_drm` é o que garante: consulta ANTES de marcar.
  const fn = t.slice(t.indexOf("liberar_drm()"), t.indexOf("devolver_drm()"));
  const consulta = fn.indexOf('pid="$(quem_tem_o_drm)"');
  const marcador = fn.indexOf(': >"$DEV_FREE_FILE"');
  assert.ok(consulta > 0 && marcador > consulta,
    "o marcador tem de ser criado DEPOIS de saber quem tem o DRM — senão um " +
    "console livre de verdade fica marcado como ocupado");

  // E o `.pid` só nasce se o marcador existir.
  assert.match(t, /\[ -f "\$DEV_FREE_FILE" \] && \{ echo \$\$ >"\$DEV_FREE_FILE\.pid"/,
    "o `.pid` sem marcador deixaria lixo no /run e o init o leria à toa");
});

test("a GUI é pysdl2: PYSDL2_DLL_PATH aponta para o SDL2 da imagem", async () => {
  // Issue #6, medido no R35S em 26/11/2026. Sem a variável, o `pysdl2` resolve o
  // SDL2 de `exlibs/sdl2` — a cópia que o pacote do PortMaster traz, **sem
  // KMSDRM** — e a GUI morre com "No available video device". A mensagem aponta
  // para o pysdl2, não para o driver, então manda procurar no lugar errado.
  //
  // O `pm_launch.txt` deles põe no `pm_hook_gui_env()`, mas o `giochi-ports`
  // chama o `pugwash` direto, sem passar por aquele laço.
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );
  assert.match(t, /^PYSDL2_DLL_PATH=\/usr\/lib$/m);
  assert.match(t, /^export PYSDL2_DLL_PATH$/m);

  // Tem de valer para TODOS os caminhos que chamam o pugwash: com sandbox, sem
  // sandbox, e o `--rodar` de um port que abra a GUI. A atribuição tem de vir
  // antes do primeiro deles.
  const atribuicao = t.search(/^PYSDL2_DLL_PATH=/m);
  // Os usos REAIS, não as menções: `--sem-sandbox` aparece na ajuda e no `case`
  // antes da atribuição, e procurar o literal reprovava o script correto.
  const usos = [
    ['if [ "$modo" = "--sem-sandbox" ]', "o caminho sem sandbox"],
    ['rodar_com_reinicio "$py"', "o sem-sandbox rodando o pugwash"],
    ['rodar_com_reinicio "$BWRAP"', "o caminho com sandbox"],
  ];
  for (const [literal, descricao] of usos) {
    const pos = t.indexOf(literal);
    assert.ok(pos > 0, `não achei ${descricao} ("${literal}") — o teste ficou desatualizado`);
    assert.ok(atribuicao < pos,
      `PYSDL2_DLL_PATH é atribuído depois de ${descricao} — aquele caminho fica sem o SDL2 da imagem`);
  }
});

test("`.pugwash-reboot` é apagado antes e o reinício é honrado depois", async () => {
  // Issue #6 (b): o `pugwash` pula a GUI e sai quando `.pugwash-reboot` existe
  // (`pylibs/pugwash/main.py:129`). Um arquivo deixado por qualquer execução
  // anterior fazia a GUI nunca abrir — medido: o do R35S era de 20/11 e nada
  // abria desde então.
  //
  // E o contrário também importa: quando o `pugwash` pede reinício de verdade
  // (auto-update, troca de tema), o pedido não pode ser ignorado.
  const t = await readFile(
    path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"),
    "utf8",
  );

  assert.match(t, /^PUGWASH_REBOOT=/m);
  // O `rm` antes de qualquer execução.
  const rm = t.indexOf('rm -f "$PUGWASH_REBOOT"');
  const execucao = t.indexOf("rodar_com_reinicio");
  assert.ok(rm > 0 && rm < execucao, "o `.pugwash-reboot` tem de ser apagado ANTES de rodar");

  // O laço é UMA função usada por todos os caminhos: dois laços copiados
  // divergem na primeira correção (§12.49).
  const funcoes = (t.match(/^rodar_com_reinicio\(\)/gm) || []).length;
  assert.equal(funcoes, 1, `a função de reinício aparece ${funcoes} vez(es); tem de ser uma`);
  assert.match(t, /\[ -f "\$PUGWASH_REBOOT" \] \|\| break/,
    "sem esta linha o laço nunca termina — a GUI reabriria para sempre");
});

test("todo --fragment BR2 do prepare-config também é verificado pelo assert-config", async () => {
  // Encontrado em 26/11/2026, no run 45905065339: o fragmento do PortMaster era
  // aplicado (`portmaster: python3 + bubblewrap (runtime)` no log) mas o
  // `assert-config` reportava "91 símbolo(s) de 3 fragmento(s)" — ele verifica
  // comum + aparelho + defconfig, e os CONDICIONAIS (godot, portmaster) ficavam
  // de fora. Nenhum dos 8 símbolos do portmaster.fragment passava por gate.
  //
  // É a mesma classe do §12.59/1 (o gate do harfbuzz que nunca rodou) e do
  // §12.60/2 (o busybox como único Kconfig sem verificação), na terceira roupa:
  // o gate existe, roda, e cobre PARTE dos arquivos.
  //
  // A invariante é sobre a CLASSE, não sobre estes dois nomes: qualquer array
  // `*_FRAGMENT_ARGS` de símbolo `BR2_*` que chegue ao `prepare-config` tem de
  // chegar ao `assert-config`. Os de kernel e busybox são outro Kconfig e têm
  // os seus próprios gates (`assert-kernel-config`, `assert-busybox-config`) —
  // esses são verificados aqui também, para que a exclusão não vire desculpa.
  const t = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");

  const blocoDe = (inicio, fim) => {
    const i = t.indexOf(inicio);
    assert.ok(i >= 0, `não achei "${inicio}"`);
    return t.slice(i, t.indexOf(fim, i));
  };
  const prep = blocoDe('node "$ROOT/scripts/prepare-config.mjs"', "make -C");
  // O bloco do assert começa na MONTAGEM de ASSERT_FRAGMENTS, não na chamada:
  // os appends ficam antes do `if ! node ...`, e olhar só a chamada daria
  // falso negativo.
  const assertBloco = blocoDe("ASSERT_FRAGMENTS=(", "ERRO: símbolos pedidos");

  const todos = new Set([...prep.matchAll(/\$\{([A-Z_]+_FRAGMENT_ARGS)\[/g)].map((m) => m[1]));
  assert.ok(todos.size >= 3, `esperava >=3 arrays de fragmento, achei ${todos.size}`);

  // Outro Kconfig, outro gate — mas tem de existir um gate.
  const outroKconfig = ["KERNEL_FRAGMENT_ARGS", "BUSYBOX_FRAGMENT_ARGS"];
  for (const nome of outroKconfig) {
    if (!todos.has(nome)) continue;
    const gate = nome === "KERNEL_FRAGMENT_ARGS" ? "assert-kernel-config.mjs" : "assert-busybox-config.mjs";
    assert.ok(t.includes(gate), `${nome} existe mas ${gate} não roda no build`);
  }

  const br2 = [...todos].filter((n) => !outroKconfig.includes(n));
  const faltando = br2.filter((nome) => !assertBloco.includes(nome));
  assert.deepEqual(
    faltando,
    [],
    "fragmento(s) BR2 aplicado(s) mas NÃO verificado(s) pelo assert-config: " +
      faltando.join(", ") +
      "\n  Um símbolo com typo ou pai unset neles é descartado em silêncio e o build" +
      "\n  fica verde com a imagem faltando o recurso (§12.59/1, §12.60/2).",
  );
});
