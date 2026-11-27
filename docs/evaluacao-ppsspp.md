# PPSSPP — avaliação (26/11/2026)

> **Veredito curto:** o suporte **não existe**, em nenhum sentido. Não há
> pacote, não há port, não há linha de configuração. E o PPSSPP é
> **GPL-2.0-or-later** — então, pela regra do §15 do `AGENTS.md`, ele **não pode
> entrar na imagem assinada**. O caminho é o mesmo do PortMaster: **app de loja
> em `/user`**, nunca na imagem.
>
> O que falta para dizer "funciona" é uma medição que ninguém fez ainda: **quantos
> fps um Cortex-A35 roda**. Tudo abaixo é medido, exceto isso — e o que não foi
> medido está marcado.

---

## 1. Não existe nada hoje — medido

```console
$ grep -rin "ppsspp\|psp" --include="*.md" --include="*.mjs" --include="*.sh" \
      --include="*.fragment" --include="*.json" . | grep -vi splash
(nada)

$ ls -d $BR2/package/ppsspp $BR2/package/libretro-ppsspp
(nenhum dos dois)

$ gh api /repos/PortsMaster/PortMaster-New/contents/ports --jq length
1000
$ ... | grep -i psp
(nenhum port de PSP entre os 1000)
```

Três buracos independentes, e é importante que sejam três:

| Onde | Estado |
| --- | --- |
| `GIOCHI-SYSTEM` (esta árvore) | zero menção a PPSSPP ou PSP |
| Buildroot 2025.02 | **não tem** pacote `ppsspp` nem `libretro-ppsspp` |
| PortMaster (1000 ports) | **não tem** PPSSPP — não é um "port", é um emulador |

Ou seja: não adianta habilitar símbolo no `defconfig`, porque não há símbolo.
Quem quiser PPSSPP tem de **trazer o pacote**.

## 2. O bloqueio é de licença, e ele vem primeiro

O `LICENSE.TXT` do repositório oficial, linhas 328-329:

```text
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.
```

E a receita do ROCKNIX para o mesmo emulador confirma de forma independente:

```make
PKG_LICENSE="GPL-2.0-or-later"
```

A regra do projeto (`AGENTS.md` §15) é explícita: **GPL, AGPL e LGPL ficam fora
da imagem assinada**. O mesmo critério que barrou o `gptokeyb2` do PortMaster e o
`libmali` da ARM barra o PPSSPP.

Isso não é limitação técnica — é a mesma separação de três perguntas que o §32
registrou:

| Pergunta | Resposta |
| --- | --- |
| dá para **embarcar** na imagem? | **não** — GPL-2.0-or-later |
| dá para **instalar** em `/user`? | **sim** — o app baixa, e a licença é dele |
| dá para **rodar** neste hardware? | **não medido** (§5) |

## 3. O binário oficial existe, e as bibliotecas ele já tem

O PPSSPP publica, no release `v1.20.4` (16/05/2026), exatamente **um** pacote
Linux:

```text
PPSSPP-v1.20.4-anylinux-aarch64.AppImage       46,3 MB
PPSSPP-v1.20.4-anylinux-x86_64.AppImage        48,3 MB
ppsspp-1.20.4.tar.xz                           58,0 MB   (fonte)
```

E o que ele precisa **já está** na nossa imagem — medido no `target/` do R35S:

| Biblioteca | Na imagem? |
| --- | --- |
| `libSDL2-2.0.so.0` | **sim** |
| `libEGL.so` | **sim** |
| `libGLESv2.so` | **sim** |
| `libpng16.so` | **sim** |
| `libfreetype.so` | **sim** |
| `libzip` | pacote existe no Buildroot, **não** está ligado |
| `zlib` | idem |

E o backend gráfico: PPSSPP aceita **GLES 3.0** (o `GLFeatures.cpp` trata
`GLES3` e escolhe GLSL por versão de 3.0 a 3.3). O nosso panfrost entrega
**GLES 3.1 + GLSL ES 3.10**, medido no R35S em 06/11/2026 (§18, item 2).
**Compatível**, inclusive sem geometry shader — que o PPSSPP não usa.

## 4. Dois caminhos, e o que cada um custa

### A — AppImage em `/user` (zero build, o mais barato)

Baixar 46,3 MB, deixar em `/user/apps/ppsspp/`, e o launcher lança.

**O que falta:** `CONFIG_FUSE_FS` é **`=m`** no kernel dos três aparelhos, e
**nenhum deles carrega módulo por autoload** — o `S15modules` não está no overlay
comum, e o R35S não tem overlay com ele. É o §12.43/§12.51 de novo: módulo no
disco, ninguém o carrega, e o sintoma é `fusermount: fuse device not found`, que
não aponta para kernel.

Duas saídas, ambas de uma linha:

| Saída | Efeito |
| --- | --- |
| `CONFIG_FUSE_FS=y` no `linux.fragment` dos três | funciona sempre; ~40 KB de kernel |
| `S15modules` no overlay comum com `modprobe fuse` | sem rebuild de kernel, mas depende de script |

Terceira possibilidade, sem tocar em nada: `--appimage-extract-and-run`, que
descompacta em vez de montar. **Não verificado** — o runtime do AppImage aarch64
precisa executar, e isso só se mede no aparelho.

### B — compilar do fonte como pacote (o que o ROCKNIX faz)

A receita deles é curta e não tem surpresa:

```make
PKG_DEPENDS_TARGET="toolchain libzip SDL2 zlib"
PKG_CMAKE_OPTS_TARGET=" ... -DUSING_FBDEV=ON -DUSING_GLES2=ON \
                        -DBUILD_SHARED_LIBS=OFF -DUSE_SYSTEM_LIBPNG=OFF ..."
```

Custo: build de C++ grande (o tarball do fonte é 58 MB; o build ocupa alguns
GB e leva ~30-50 min num runner). Ganho: binário nativo, sem FUSE, sem AppImage
para explicar, e atualização pela loja como qualquer app.

**Onde ele NÃO pode morar:** em `config/`, `device/*/defconfig` ou em qualquer
fragmento da imagem. O teste (§6) reprova se alguém tentar.

## 5. O que decide de verdade, e ninguém mediu: o hardware

| Aparelho | CPU | GPU | RAM | PPSSPP? |
| --- | --- | --- | --- | --- |
| **R35S** | RK3326, 4× Cortex-**A35** @1,3 GHz | Mali-**G31** MP2 | 981 MiB | ? |
| **X55 / X35H** | RK3566, 4× Cortex-**A55** | Mali-**G52** MP2 | ~2 GB | ? melhor |

O R35S é o pior caso da árvore. O benchmark de 08/11/2026 (§12.63) mediu o
**G31 a 192 Mpix/s de fill** contra **260 Mpix/s** do G52 — 1,35× a menos por
pixel, e a CPU A35 é bem mais fraca que a A55. PPSSPP num A35 é o cenário em que
a comunidade relata **10-30 fps** nos jogos leves, e menos nos pesados.

**Não medi isso, e não vou afirmar.** Medir exige o aparelho ligado, um ISO de
PSP e cerca de 20 minutos:

```bash
# no aparelho, com o PPSSPP instalado
PPSSPP/PPSSPPSDL --version
# e um jogo leve: medir fps no canto da tela + /proc/loadavg
```

O que já se sabe é o **teto**, e ele é baixo: 981 MiB de RAM compartilhada com o
launcher, e um G31 que entrega menos de 600 Mpix/s. Jogo de PSP que dependa de
framebuffer effects (o caso comum) vai sofrer.

## 6. O que prende este documento

`tests/ppsspp.test.mjs` (5 casos) fixa o que foi medido:

| Caso | O que impede |
| --- | --- |
| nenhum fragmento/defconfig cita PPSSPP | GPL na imagem assinada (§15) |
| o documento cita `GPL-2.0-or-later` **com** a fonte | alguém "esquecer" o bloqueio |
| o documento declara o que **não** foi medido | prometer fps que ninguém viu |
| os 3 aparelhos continuam com o caminho de app em `/user` | virar pacote da imagem pela porta dos fundos |
| `CONFIG_FUSE_FS=m` está registrado como pendência | o AppImage falhar sem que a causa esteja escrita |

## 7. Resumo do que fazer, em ordem

1. **Decidir o caminho** (A AppImage ou B compilar). A é 10 minutos e depende de
   FUSE; B é 1 build e não depende.
2. **Resolver o FUSE** se for A — uma linha, e é defeito latente hoje: **nenhum**
   AppImage roda em aparelho nenhum desta árvore.
3. **Medir fps no R35S.** Sem isso, qualquer promessa é chute — e o pior cenário
   é entregar o emulador e o usuário descobrir que o aparelho não roda.
4. **Só depois** considerar a X55/X35H, onde o A55 + G52 muda a conversa.
