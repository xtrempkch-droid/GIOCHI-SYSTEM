#!/usr/bin/env node
// O contrato de `scripts/gpu-bench.c` — as quatro maneiras de medir errado.
//
// Contexto: a primeira versão do benchmark (08/11/2026, X55) devolveu números
// impossíveis e todos "bonitos" — 13406 Mpix/s de preenchimento, 15 TFLOP/s de
// ALU num Mali-G52 de ~50 GFLOP/s de pico, `cpu_memcpy` em `inf GB/s`. Nenhum
// desses valores parecia erro; três eram trabalho que o compilador ou a GPU
// tinham apagado, e um era a conta errada sobre um laço de medição.
//
// Este teste existe para que a correção de cada um não seja desfeita por
// "simplificação". Cada asserção aponta o defeito medido que ela impede.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("../scripts/gpu-bench.c", import.meta.url), "utf8");
const SH = readFileSync(new URL("../scripts/gpu-bench.sh", import.meta.url), "utf8");
const PROXY = readFileSync(new URL("../scripts/ssh-por-iface.py", import.meta.url), "utf8");

/** Corpo da função C, de `nome(` até a chave de fechamento no início da linha. */
function corpo(fonte, nome) {
  const i = fonte.indexOf(`static void ${nome}(void)`);
  if (i < 0) throw new Error(`função ${nome} não encontrada`);
  const fim = fonte.indexOf("\n}", i);
  return fonte.slice(i, fim);
}

test("o shader de preenchimento depende da posição do fragmento", () => {
  // Sem isso o panfrost troca o tile inteiro por um `clear` e a medida deixa de
  // ser taxa de fragmento: 3793 Mpix/s em 640x480 contra 12208 em 1280x720, o
  // número menor em mais pixels.
  assert.match(SRC, /FS_FILL[\s\S]*gl_FragCoord/, "FS_FILL tem de ler gl_FragCoord");
});

test("o laço de ALU é não-linear, então não pode ser colapsado", () => {
  // `a = a * 1.0001 + 0.25` repetido 64 vezes é uma recorrência afim: com
  // reassociação o compilador troca por `a * K + C` e a "ALU" não custa nada
  // (medido: 15575 GFLOP/s). A semente também tem de vir de gl_FragCoord, senão
  // o cálculo é uniforme e o driver o faz uma vez por quad.
  assert.match(SRC, /a \* \(1\.0 \+ a \* 0\.0001\)/,
    "a recorrência tem de ser não-linear (impede o fechamento em forma analítica)");
  assert.match(SRC, /FS_ALU[\s\S]*gl_FragCoord/,
    "a semente da ALU tem de vir de gl_FragCoord");
  assert.ok(!/a = a \* 1\.0001 \+ 0\.250/.test(SRC),
    "a forma afim original não pode voltar");
});

test("each desenho alterna o conteúdo, senão o tile não é reescrito", () => {
  // "Transaction elimination": tile com CRC igual ao que já está na memória não
  // é escrito de volta. Redesenhar a mesma imagem mede a taxa de descarte.
  assert.match(SRC, /u_cycle/, "os shaders precisam do multiplicador por quadro");
  assert.match(SRC, /frame_no/, "o contador de quadro precisa existir");
  for (const f of ["draw_fill", "draw_alu", "draw_tex", "draw_blend"]) {
    assert.match(corpo(SRC, f), /set_cycle\(/, `${f} tem de chamar set_cycle`);
  }
});

test("a malha desenhada não pode sair preta por uniform não inicializado", () => {
  // `prog_mesh` não chamava set_cycle; `u_cycle` valia 0 e o desenho saía
  // (0,0,0,255). A verificação por RGB concluía "nada foi escrito" e o teste
  // certo era acusado de errado.
  assert.match(SRC, /loc_cyc_mesh/, "prog_mesh precisa da localização de u_cycle");
  assert.match(SRC, /glUniform1f\(loc_cyc_mesh, 1\.0f\)/,
    "u_cycle do prog_mesh tem de ser inicializado com 1.0");
});

test("nenhum glGetUniformLocation dentro de laço de desenho", () => {
  // 4000 chamadas por quadro faziam busca por string na Mesa e dominavam o teste
  // de submissão inteiro — media-se a Mesa, não o custo por draw.
  for (const f of ["draw_fill", "draw_alu", "draw_tex", "draw_blend", "draw_many", "draw_verts"]) {
    if (!SRC.includes(`static void ${f}(void)`)) continue;
    assert.ok(!/glGetUniformLocation/.test(corpo(SRC, f)),
      `${f} não pode resolver localização de uniform no laço`);
  }
});

test("o memcpy do benchmark é lido depois, senão vira `inf GB/s`", () => {
  const f = SRC.indexOf("static void cpu_memcpy_test(void)");
  const corpoMem = SRC.slice(f, SRC.indexOf("\n}", f));
  assert.match(corpoMem, /volatile/, "precisa de acumulador volátil");
  assert.match(corpoMem, /sink \+= b\[i\]/, "o destino tem de ser lido depois da cópia");
});

test("o shader de computação declara 310 es (SSBO entrou no ES 3.1)", () => {
  // Com `#version 300 es` ele não compila e o teste anunciava "SKIP (sem ES 3.1)"
  // num aparelho que tem 3.1 — um SKIP que parecia limitação de hardware.
  const i = SRC.indexOf("CS_MUL");
  const trecho = SRC.slice(i, SRC.indexOf("};", i));
  assert.match(trecho, /#version 310 es/);
  assert.ok(!/glBindImageTexture\(0, ssbo/.test(SRC),
    "glBindImageTexture liga imagem de TEXTURA; SSBO é ligado por glBindBufferBase");
});

test("todo teste de GPU verifica que desenhou antes de publicar o número", () => {
  // A trava contra todos os defeitos acima: um teste que não escreveu nada sai
  // como INVALIDO, não como número bonito.
  const testes = SRC.match(/^static void test_[a-z_]+\(/gm) || [];
  assert.ok(testes.length >= 7, `esperava >= 7 testes, achei ${testes.length}`);
  for (const t of ["test_fill", "test_alu", "test_tex", "test_blend", "test_many_draws", "test_verts"]) {
    const i = SRC.indexOf(`static void ${t}(`);
    const corpoT = SRC.slice(i, SRC.indexOf("\n}", i));
    assert.match(corpoT, /drew_something|drew_region|read_pixel/,
      `${t} precisa conferir o framebuffer antes de medir`);
  }
  assert.match(SRC, /invalid\(/, "precisa existir o caminho INVALIDO");
});

test("a medição é síncrona, porque o lote não executa o trabalho", () => {
  // Medido na X55: 200 quadros enfileirados levam 49 ms, um único quadro
  // sincronizado leva 44 ms — e nem `glReadPixels` força a execução do lote. A
  // taxa agregada era ficção (15 TFLOP/s num G52).
  const i = SRC.indexOf("static double medir(");
  assert.ok(i > 0, "a medição tem de ser a função `medir`");
  const corpoMedir = SRC.slice(i, SRC.indexOf("\n}", i));
  assert.match(corpoMedir, /glFinish\(\)/);
  assert.ok(!/do \{[\s\S]*?\} while/.test(corpoMedir),
    "o laço antigo, sem glFinish por quadro, não pode voltar");
});

test("o script fixa GPU e CPU, e restaura mesmo se morrer", () => {
  // `governor` é o nome no devfreq e `scaling_governor` no cpufreq; procurar só
  // o primeiro deixava a CPU no `schedutil` sem aviso, e o teste de submissão é
  // CPU-bound (+31% ao fixar).
  assert.match(SH, /\/sys\/class\/devfreq\/\*\/governor/);
  assert.match(SH, /scaling_governor/, "cpufreq usa scaling_governor, não governor");
  assert.match(SH, /trap restore/, "a restauração tem de estar no trap");
  assert.match(SH, /restaur/, "o script tem de restaurar os governors");
});

test("o script não instala nada no aparelho nem reinicia", () => {
  // O binário vai para /tmp e é apagado; o launcher de outro time pode estar
  // rodando e segurando o DRM master.
  assert.match(SH, /\/tmp\/gpu-bench/, "o binário roda de /tmp");
  assert.match(SH, /rm -f/, "o /tmp tem de ser limpo no fim");
  assert.ok(!/\breboot\b|init 6|poweroff/.test(SH), "o script não pode reiniciar o aparelho");
  assert.match(SRC, /EGL_PLATFORM_SURFACELESS_MESA/,
    "renderizar offscreen é o que permite rodar com o launcher segurando o master");
});

test("o resultado é guardado com a identidade da imagem", () => {
  // Dois números de commits diferentes comparados como se fossem do mesmo é o
  // erro que o build-info.txt existe para evitar.
  assert.match(SH, /OUTDIR="\$REPO_ROOT\/out\/\$DEVICE"/);
  assert.match(SH, /LOG="\$OUTDIR\/gpu-bench-\$STAMP\.txt"/);
  assert.match(SH, /built_at_utc|commit/);
});

test("o script se recusa a medir o aparelho errado", () => {
  // Todos os aparelhos usam 10.55.0.2 e o MESMO MAC de gadget, então pedir o
  // R35S pode abrir uma sessão na X55 — e o resultado sai plausível com o nome
  // errado. A trava compara o `device=` gravado na imagem com o id pedido.
  assert.match(SH, /REMOTO_DEV/, "precisa ler o device= do build-info");
  assert.match(SH, /conectei em/, "precisa abortar quando o aparelho não confere");
});

test("quem escolhe o aparelho é a interface, não o IP", () => {
  // `ssh -o BindInterface=` NÃO funcionou (o tráfego saiu pela interface do
  // outro aparelho, conferido nos contadores). O que funciona é
  // SO_BINDTODEVICE, que neste kernel não exige root.
  assert.match(SH, /--iface/, "o harness precisa da opção --iface");
  assert.match(SH, /ssh-por-iface\.py/, "o ProxyCommand tem de usar o proxy");
  assert.match(PROXY, /SO_BINDTODEVICE = 25/);
  assert.match(PROXY, /setsockopt/);
  assert.match(PROXY, /--iface/);
});

test("o proxy não descarta byte e não mata sessão ociosa", () => {
  // Dois defeitos MEDIDOS em 08/11/2026 com um servidor de teste local:
  //
  //  1. o laço usava `dados = b"\0"` como sentinela de "nada neste ciclo" e
  //     comparava com ele. SSH é binário: um 0x00 legítimo que chegasse sozinho
  //     no recv era engolido (4 bytes enviados, 2 recebidos), e byte perdido no
  //     meio de um pacote desincroniza o protocolo;
  //  2. `select(..., 60)` derrubava a sessão depois de 60 s sem tráfego — um
  //     `sleep 70` remoto morria com a conexão.
  //
  // Nenhum dos dois aparece num teste de "conecta e lê um echo": o primeiro
  // depende do tamanho do chunk, o segundo do tempo.
  // Sem comentários: o comentário que EXPLICA o defeito contém o código que ele
  // proíbe, e a primeira versão deste teste reprovava a própria documentação.
  const CODIGO = PROXY.split("\n")
    .map((l) => l.replace(/#.*$/, ""))
    .join("\n");
  assert.ok(!/dados = b"\\0"/.test(CODIGO),
    "não pode existir sentinela b\\0 para 'nada neste ciclo'");
  assert.match(CODIGO, /elif dados:/, "o caminho vazio tem de ser `elif dados:`");
  assert.ok(!/select\.select\([^)]*,\s*60\)/.test(CODIGO),
    "o select não pode ter timeout que encerre a sessão");
  assert.match(PROXY, /Sessão ociosa é o caso normal/);
});

test("a medição é de UM desenho por quadro, e o descarte de desenho não volta", () => {
  // A curva t(K) medida no R35S com o shader de ALU (141,7 ms por desenho):
  //
  //   K=1  141,673 ms     K=8   141,992 ms
  //   K=2  142,137 ms     K=16  141,960 ms
  //
  // 141 ms x 16 seria 2,3 s. O driver descarta os desenhos anteriores porque
  // cada um sobrescreve o quadro inteiro. Logo:
  //  - enfileirar N quadros não mede N vezes nada;
  //  - "tirar o custo fixo" por (t(K=4)-t(K=1))/3 mede desenho ELIMINADO, e
  //    produziu fill a 8,9 Gpix/s num G31 cujo pico é ~1 Gpix/s (9x o teto).
  assert.ok(!/overhead_frame/.test(SRC),
    "a subtração do custo fixo por diferencial não pode voltar");
  assert.match(SRC, /\*frames = n;/,
    "medir() devolve o total de n quadros; *frames tem de ser n");
  assert.ok(!/\*frames = 1;/.test(SRC),
    "*frames = 1 inflaciona todos os números em n (foi 200x)");

  // O quadro vazio tem de ser MEDIDO e mostrado: é o que prova que o tempo
  // publicado é trabalho de GPU, não de sincronização (0,081 ms contra 1,63 ms
  // de um preenchimento no R35S).
  assert.match(SRC, /medir_k\(draw, 0, 20\)/, "custo do quadro vazio tem de ser medido");
  assert.match(SRC, /custo_glFinish_vazio/, "e tem de sair no relatório");
  assert.match(SRC, /GL_RENDERER/, "e o renderer continua obrigatório na saída");
});
