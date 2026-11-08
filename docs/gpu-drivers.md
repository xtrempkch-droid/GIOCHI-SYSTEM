# Driver de GPU: a decisão, e o que acontece se o panfrost nunca tiver geometry shader

Documento de decisão. A pergunta que ele responde: **"e se não for possível fazer
o driver funcionar?"** — com o que se perde, o que continua funcionando, e qual é
o caminho de escape.

Resumo em uma linha: **o driver bloqueia exatamente uma coisa** (arcade sem o
nosso patch), e essa coisa já tem solução medida.

---

## 1. O que existe hoje, e o que cada opção entrega

Medido no R35S em 06/11/2026 e conferido no fonte do Mesa 24.0.0 que está na
nossa árvore (`build/build/mesa3d-24.0.0/docs/features.txt`).

| Opção | Quem entrega | GLES | Geometry shader | Compute |
| --- | --- | --- | --- | --- |
| **Mesa/panfrost** (nossa escolha) | software livre | 3.1 | **não** | **sim** |
| `libmali` da ARM | blob proprietário | 3.2 | **sim** | sim |
| `panvk` (Vulkan sobre panfrost) | software livre, experimental | — | improvável | parcial |

A linha que decide, copiada do `features.txt` real:

```text
GL_ARB_compute_shader    DONE (freedreno/a5xx+, softpipe, v3d, panfrost, crocus/gen7+, asahi)
GL_OES_geometry_shader   DONE (freedreno/a6xx, nvc0, r600, softpipe, v3d, asahi)
GL_ARB_tessellation_shader  DONE (freedreno/a6xx)
```

**`panfrost` aparece em compute e não aparece em geometry shader.** Isso não é
"falta de driver": é uma escolha do projeto Mesa — geometry shader em Bifrost
seria emulado por compute, com custo de desempenho e de manutenção, e ninguém
fez.

---

## 2. "Portar o driver" não é algo que nós possamos fazer

Vale ser explícito, porque a expressão engana. O `panfrost` é um driver do
**Mesa**, não nosso. Adicionar geometry shader a ele significa:

- escrever o suporte no Mesa (não no Buildroot, não neste repositório);
- manter isso contra a evolução do driver;
- convencer o upstream a aceitar — senão viramos donos de um fork de GPU.

O custo é de **projeto de driver gráfico**, não de integração. Nenhuma das três
tarefas cabe a este repositório, e é por isso que a pergunta certa não é
"conseguimos portar?" e sim **"o que fazemos sem isso?"**.

---

## 3. O que o panfrost NÃO entregar implica, item por item

| O que precisamos | Precisa de geometry shader? | Com panfrost | Bloqueado? |
| --- | --- | --- | --- |
| Launcher SDL2 + KMSDRM, GLES 3.x | não | **funciona** (provado na X55) | não |
| Godot 4 **Compatibility** (GLES3) | **não** — base é GLES 3.0 | funciona | não |
| Godot 4 **Forward+** | precisa Vulkan | recusado por contrato (`graphics_api_min`) | irrelevante |
| Compute shaders, GLES 3.1 | — | `GL_ARB_compute_shader` **DONE** | não |
| **arcade sem patch** | **sim** | `arcade.Window()` levanta | **sim** |
| **arcade com o nosso patch** | não | funciona (medido em ambiente fechado) | não |
| Tessellation (GLES 3.2) | sim | não | depende do jogo |

Conclusão: **o único item que o panfrost custa é o arcade sem patch.** Todo o
resto do roadmap — launcher, Godot 4 Compatibility, jogos SDL2, compute — passa.

Isso muda o peso da decisão: não estamos escolhendo entre "interface funciona" e
"interface não funciona". Estamos escolhendo se **um** framework Python precisa
de patch.

---

## 4. As três saídas, em ordem de custo

### 4.1 O patch do arcade (já feito — custo zero)

`~/.cache/giochi-system/arcade-pr/upstream`, commit `97633a1`:
*"Degrade gracefully when the platform has no geometry shaders"*.

O que ele faz, e é o ponto: o arcade **já tinha** o caminho sem geometry shader
escrito — `SpriteListTextureData`, criado para WebGL — e ele estava
**comentado**. O patch reativa esse caminho, usa colisão por CPU (hitbox em vez
de GPU) e detecta por tentativa (`try/except` no link), não por consulta de
extensão.

Por que detecção por consulta não serve: em contexto GLX, `ctx.extensions`
devolve as extensões **da plataforma**, não do driver (`GL_ARB_geometry_shader4`
estava ausente num contexto que suporta geometry shader). E um driver pode
anunciar a extensão e falhar no link. Tentar é o teste honesto.

**Custo de manter:** um patch de ~8 pontos, contra um alvo que muda de versão.
Se o upstream aceitar, custo zero. Se não aceitar, é patch carregado por nós — e
nesse caso ele precisa de teste (existe: `scripts/arcade-probe/`, que roda A/B em
ambiente fechado e mede o resultado, não a intenção).

### 4.2 `libmali` como pacote opcional da loja (custo médio, e é de licença)

Aqui a decisão **para de ser técnica**. O blob da ARM:

- resolve o geometry shader (medido: GLES 3.2, 104 extensões);
- são ~59 MB (`libmali-bifrost-g31-g29p1.so`);
- tem **termos próprios de redistribuição**, e o nosso artefato de CI é público.

A pergunta que precisa de resposta jurídica, não de engenharia: **podemos
redistribuir o `libmali` dentro de uma imagem que qualquer pessoa baixa?** Eu não
tenho essa resposta, e não vou assumir que sim.

Por isso a forma defensável é a que já está no contrato da loja:

| Onde o blob fica | Por quê |
| --- | --- |
| **fora** da imagem base | não redistribuímos o que não temos direito |
| **na loja**, como item que o usuário instala | quem aceita o termo é o usuário, não o projeto |
| com `distribution: store` no `forge.json` | já é o mecanismo previsto para jogo com runtime extra |

Custo real: duas pilhas de GLES na mesma máquina exigem seleção por variável de
ambiente (`LD_LIBRARY_PATH` ou `libmali-hook`), e o jogo passa a depender de um
binário que não atualiza junto com o sistema. É dívida, mas é dívida **contida**
em um pacote.

### 4.3 Recusar o jogo (custo zero, e é uma resposta legítima)

O `forge.json` tem `graphics_api_min`. Se um jogo exigir GLES 3.2 com geometry
shader, a loja recusa com mensagem clara — em vez de instalar e falhar no boot.

Regra: **recusar na loja é melhor que degradar em silêncio.** Um jogo que abre e
desenha errado é pior que um jogo que não instala.

---

## 5. A regra de decisão, para não rediscutir

```text
O recurso é necessário para a INTERFACE (launcher, Godot Compatibility)?
  → não. panfrost serve. Não abrir exceção.

O recurso é necessário para UM JOGO?
  → o jogo declara em forge.json.
    ├─ exige GLES 3.2 / geometry shader  → recusar na loja (4.3)
    └─ tem caminho alternativo            → patch ou versão compatível (4.1)

Só existe esse jogo e ele é o motivo do aparelho existir?
  → libmali como pacote DA LOJA, nunca na imagem base (4.2),
    e só depois de resposta sobre redistribuição.
```

O que **não** se faz:

- colocar `libmali` na imagem base "para garantir" — troca um problema de
  framework por um problema de licença em todo artefato público;
- anunciar GLES 3.2 no `forge.json` porque o blob consegue — a capacidade que
  declaramos tem de ser a da **imagem que entregamos**, com panfrost;
- tratar o patch do arcade como gambiarra. Ele usa o caminho que o próprio
  arcade escreveu para WebGL; é o mesmo código, sem a linha comentada.

---

## 6. O número — agora medido, não deduzido

Até 06/11/2026 tudo acima comparava o **hardware** (medido no R35S, mas com o
blob da ARM) com o **Mesa 24.0.0 da nossa árvore** (lido no `features.txt`). O
`panfrost` rodando nunca tinha sido medido.

**Foi medido.** R35S, nossa imagem (`commit=779fc64`), `panfrost` carregado,
`gles-probe.c` compilado pelo cross-toolchain do próprio build e enviado por SSH:

```text
GL_RENDERER         = Mali-G31 (Panfrost)
GL_VERSION          = OpenGL ES 3.1 Mesa 24.0.0
GLSL_VERSION        = OpenGL ES GLSL ES 3.10
GL_MAX_TEXTURE_SIZE = 8192
extensões GL        = 128

GL_OES_geometry_shader       = NÃO
GL_EXT_geometry_shader       = NÃO
GL_OES_tessellation_shader   = NÃO
GL_OES_texture_float         = SIM
GL_EXT_texture_filter_anisotropic = SIM
GL_KHR_debug                 = SIM
```

O quadro da seção 2 está **confirmado**: GLES 3.1 com compute, sem geometry
shader e sem tessellation. Launcher, SDL2 e Godot 4 Compatibility passam; o
arcade depende do patch que já existe.

O A/B que o documento pedia (`rmmod` do blob + `modprobe panfrost`) não foi
necessário: o blob da ARM não está na nossa imagem, então o "antes" foi obtido
tirando o panfrost — mesmo aparelho, mesmo stack, um driver a menos.

### A armadilha que quase transformou isso em "está tudo bem"

Sem panfrost a Mesa cai no `swrast`, e o probe responde:

```text
com panfrost:  GL_RENDERER = Mali-G31 (Panfrost)   GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
sem panfrost:  GL_RENDERER = softpipe              GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
```

**A `GL_VERSION` é idêntica** (`OpenGL ES 3.1 Mesa 24.0.0`). Todo teste que
pergunta "tem GLES 3.1?" — e todo `VEREDITO: GLES respondeu` — aprova um
aparelho renderizando na CPU. A única pergunta que separa os dois casos é
**`GL_RENDERER`**.

E era exatamente esse o estado da imagem do R35S: `CONFIG_DRM_PANFROST=m`, sem
`/etc/modules` e sem `modules-load`, o `.ko` no disco e ninguém para carregá-lo.
Na prática 3D na CPU, com build verde e selftest aprovando. Corrigido para `=y`
(`device/r35s/linux.fragment`), com gate em `kernel-required.txt` e teste em
`tests/gpu-drivers.test.mjs`.

Comando, para repetir em qualquer aparelho:

```bash
bash scripts/gles-probe.sh r35s              # compila (dinâmico, usa a Mesa do aparelho)
scp out/r35s/gles-probe root@10.55.0.2:/tmp/ && ssh root@10.55.0.2 /tmp/gles-probe
```

Leia `GL_RENDERER`, não `GL_VERSION`.

---

## 7. Desempenho: o throughput separado por parte (08/11/2026)

A seção 6 responde "que recursos o driver entrega". Ela **não** responde "quanto
ele entrega por segundo", e as duas coisas são perguntas diferentes: dá para ter
GLES 3.1 funcionando e ser lento, e dá para ser rápido no preenchimento e lento
no shader.

`scripts/gpu-bench.c` mede as partes separadas, porque um número só (`glmark2`)
não diz **onde** a diferença está. Mesmo fonte, mesmo toolchain, mesma Mesa
24.0.0, GPU e CPUs fixadas em `performance`, duas a três rodadas com variação
< 2% (08/11/2026):

| Medida | R35S — Mali-G31 @ 480 MHz | X55 — Mali-G52 @ 800 MHz | Razão |
| --- | --- | --- | --- |
| `fill 640x480` | 192 Mpix/s | **568 Mpix/s** | 2,96× |
| `fill 1280x720` | 260 Mpix/s | **941 Mpix/s** | 3,62× |
| `alu_fragment` | 8,90 GFLOP/s | **28,9 GFLOP/s** | 3,25× |
| `texture_bilinear` | 28,7 Mtexels/s | **78,6 Mtexels/s** | 2,74× |
| `blend_overdraw_x8` | 304 Mpix/s | **942 Mpix/s** | 3,10× |
| `many_draws_4000` | 49,0 kdraws/s | **90,7 kdraws/s** | 1,85× |
| `vertex_throughput` | 7,09 Mvert/s | **15,1 Mvert/s** | 2,13× |
| `compute_fma` | 3,77 GFLOP/s | **12,3 GFLOP/s** | 3,26× |
| `cpu_fma` | 1,28 GFLOP/s | **3,43 GFLOP/s** | 2,68× |
| `cpu_memcpy` | 0,78 GB/s | **3,07 GB/s** | 3,9× |

Imagens: R35S `commit=12b431d`, X55 `commit=60e326f`.

### A conta que fecha — e é o que dá crédito ao número

| | Lanes | Clock | Pico teórico | Medido | % do pico |
| --- | --- | --- | --- | --- | --- |
| Mali-G31 MP2 | 16 | 480 MHz | 15,4 GFLOP/s | 8,90 | **58%** |
| Mali-G52 MP2 | 32 | 800 MHz | 51,2 GFLOP/s | 28,94 | **56%** |

As duas GPUs entregam **a mesma fração do próprio pico** com o mesmo shader. A
razão de 3,25× é exatamente `2 (lanes) × 1,67 (clock) = 3,33` — ou seja, a
diferença é **só de silício**; não há penalidade de driver no R35S nem ganho
escondido na X55. Se um dos dois estivesse com o driver degradado, as duas
porcentagens não casariam.

**`many_draws` é o número que mais importa para o launcher**, e é o único que é
de CPU: 49 kdraws/s no R35S com 4000 draws por quadro dá **~12 quadros/s**; na
X55, **~23**. Um quadro com 4000 chamadas pequenas tem esse teto **mesmo com a
GPU parada** — o mesmo efeito da §12.34: a ferramenta responde uma pergunta (GPU)
e o gargalo está em outra (submissão). Fixar as CPUs em `performance` mudou este
número em **+31%** na X55; a GPU, em nada. Repare que é também o item de menor
ganho entre os dois aparelhos (1,85×), porque o que limita é a CPU, e A35→A55 é
2,68×

**`many_draws` é o número que mais importa para o launcher**, e é o único que é
de CPU: 90,7 kdraws/s com 4000 draws por quadro dá ~23 quadros/s. Um quadro com
4000 chamadas pequenas tem teto de 23 fps neste aparelho **mesmo com a GPU
parada** — o mesmo efeito da §12.34: a ferramenta responde uma pergunta (GPU) e
o gargalo está em outra (submissão). Fixar as CPUs em `performance` mudou este
número em **+31%**; a GPU, em nada.

### O que este número NÃO é

- **Não mede o R35S com o painel dele.** Tudo é offscreen, num FBO de 1280x720.
- **Não mede a tela.** Tudo é offscreen, num FBO de 1280x720; o painel da X55 é
  720x1280 e o do R35S é 640x480. De propósito: taxa de preenchimento não pode
  depender de qual painel o lote usou.
- **Não mede latência de exibição**, vsync, nem o caminho KMSDRM. Para isso
  existe `scripts/sdl-audio-probe.c` e o `--dump-frame` do launcher.

### As quatro maneiras de medir errado, todas cometidas na primeira versão

Ficam registradas porque nenhuma produziu erro — as quatro produziram número.

| Sintoma medido | Causa | Correção |
| --- | --- | --- |
| `cpu_memcpy = inf GB/s` | o compilador apagou a cópia: o destino nunca era lido | checksum com acumulador `volatile` |
| `fill 1280x720` **maior** que `640x480` (13406 vs 4426 Mpix/s) | cor constante ⇒ o panfrost troca o tile por `clear`; e tile com CRC igual não é escrito (transaction elimination) | shader lê `gl_FragCoord` e o conteúdo alterna por quadro |
| `alu = 15575 GFLOP/s` | recorrência afim (`a = a*k + c`) colapsada em forma fechada; e cálculo só de uniform é feito uma vez por quad | recorrência não-linear, semente de `gl_FragCoord` |
| `many_draws` medindo a Mesa, não o driver | `glGetUniformLocation` (busca por string) dentro do laço de 4000 desenhos | localizações resolvidas uma vez |

E a quinta, que é a mais cara de descobrir: **o lote não executa o trabalho.**
Enfileirar 200 quadros e sincronizar no fim devolve 49 ms de relógio para um
trabalho que custa 44 ms **por quadro** sincronizado um a um — e nem
`glReadPixels` força a execução do lote. Por isso `gpu-bench` mede com
`glFinish()` por quadro: taxa agregada sem sincronização, neste driver, é ficção.

**A trava contra as cinco:** todo teste limpa o FBO com cor sentinela e lê o
pixel de volta antes de publicar o número. Teste que não escreveu nada sai como
`INVALIDO`, não como número. Foi ela que denunciou três dos cinco defeitos.

---

## 8. Referências

- [`../scripts/gpu-bench.c`](../scripts/gpu-bench.c) — o benchmark e cada
  decisão de medição; `bash scripts/gpu-bench.sh <device> --run`.
- [`evaluacao-pyglet-arcade.md`](evaluacao-pyglet-arcade.md) — o estudo do arcade,
  com a medição no hardware e a correção da afirmação "a GPU é limitada".
- [`launcher.md`](launcher.md) — o contrato SDL2/KMSDRM que já funciona.
- `scripts/gles-probe.py` — o probe que mede (sem compilar nada).
- `scripts/arcade-probe/` — a prova em ambiente fechado de que o patch funciona.
- `AGENTS.md` §12.4 — pilha gráfica é opt-in por aparelho.
