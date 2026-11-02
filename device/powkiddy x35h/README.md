# Powkiddy X35H

Variante do **X35S**, mesmo SoC (Rockchip RK3566) e mesma tela 640×480.

| Campo | Valor |
| --- | --- |
| SoC | Rockchip RK3566 |
| Arch | `arm64` |
| Tela | 640×480 |
| Device tree | **padrão ROCKNIX**, compartilhado com o X35S |
| Status | `draft` — não inicializável |

## Por que existe pasta separada

Porque o `devices.json` indexa por `id`, e ID separado permite divergir depois sem
quebrar o outro. Hoje os dois apontam para o mesmo DTS e o mesmo mapa de botões.

**Se a diferença entre X35S e X35H aparecer** (tela, painel, botões, áudio), ela
entra só na pasta que muda.

## Estado

Nada de build feito. Ver [README do X35S](../powkiddy%20x35s/README.md) para a
decisão sobre o device tree.
