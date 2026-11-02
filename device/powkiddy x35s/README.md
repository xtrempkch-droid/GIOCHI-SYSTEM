# Powkiddy X35S

Console portátil Rockchip **RK3566**, tela 640×480.

| Campo | Valor |
| --- | --- |
| SoC | Rockchip RK3566 |
| Arch | `arm64` |
| Tela | 640×480 |
| Device tree | **padrão ROCKNIX** (decidido em 02/11/2026) |
| Status | `draft` — não inicializável |

## Estado

Nada de build feito. O que existe aqui:

- `buttons.map` — **herdado do antecessor**, não conferido no DTS do ROCKNIX
- `buildroot.fragment` — vazio, de propósito

Falta: `buildrootDefconfig`, DTS/DTB, U-Boot, genimage, partições, firmware de
Wi-Fi/Bluetooth e validação em hardware.

## Decisão sobre o device tree

**Usar o DTB do padrão ROCKNIX.** Ele funciona em hardware real para X55, X35S e
X35H, e evita manter DTS próprio para três aparelhos.

Consequência prática: o DTS vem de fora do repositório. Precisa ser baixado do
ROCKNIX e versionado em `device/powkiddy x35s/` (DTS completo, não patch) para o
build ser reproduzível sem depender de rede.

Ver [docs/button-maps.md](../../docs/button-maps.md) para como extrair o mapa do
DTS.
