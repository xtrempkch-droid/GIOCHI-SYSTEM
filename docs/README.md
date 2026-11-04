# Documentação — Giochi System

Índice da documentação técnica do projeto.

- [Arquitetura](architecture.md) — como o Buildroot, os devices e o workflow se encaixam.
- [Adicionar um dispositivo](adding-a-device.md) — passo a passo para Powkiddy X55, Steam Deck ou novo hardware.
- [Build local](building-locally.md) — como compilar no Linux/WSL2 e quais variáveis usar.
- [GitHub Actions](github-actions.md) — matriz, entradas, cache, artefatos e segredos.
- [Gravação e boot](flashing.md) — QEMU, cartão SD, eMMC e primeiros passos.
- [Canal com o Giochi app](mensagem-giochi-system.md) — **ponteiro** para o
  arquivo de conversa, que fica fora do repositório: caminho, máquina e regras de
  uso. Contrato técnico fica no `launcher.md`; decisão vira documento de
  referência, nunca fica só no chat.
- [O launcher: o que o sistema entrega](launcher.md) — SDL2/KMSDRM, stack de texto
  (as duas armadilhas: `SDL2_TTF` é pacote à parte e `DEJAVU=y` sem família instala
  zero fontes), e o que falta para a interface subir.
- [O sistema base](sistema-base.md) — o que **todo** aparelho tem e por quê:
  SSH por cabo USB (RNDIS + DHCP), OpenSSH, e as ferramentas de diagnóstico.
  Leia antes de criar um aparelho novo.
- [Powkiddy X55: primeiro boot](x55-bringup.md) — registro medido no aparelho:
  layout do cartão, linha de comando do kernel, o que passou e o que falta.
- [Powkiddy X35H: definição e limites](x35h-bringup.md) — painel ST7703 deduzido da
  sequência de init, por que 800×600 não é parâmetro de build, e como diagnosticar
  um aparelho **sem TTL, sem Wi-Fi e sem Bluetooth**.
- [Solução de problemas](troubleshooting.md) — falhas comuns de build e configuração.
- [Segurança](security.md) — senha padrão, SSH, cadeia de suprimentos e limitações.
- [Manifesto de dependências](dependencies-manifest.md) — contrato `forge.json` com o Giochi app.
- [Quiver Launcher: viabilidade](evaluacao-quiver-launcher.md) — estudo de
  integração do launcher de terceiros: licença BSL 1.1, ausência de servidor
  gráfico, Rust 1.74 vs 1.90 e RAM. **Não integrar**; o encaixe é app de loja.
- [pyglet e arcade: viabilidade](evaluacao-pyglet-arcade.md) — jogos em Python com
  gamepad. Licença BSD-3/MIT e evdev **funcionam**; falta backend de janela em
  KMSDRM no pyglet (só há X11). O remendo de geometry shader foi **medido** em
  [`scripts/arcade-probe/`](../scripts/arcade-probe/README.md) e funciona.
- [Mapas de botões](button-maps.md) — de onde vêm os códigos evdev de cada aparelho.
- [Catálogo RK3326](rk3326-catalog.md) — 15 aparelhos extraídos de device tree.
- `giochi-buttons` — ferramenta de teste de botões e eixos (`giochi-buttons --list`).
- [`giochi-init`](giochi-init.md) — a camada de boot e o que falta para ligá-la.

## Estado atual

- `qemu-aarch64`: device de referência **habilitado** para validar o pipeline ARM64.
- Drafts ARM64 **desabilitados**: `powkiddy-x55`, `powkiddy-x35s` e
  `powkiddy-x35h` (todos **RK3566**) e `r35s` (RK3326 — outro SoC, outro
  pipeline de boot).
- `steamdeck`: placeholder x86_64 **desabilitado**.
- `generic-x64`: PC comum x86_64, **desabilitado** — rascunho com
  `pc_x86_64_efi_defconfig`, nunca compilado. Serve para separar defeito do
  sistema de defeito do aparelho.
- Buildroot fixado em `2024.02` no arquivo [`buildroot.version`](../buildroot.version).
- O workflow principal gera imagens por device e publica artefatos no GitHub Actions.

O estado detalhado — o que está verificado, o que só o CI pode provar e o que
falta — fica em [`AGENTS.md`](../AGENTS.md), que é o documento a ler primeiro.

## Princípios

1. **Hardware é configuração, não código duplicado.** A pasta `device/` descreve o alvo; os scripts são compartilhados.
2. **Draft não quebra o CI.** Devices incompletos ficam com `enabled: false` até serem validados.
3. **Build reproduzível.** Versão do Buildroot, defconfig, fragmento, overlays e SHA256 ficam registrados.
4. **Nada de segredo no repositório.** Senhas vêm de variável de ambiente/secret.
5. **Caminhos com espaços são suportados.** A pasta `powkiddy x55` existe para provar isso; o build prepara overlays em um diretório sem espaços.
