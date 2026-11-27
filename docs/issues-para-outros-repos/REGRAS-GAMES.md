## Por que esta issue existe

As regras de engenharia deste projeto nasceram no repositório do sistema e
ficaram lá. As doze completas, com a medição de cada, estão em:

https://github.com/xtrempkch-droid/GIOCHI-SYSTEM/blob/main/docs/regras-para-outras-equipes.md

Este é o recorte para os **jogos**. A #1 deste repositório foi corrigida por
vocês (`Button::A => ACELERAR`, com o comentário citando a issue) e o
diagnóstico estava certo. O que segue é o que vale **além** aquele caso — as
regras que fizeram aquele defeito aparecer, e as que vão evitar o próximo.

## 1. Um mapa de botões só — e não é o do jogo

O projeto tem **um** `buttons.map` por aparelho, versionado, gerado do device
tree. O SDL2 gera um **segundo** mapa sozinho, e ele discorda do primeiro:

| Físico | código evdev | `buttons.map` | o SDL chama de |
| --- | --- | --- | --- |
| **A** (à direita) | `BTN_EAST` | `a` | `b1` = `Button::B` |
| **B** (embaixo) | `BTN_SOUTH` | `b` | `b0` = `Button::A` |
| R1 | `BTN_TR` | `direito` | `b5` |
| R2 | `BTN_TR2` | — | `b7` = `Axis::TriggerRight` |

O plástico é **A = à direita** (Nintendo); o SDL2 é **`a` = embaixo** (Xbox). Essa
inversão não é bug de ninguém — é convenção. O defeito é **manter os dois mapas**.

**Regra:** o jogo deriva a tabela dele do `buttons.map` (ou do controle virtual,
abaixo) e não escreve a sua. Um segundo mapa diverge no dia em que o primeiro
muda, e o sintoma aparece só no aparelho onde o segundo caminho está ativo.

## 2. Não somar fontes de input

O `neon-drift` fazia:

```rust
let bits_agora = botoes.bits() | gamepad.bits() | botoes_simulados;
```

Com o A apertado, o evdev acendia `ACELERAR` e o SDL acendia `FREAR` — o carro
recebia os dois. **Somar duas fontes com mapeamentos diferentes é o defeito**, e
ele existia mesmo com cada mapa correto isolado.

## 3. O sistema publica um controle de layout fixo — mirar nele

O GIOCHI-SYSTEM publica **`Giochi Gamepad`**: **um** nó com 17 botões de código
fixo e 4 eixos em `-32767..32767`, igual em todo console, com GUID estável. O
aparelho que não tem um botão fisicamente declara o código do mesmo jeito — botão
que nunca dispara é inofensivo; layout diferente não é.

Consequência para vocês: **não há `if` por aparelho a escrever.** Se um dia
precisarem, o contrato falhou e o pedido é uma issue, não um contorno.

Onde ele não existe (imagem anterior ao contrato), o certo é detectar e avisar —
o `giochi-selftest` faz isso e sai `SKIP`, porque a imagem não prometeu.

## 4. Meça no alvo, e o alvo é o pior aparelho

| Aparelho | CPU | GPU | RAM |
| --- | --- | --- | --- |
| **R35S** | RK3326, 4× Cortex-**A35** @1,3 GHz | Mali-G31 MP2 | **981 MiB** |
| X55 / X35H | RK3566, 4× Cortex-**A55** | Mali-G52 MP2 | ~2 GB |

Medido com o mesmo binário: **49,0 kdraws/s** no R35S contra **90,7** na X55. Um
quadro com 4000 draws pequenos tem teto de ~12 fps no R35S **com a GPU ociosa** —
o limite é a submissão, não o shader. Batching move esse número; shader não.

E não há swap: `OOM killer` não avisa, o aparelho reinicia. Um jogo que aloca
"o que o PC aguenta" deixa o aparelho instável sem mensagem.

## 5. O desktop mente — sempre na direção permissiva

| No desktop | No aparelho |
| --- | --- |
| SDL aceita um nó só-de-botões como joystick (via `libudev`) | **rejeita** — a imagem não tem libudev |
| `timeout` devolve 124 | busybox devolve **143** |
| `awk` tem `strtonum` | busybox **não tem** — devolve vazio, e a soma "passa" com zero |

Uma conclusão sobre entrada tirada do PC está errada antes de começar. Mas dá para
medir sem o aparelho na mão: as bitmaps de `capabilities/key`/`abs` de cada
aparelho estão versionadas no repositório do sistema, e o
`SDL_EVDEV_GuessDeviceClass` real pode ser rodado contra elas (foi assim que se
descobriu por que o R35S sofre e a X55 não).

## 6. Licença antes do recurso

A imagem assinada não leva GPL/AGPL/LGPL — e um jogo que embarca uma biblioteca
nessa licença dentro do pacote contamina o pacote pelo mesmo critério. O caminho
para quem depende disso é `distribution: store`, com o runtime no `/user`.

**E o inverso:** biblioteca permissiva não é passe livre. O `pygame` é LGPL-2.1 e
é por isso que `python3` não está na imagem — jogo que precisa de Python vai pela
loja.

## 7. Registre o que não foi testado

Um README que diz "roda a 60 fps" sem dizer **em qual aparelho** e **com qual
commit de imagem** é a mesma classe de afirmação que a issue de Bluetooth com
quatro evidências falsas. Número sem procedência é opinião.

## O que pedimos, em ordem

1. **Adotar as regras** — `docs/regras.md` no repo de vocês apontando para o
   documento base, com o commit que adotou.
2. **Nenhum mapa de botão próprio**: derivar do `buttons.map` / `Giochi Gamepad`.
3. **Não somar fontes de input**; escolher uma por execução.
4. **Medir no R35S** — é o pior aparelho da matriz — e publicar o número com o
   commit da imagem.
5. **Dizer o que não foi testado** no README de cada jogo.

Se algum item não fizer sentido no desenho de vocês, responda **com a medição** —
a primeira regra do documento é medir antes de afirmar.
