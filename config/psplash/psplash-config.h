/*
 *  pslash - a lightweight framebuffer splashscreen for embedded devices.
 *
 *  Copyright (c) 2014 MenloSystems GmbH
 *  Author: Olaf Mandel <o.mandel@menlosystems.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 *  Cópia do projeto, entregue ao pacote por `config/package-overrides.mk`.
 *  O upstream não expõe estes três valores por Kconfig nem por configure: são
 *  `#define` num header do fonte, e o psplash NÃO tem opção de build para eles.
 *
 *  ## Por que este arquivo existe
 *
 *  Com a configuração padrão, o psplash desenha a imagem de fundo CENTRADA nos
 *  5/6 de cima da tela e a barra de progresso na linha de 5/6. Nossa imagem é
 *  do tamanho do painel, então era desenhada em `y = -H/12` (topo cortado), a
 *  barra caía 1/6 de tela abaixo do logo e o pedaço de baixo ficava com o creme
 *  do Yocto. Medido no X55 em 14/11/2026: texto no meio, barra solta embaixo,
 *  faixa clara no rodapé.
 *
 *  ## O que muda aqui
 *
 *  - `PSPLASH_IMG_FULLSCREEN 1`: a imagem é desenhada em (0,0) do framebuffer.
 *    Sem isso ela é centralizada em 5/6, o que desloca o logo em H/12.
 *  - split em 9/16: a barra passa a ficar em 56,25% da altura, logo abaixo do
 *    logo. É este número que `scripts/gerar-splash.mjs` usa para posicionar o
 *    texto, então os dois têm de andar juntos — `tests/bootsplash.test.mjs`
 *    compara este arquivo com o gerador.
 *
 *  Mudar o upstream quebra o build em vez de degradar em silêncio: se um destes
 *  nomes sumir, o `psplash.c` deixa de compilar.
 */

#ifndef _HAVE_PSPLASH_CONFIG_H
#define _HAVE_PSPLASH_CONFIG_H

/* Text to output on program start; if undefined, output nothing */
#ifndef PSPLASH_DISABLE_STARTUP_MSG
#define PSPLASH_STARTUP_MSG ""
#endif

/* Bool indicating if the image is fullscreen, as opposed to split screen */
#ifndef PSPLASH_IMG_FULLSCREEN
#define PSPLASH_IMG_FULLSCREEN 1
#endif

/* Bool indicated if the progress bar should be disabled */
#ifndef PSPLASH_DISABLE_PROGRESS_BAR
#define PSPLASH_SHOW_PROGRESS_BAR 1
#endif

/* Position of the image split from top edge, numerator of fraction */
#define PSPLASH_IMG_SPLIT_NUMERATOR 9

/* Position of the image split from top edge, denominator of fraction */
#define PSPLASH_IMG_SPLIT_DENOMINATOR 16

#endif
