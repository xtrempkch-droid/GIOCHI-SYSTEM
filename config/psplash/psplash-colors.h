/*
 *  pslash - a lightweight framebuffer splashscreen for embedded devices.
 *
 *  Copyright (c) 2012 sleep(5) ltd
 *  Author: Tomas Frydrych <tomas@sleepfive.com>
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 *
 *  Cópia do projeto, entregue ao pacote por `config/package-overrides.mk`.
 *
 *  ## Por que estas quatro cores moram aqui
 *
 *  A barra de progresso não é desenhada pela nossa imagem: quem pinta o miolo
 *  é o `psplash_draw_progress`, com as constantes abaixo. Sem trocá-las,
 *  qualquer barra que a gente desenhe recebe por cima um preenchimento creme
 *  (#ecece1) e cinza (#6d6d70) — a paleta do Yocto.
 *
 *  Elas também são o que o psplash usa para LIMPAR a tela antes do primeiro
 *  quadro. Com o valor padrão, todo boot desta árvore começava com um flash
 *  claro antes de o nosso fundo escuro aparecer.
 *
 *  Os valores são os mesmos de `scripts/gerar-splash.mjs` (FUNDO/TEXTO/
 *  DESTAQUE/TRILHO); `tests/bootsplash.test.mjs` confere que não divergiram.
 */

#ifndef _HAVE_PSPLASH_COLORS_H
#define _HAVE_PSPLASH_COLORS_H

/* This is the overall background color */
#define PSPLASH_BACKGROUND_COLOR 0x10,0x12,0x16

/* This is the color of any text output */
#define PSPLASH_TEXT_COLOR 0xf2,0xf4,0xf8

/* This is the color of the progress bar indicator */
#define PSPLASH_BAR_COLOR 0x3d,0x9a,0xff

/* This is the color of the progress bar background */
#define PSPLASH_BAR_BACKGROUND_COLOR 0x24,0x28,0x30

#endif
