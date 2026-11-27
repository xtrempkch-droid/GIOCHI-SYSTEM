## Por que esta issue existe

As regras de engenharia deste projeto estavam no `AGENTS.md` de **um** repositório. As outras equipes recebem o resultado delas — e o `Giochi app` é a que mais depende disso: o launcher é a **primeira coisa que o usuário vê** e a última que segura o aparelho quando algo dá errado.

Este texto é o recorte para vocês. As doze regras completas, com a medição de cada uma, estão em:

https://github.com/xtrempkch-droid/GIOCHI-SYSTEM/blob/main/docs/regras-para-outras-equipes.md

Nada aqui é pedido de mudança de arquitetura. São armadilhas **medidas** no aparelho, e cada uma já custou tempo de alguém.

## 1. O launcher já libera o DRM — e isso é um contrato, não um detalhe

KMSDRM é **exclusivo**: um processo por vez é master. Quando o launcher lança um filho, ele faz:

```rust
let estado = app.encerrar();   // o Painter morre aqui e o DRM é liberado
system::lancar_com_saida(&alvo, Some(&map))
```

Isso está correto e resolve o problema. O que acontece em volta é que confunde:

- quando o `giochi-ports` é chamado **por fora** do ciclo do launcher, ele recebe `kmsdrm not available` — corretamente. O filho não pode ser master enquanto o pai é.
- entre `encerrar()` e o filho abrir o vídeo existe uma janela. Se o filho falhar nela, a tela fica preta sem mensagem. **Nossa parte** já grava `/run/giochi/launcher-parado` com `motivo=`, `quedas=` e `ultimo_status=`; vale consumir esse arquivo e mostrar algo na tela em vez de deixar o aparelho mudo.

## 2. Não abrir todos os `event*`

Medido no R35S com o launcher no ar: `/proc/<pid>/fd` tinha `event0`, `event1` e `event2` abertos.

| Nó | O que é de verdade |
| --- | --- |
| `event0` | jack de fone (`rk817 Headphones`) — **não** é controle |
| `event1` | **teclado** de volume (`KEY_VOLUMEUP/DOWN`) |
| `event2` | o controle |

Ler `event1` como navegação produz exatamente o sintoma "os botões viraram teclado" — só que são as teclas de volume. E `event0` não gera botão nenhum.

**Pedido:** enumerar por **capacidade** (tem `BTN_GAMEPAD`/`BTN_SOUTH`? tem `EV_ABS`?), não por existência do nó.

## 3. Um mapa de botões só, e ele não é de vocês

O projeto tem **um** `buttons.map` por aparelho, versionado, gerado do device tree. O SDL2 gera um **segundo** mapa sozinho, e ele discorda:

| Físico | código evdev | `buttons.map` | o SDL chama de |
| --- | --- | --- | --- |
| **A** (direita) | `BTN_EAST` | `a` | `b1` = `Button::B` |
| **B** (baixo) | `BTN_SOUTH` | `b` | `b0` = `Button::A` |
| R1 | `BTN_TR` | `direito` | `b5` |
| R2 | `BTN_TR2` | — | `b7` = `Axis::TriggerRight` |

A convenção do plástico é **A = à direita** (estilo Nintendo); a do SDL2 é **`a` = embaixo** (estilo Xbox). O sistema já publica um controle virtual, **`Giochi Gamepad`**, de layout fixo em todo console, com GUID estável e um `gamecontrollerdb.txt` que mapeia `a:b1` — ou seja, alinhado ao plástico.

**Pedido:** preferir o `Giochi Gamepad` na enumeração e **não somar** fontes de input. Somar duas fontes com mapeamentos diferentes foi o defeito do `neon-drift` (issue irmã no repo dos jogos): o mesmo botão acendia acelerar e frear.

## 4. Três armadilhas de ambiente, todas medidas

| Sintoma | Causa real |
| --- | --- |
| `No available video device` | o `pysdl2` resolve o SDL2 de `exlibs/sdl2` (a cópia do pacote, **sem KMSDRM**). `PYSDL2_DLL_PATH=/usr/lib` resolve |
| `Argument list too long` em **todo** `exec` | `SDL_GAMECONTROLLERCONFIG` com um DB de 472 KB. O limite `MAX_ARG_STRLEN` é **128 KB** — não dá para passar payload por variável de ambiente |
| o app abre e fecha em menos de 1 s, sem erro | arquivo de "reinicie" que sobreviveu à execução anterior |

E uma que é da plataforma, não de vocês: `SDL_GAMECONTROLLERCONFIG_FILE` (a variável de **caminho**) **não funciona** neste SDL; a de **conteúdo** funciona. Medido duas vezes.

## 5. Orçamento de memória — medido, não estimado

| Aparelho | RAM | GPU |
| --- | --- | --- |
| **R35S** | **981 MiB** | Mali-G31 MP2 |
| X55 / X35H | ~2 GB | Mali-G52 MP2 |

Nenhum tem swap. Um launcher de 200 MB de RSS + um jogo de 400 MB já é metade do aparelho mais apertado, e o `OOM killer` não avisa — o aparelho reinicia.

E o teto de CPU para desenho, medido com o mesmo binário nos dois: **90,7 kdraws/s** na X55 e **49,0** no R35S (4000 draws pequenos). Ou seja: no R35S um quadro com 4000 elementos tem teto de ~12 fps **com a GPU ociosa** — o que limita é a submissão, não o shader.

**Pedido:** medir RSS e draws por quadro **no aparelho**, não no desktop.

## 6. Licença: a loja é o caminho, e ela precisa ser honesta

A imagem assinada não leva GPL/AGPL/LGPL. O que é bloqueado na imagem pode ser
instalado pelo usuário — e a loja é quem faz isso. Duas consequências para vocês:

1. **sideload tem de aparecer como sideload.** Um app que baixa e executa script de terceiro como root (é o caso do PortMaster, que monta squashfs) não pode ter o mesmo selo de um pacote assinado. O pedido concreto está na issue de PortMaster.
2. **o que o app empacota herda a licença dele.** Um runtime GPL dentro de um `.giochi` continua GPL.

## 7. Teste no aparelho, e escreva o que não testou

O desktop mente sempre na mesma direção — é mais permissivo. O caso mais claro: no
PC, o SDL aceita um nó só-de-botões como joystick (via `libudev`); no aparelho ele
**rejeita**, porque a imagem não tem libudev. Uma conclusão tirada do desktop
sobre comportamento de entrada está errada antes de começar.

E quando não der para medir, `SKIP` com o motivo vale mais que `PASS`. Um `FAIL`
falso é pior que teste nenhum: na terceira vez o operador ignora o bloco inteiro,
inclusive quando ele está certo.

## O que pedimos, em ordem

1. **Adotar as regras** — criar `docs/regras.md` (ou `AGENTS.md`) no repo de vocês, apontando para o documento base, e citar o commit que adotou. É o que faz a regra sobreviver à próxima sessão.
2. **Consumir `/run/giochi/launcher-parado`** quando o launcher desistir de reiniciar, e dizer na tela por quê.
3. **Enumerar entrada por capacidade**, preferindo o `Giochi Gamepad`, e não somar fontes.
4. **Não passar payload por variável de ambiente** (limite de 128 KB).
5. **Medir RSS e draws no aparelho** e publicar o número.

Se algum item não fizer sentido no desenho de vocês, responda **com a medição** — a regra que mais vale aqui é a primeira: medir antes de afirmar.
