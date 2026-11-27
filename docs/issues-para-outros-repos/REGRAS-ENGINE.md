## Por que esta issue existe

As regras de engenharia deste projeto nasceram no repositório do sistema e
ficaram lá. As doze completas, com a medição de cada, estão em:

https://github.com/xtrempkch-droid/GIOCHI-SYSTEM/blob/main/docs/regras-para-outras-equipes.md

Vale para o `GIOCHI-ENGINE` e para o `GIOCHI-ENGINE-3D` — é a mesma equipe e o
mesmo alvo. O recorte abaixo é o que mais pesou no que vocês medem e publicam.

## 1. A GPU é GLES 3.1 sem geometry shader — e declarar diferente custa caro

Medido no R35S com a **nossa** imagem (Mesa/panfrost, `commit` de 06/11/2026):

```text
GL_RENDERER        = Mali-G31 (Panfrost)
GL_VERSION         = OpenGL ES 3.1 Mesa 24.0.0
GLSL_VERSION       = OpenGL ES GLSL ES 3.10
GL_OES_geometry_shader     = NÃO
GL_OES_tessellation_shader = NÃO
GL_OES_texture_float       = SIM
```

Consequências que já afetaram decisão de produto:

- **`graphics_api_min: vulkan` é recusado** pelo validador do `forge.json`. Não é
  economia: é contrato. Godot 4 na engine entra em **Compatibility (GLES3)**.
- **geometry shader não existe** neste stack. Quem usa precisa de caminho
  alternativo, não de "talvez funcione".
- O mesmo chip no ROCKNIX entrega GLES 3.2 **com** geometry shader, porque lá
  roda o blob proprietário da ARM. A diferença não é de hardware — é de driver
  empacotado. Comparar número de outra CFW sem dizer **qual driver** é comparar
  duas coisas diferentes.

## 2. `GL_VERSION` não distingue GPU de CPU — só `GL_RENDERER` distingue

Este é o caso mais instrutivo do projeto, e é exatamente do tipo de coisa que uma
engine publica como "suportado":

```text
com panfrost:  GL_RENDERER = Mali-G31 (Panfrost)   GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
sem panfrost:  GL_RENDERER = softpipe              GL_VERSION = OpenGL ES 3.1 Mesa 24.0.0
```

**A `GL_VERSION` é idêntica.** Um teste que pergunte "tem GLES 3.1?" recebe
**sim** num aparelho renderizando na CPU de 1 GB — e o `kmscube` também roda.

**Regra:** a verificação de capacidade lê `GL_RENDERER`. E o teste tem um caso
negativo: reprovar quando o renderer é `softpipe`/`swrast`/`llvmpipe`.

## 3. Áudio: "abriu o dispositivo" não é "saiu som"

A prova de áudio neste projeto é `/proc/asound/card*/pcm0p/sub0/status` dizendo
`state: RUNNING` **com o `owner_pid` do processo que está tocando**, enquanto há
dados. "Abriu o dispositivo" e "inicializou o mixer" não provam nada — medimos as
duas coisas passando num aparelho sem som.

E o oposto também morde: `speaker-test` toca ALSA direto e funciona **num
aparelho onde o SDL2 foi compilado sem ALSA** — o SDL2 cai no backend OSS e diz
`dsp: No such audio device`. Se a engine usa SDL2, a prova tem de ser pela via do
SDL2 (`SDL_GetCurrentAudioDriver()` → `alsa`).

## 4. Um formato de imagem ausente derruba TODOS os outros

Isto é o `ADR-034` de vocês, e vale registrar do nosso lado porque muda quando o
contorno pode sair:

```c
IMG_Init(IMG_INIT_PNG | IMG_INIT_JPG)   // retorna 0 se QUALQUER flag faltar
```

Um formato ausente faz a função falhar inteira — mesmo com BMP, TGA, PNM e QOI
funcionando. O contorno de vocês (sondar formato por formato) está certo, mas é
**contorno de imagem quebrada**: se ficar depois de a imagem ser corrigida, vira
dívida permanente, sem ninguém saber quando remover.

A imagem hoje tem `libpng` e `jpeg` ligados, e o `SDL2_image` 2.8+ decodifica PNG
e JPEG pelo `stb_image` **embutido** (o marcador é `stbi_`, não `libpng` — foi
assim que um gate nosso perguntou pela coisa errada). Quando quiserem saber se o
contorno ainda é necessário, o teste é decodificar um PNG 1×1 por `IMG_Load_RW`,
não conferir a flag.

## 5. Orçamento: o R35S é o pior caso, e o limite não é o shader

| Aparelho | CPU | GPU | RAM |
| --- | --- | --- | --- |
| **R35S** | RK3326, 4× Cortex-**A35** @1,3 GHz | Mali-G31 MP2 | **981 MiB** |
| X55 / X35H | RK3566, 4× Cortex-**A55** | Mali-G52 MP2 | ~2 GB |

Medido com o mesmo binário, governors fixados (08/11/2026):

| Medida | R35S (G31) | X55 (G52) | Razão |
| --- | --- | --- | --- |
| fill 640×480 | 192 Mpix/s | 568 | 2,96× |
| alu fragment | 8,90 GFLOP/s | 28,9 | 3,25× |
| **many_draws (4000)** | **49,0 kdraws/s** | **90,7** | **1,85×** |

O item de menor ganho é o de **CPU**, e é o mais provável de limitar uma UI: no
R35S, 4000 draws pequenos por quadro dão teto de ~12 fps **com a GPU ociosa**.
Otimizar shader não move esse número. Batching move.

E a validação que dá confiança no número: as duas GPUs entregam a **mesma fração
do próprio pico** (58% e 56%) com o mesmo shader. Se uma estivesse com driver
degradado, as porcentagens não casariam.

## 6. Meça no aparelho — o desktop mente na direção permissiva

Casos medidos, todos com a mesma coisa funcionando no PC e falhando no handheld:

| No desktop | No aparelho |
| --- | --- |
| SDL aceita nó só-de-botões como joystick (via `libudev`) | **rejeita** — a imagem não tem libudev |
| `timeout` devolve 124 | busybox devolve **143** (e matar por timeout não é falha) |
| `awk` tem `strtonum` | busybox **não tem** — devolve vazio e a soma "passa" com zero |

Junto: `kmscube` é uma **animação**, não um teste que termina. Quem mede pelo
código de saída conclui "falhou" num aparelho a 60 fps.

## O que pedimos, em ordem

1. **Adotar as regras** — `docs/regras.md` no repo de vocês apontando para o
   documento base, com o commit que adotou.
2. **Publicar capacidade só o que foi medido no aparelho**, citando o commit da
   imagem. `graphics_api_min` acima do que existe faz o validador recusar — e
   abaixo entrega menos do que dá.
3. **Ler `GL_RENDERER`** em todo diagnóstico de GPU, e tratar
   `softpipe`/`swrast` como falha, não como sucesso.
4. **Registrar quando o contorno do `ADR-034` pode sair**, com a data e a
   condição — senão ele fica para sempre.
5. **Medir RSS e draws/quadro no R35S**, que é o pior caso, antes de prometer
   qualquer número de fps.

Se algum item não fizer sentido no desenho de vocês, responda **com a medição** —
a primeira regra do documento é medir antes de afirmar.
