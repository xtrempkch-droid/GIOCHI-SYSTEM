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

## 6. O número que ainda falta

Tudo acima comparou o **hardware** (medido no R35S, mas com o blob da ARM) com o
**Mesa 24.0.0 da nossa árvore** (lido no `features.txt`). O que nunca foi medido
é o **panfrost rodando**: `GL_VERSION` real, `MAX_SAMPLES`, e a confirmação de
que a extensão de geometry shader **não** aparece.

Isso exige a nossa imagem num aparelho livre, ou o A/B `rmmod mali_kbase` +
`modprobe panfrost` num aparelho que possamos congelar por alguns minutos.

O A/B é o experimento mais barato e o mais informativo: **mesmo aparelho, mesmo
jogo, dois drivers.** Se o panfrost entregar GLES 3.1 com compute e sem geometry
shader, o quadro acima está confirmado e a decisão fecha. Se entregar menos que
isso (por exemplo, GLES 3.0 sem compute), o item "Godot Compatibility" precisa ser
reavaliado — e essa seria uma descoberta que muda o roadmap, não um detalhe.

Comando, quando houver aparelho livre:

```bash
# no aparelho
rmmod mali_kbase && modprobe panfrost
python3 gles-probe.py
```

---

## 7. Referências

- [`evaluacao-pyglet-arcade.md`](evaluacao-pyglet-arcade.md) — o estudo do arcade,
  com a medição no hardware e a correção da afirmação "a GPU é limitada".
- [`launcher.md`](launcher.md) — o contrato SDL2/KMSDRM que já funciona.
- `scripts/gles-probe.py` — o probe que mede (sem compilar nada).
- `scripts/arcade-probe/` — a prova em ambiente fechado de que o patch funciona.
- `AGENTS.md` §12.4 — pilha gráfica é opt-in por aparelho.
