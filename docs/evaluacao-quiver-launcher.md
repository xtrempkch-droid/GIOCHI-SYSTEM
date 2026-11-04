# Quiver Launcher — estudo de viabilidade

Avaliação de <https://github.com/tgeorgiadis/quiver-launcher> como launcher do
Giochi System. Medido em 04/11/2026 contra a versão `4.0.0-beta.3`.

> **Veredito: não integrar.** Quatro bloqueios independentes, e **qualquer um
> deles sozinho já impede**. O primeiro é jurídico e não tem contorno técnico; os
> outros três custariam meses para virar viáveis.
>
> O que **é** viável — e provavelmente é o que se quer de verdade — está no fim:
> o usuário instala pelo nosso contrato de loja, ou usamos a versão 3, que é MIT.

---

## 1. O que o projeto é, em fatos

| Item | Valor |
| --- | --- |
| Stack | **Tauri 2** (Rust) + React 19 + Vite |
| Runtime de UI no Linux | WebKitGTK, ou CEF (Chromium) — ver §3 |
| Licença | **Business Source License 1.1** (não é open source) |
| Versão | `4.0.0-beta.3`, em beta |
| Origem | fork do `GithubLauncher`, do SirDiabo |

O que ele faz: catálogo de jogos publicados em releases do GitHub/GitLab,
download com checksum verificado, instalação, atualização, biblioteca pessoal,
playlists, mods (Thunderstore/GameBanana), "TV mode" para controle e login
opcional para sincronizar.

Funcionalmente é **muito próximo** do que o `Giochi app` já desenhou. Isso é
argumento a favor do desenho de vocês, não a favor de embarcar o binário deles.

---

## 2. Bloqueio 1 — a licença (decisivo, sem contorno técnico)

O README diz "source-available", e o texto da BSL 1.1 é explícito. O
`Additional Use Grant` permite uso em produção **só** se as duas condições
valerem:

```text
1. You use either (a) an unmodified official build distributed by the Licensor
   ... or (b) a build you make yourself from source code published by the
   Licensor, with or without your own modifications.

2. You use that build for your own personal purposes or your organization's
   internal purposes, and do not offer the Licensed Work to third parties as a
   product or service.

This Additional Use Grant does not permit production use of unofficial builds
distributed by third parties...
```

**O Giochi System entrega imagem para terceiros.** Embutir o Quiver na imagem
assinada é exatamente "offer the Licensed Work to third parties as a product".
Não é zona cinzenta: a condição 2 proíbe.

Três detalhes que mudam a leitura:

- **BSL é pior que copyleft para nós.** A regra deste repositório recusa GPL,
  AGPL e LGPL na imagem assinada — e a BSL é mais restritiva ainda: nem open
  source é. Integrar por "não é GPL, então pode" seria inverter a regra.
- **Cada versão vira MIT um ano depois** de publicada (`Change Date`). O
  `4.0.0-beta.3` ainda não chegou lá. Esperar é uma opção, mas significa
  integrar uma versão congelada de um ano atrás.
- **A versão 3 é MIT** — conferido na branch `v3`, com Copyright de SirDiabo e
  Thomas Georgiadis. Essa é a única porta de entrada legal para reutilizar
  código hoje.

O nome, logo e ícones têm política de marca separada (`TRADEMARKS.md`), então
mesmo sob MIT a identidade visual não vem junto.

---

## 3. Bloqueio 2 — a arquitetura de vídeo não existe na nossa imagem

Quiver é um aplicativo de **desktop**. No Linux ele precisa de servidor gráfico:

| O que ele usa | Evidência |
| --- | --- |
| GTK3 + WebKitGTK (ou CEF/Chromium) | `Cargo.toml`: `gtk = "0.18"`, `webkit2gtk` `v2_40` |
| Wayland **no build**: `wayland-client`, `gdkwayland-sys`, `wayland-protocols` | `[target.'cfg(target_os = "linux")'.dependencies]` |
| **X11** no Flatpak: `--socket=x11` | `com.quiverlauncher.QuiverLauncher.yml` |
| `xdg-desktop-portal` para diálogos de arquivo | `tauri-plugin-dialog` com `xdg-portal` |
| **D-Bus Secret Service** (`gnome-keyring`) para o keyring | `keyring` com `sync-secret-service`; Flatpak pede `--talk-name=org.freedesktop.secrets` |

Nossas imagens, por desenho, **não têm nada disso**: `grep -cE
"XORG|WAYLAND|GTK|WEBKIT|DBUS"` devolve **0** no fragmento comum e nos dois
defconfigs de handheld. O caminho gráfico é SDL2 + **KMSDRM** direto no DRM,
sem compositor — e isso é deliberado, não dívida (§12.4, §12.23).

O próprio projeto confirma o ambiente que espera: os números de desempenho dele
foram medidos num **gamescope** (compositor Wayland) no Steam Deck, e o
`CEF-SPIKE.md` registra que no "Game Mode" **não existe portal de FileChooser** —
ou seja, ele assume a ausência de partes do desktop e degrada, mas não assume a
ausência do compositor.

### O caminho existiria, e custa caro

Descoberta relevante desta análise: **não é impossível**.

- `BR2_PACKAGE_MESA3D_OPENGL_EGL` já faz `select BR2_PACKAGE_HAS_LIBEGL_WAYLAND`
  — e o X55/X35H já ligam `MESA3D_OPENGL_EGL`. Então o GTK3 **pode** ser
  selecionado no Kconfig (ele exige `HAS_LIBEGL_WAYLAND || HAS_LIBGL`).
- O Buildroot 2024.02 tem `cage` (`package/cage`), compositor kiosk baseado em
  wlroots que roda **um app em tela cheia** sobre o backend DRM. É o encaixe
  natural: `cage` no DRM → Wayland → GTK3/WebKitGTK → Quiver.

A pilha a acrescentar seria, então: `cage` + `wlroots` + `wayland` +
`wayland-protocols` + `libgtk3` (backend Wayland) + `webkitgtk` + `cairo` +
`icu` + `libsoup3` + `libsecret` + `libgcrypt` + `libxslt` + `enchant` +
`harfbuzz` + `sqlite` + `webp` + `woff2` + `libseccomp` + `dbus` — mais o app.

`webkitgtk` sozinho já faz `select` de 12 desses. É uma mudança de imagem, não
um pacote a mais.

---

## 4. Bloqueio 3 — a toolchain da árvore é 16 versões de Rust atrás

| Requisito | Quiver pede | Buildroot 2024.02 tem |
| --- | --- | --- |
| Rust | **1.90** (`rust-version` do workspace do tauri 2.12.5) | **1.74.1** (`package/rust`, `package/rust-bin`) |
| Edição de Rust | **2024** (exige ≥ 1.85) | 2021 |
| Node.js | **22** (CONTRIBUTING) | **20.11.1** |
| WebKitGTK | **≥ 2.40** (feature `v2_40`) | 2.42.5 — **OK** |

O único item que já atende é o WebKitGTK. Rust 1.90 dentro do Buildroot 2024.02
não é trocar um número: é subir o pacote `rust` (que se auto-hospeda em estágios)
e o `rust-bin`, com o risco de arrastar todo mundo que depende de Rust na árvore.
Node 22 é o mesmo problema em menor escala.

O `CONTRIBUTING.md` do projeto também exige **CMake** (o build compila SDL do
zero para os controles) e, para os testes de e2e, `webkit2gtk-driver` + `xvfb` —
um X virtual, que é mais uma peça de desktop.

---

## 5. Bloqueio 4 — cabe no papel, não no aparelho

Números medidos por eles no Steam Deck (`CEF-SPIKE.md`), não estimativa nossa:

| | WebKitGTK | CEF (Chromium) |
| --- | --- | --- |
| Download (AppImage) | 82,6 MiB | 183,7 MiB |
| Memória (PSS), assentado | 490–560 MiB | 700 MiB |
| Memória depois de usar | 690–770 MiB | 915–950 MiB (picos de **1,0–1,3 GiB**) |

Contra o nosso hardware:

- **X55: 2 GB de RAM no total** (`DRAM: 2 GiB` medido no U-Boot). O launcher
  pediria **25–38 %** da memória só para existir, e **até 65 %** no pico — antes
  de o jogo rodar. Num handheld, o launcher e o jogo dividem o mesmo 2 GB.
- **X35H: 964 MB**, medido no aparelho pelo time do app em 04/11/2026. Com
  ~1 GB efetivo o WebKitGTK assentado (490–560 MiB) já consome **mais da
  metade** da RAM, e o CEF no pico (**1,0–1,3 GiB**) **não caberia** — nem
  contando com swap, que num cartão SD seria pior que não ter. Este número
  fecha a discussão para o X35H: não é "apertado", é inviável.
- **Rootfs de 1 GiB:** 82–183 MiB de launcher é 8–18 % do rootfs, e a pilha
  WebKitGTK+GTK3+cage soma bem mais que o binário do app.
- **Tela do X35H: 640x480.** Uma UI React com capas de jogo, filtros e mods
  nessa resolução é apertada — e o projeto mediu 25 % de letterbox em 4:3
  (resolvido do lado deles depois, com layout adaptativo).

Nada disso é opinião: são números deles contra a ficha do nosso hardware.

---

## 6. O caminho que funciona: o usuário instala, não a imagem

Isto resolve os quatro bloqueios de uma vez, e **já está previsto no contrato**:

- o `Giochi app` declara `distribution: store`, e o pacote mora em
  `/user/apps/<slug>/`, fora do rootfs assinado;
- a BSL permite uso em produção de **build oficial não modificado** para uso
  pessoal — que é exatamente o que o usuário faz ao instalar para si;
- a imagem não carrega WebKitGTK, nem cage, nem 183 MiB, nem o Rust 1.90;
- e no `generic-x64` (PC comum, que **tem** X11/Wayland, D-Bus e 16 GB de RAM)
  ele rodaria bem — como qualquer outro aplicativo de desktop.

Ou seja: **Quiver é um app de loja, não um componente de imagem.** Para o
handheld ele esbarra na RAM e no KMSDRM; para o PC ele funciona como qualquer
binário de usuário.

---

## 7. O que vale aproveitar mesmo sem integrar

1. **A versão 3 é MIT.** Se a ideia é reutilizar código de catálogo/download, é
   o único ponto de partida legal. Mesma stack (Tauri), mesmos bloqueios 2–4.
2. **O conjunto de features valida o desenho do `Giochi app`**: catálogo,
   checksum verificado por release, atualização, biblioteca, playlists, mods.
   O `forge.json` já cobre `graphics_api_min` e `distribution`; a peça que falta
   do nosso lado continua sendo a mesma de sempre — `giochi-controllers` e o
   launcher, que são do app.
3. **A lição de arquitetura**: eles rodam sobre um compositor (`gamescope`), não
   sobre KMSDRM. Se um dia o Giochi OS quiser uma UI web, a decisão de
   arquitetura é "compositor Wayland + WebKitGTK" **antes** de escolher o app —
   e o custo está na tabela do §3.

---

## 8. Recomendação

| Pergunta | Resposta |
| --- | --- |
| Embarcar o Quiver 4 na imagem? | **Não** — a BSL proíbe distribuir para terceiros |
| Embarcar o Quiver 3 (MIT)? | Não por licença; **não** por RAM, KMSDRM e toolchain |
| Oferecer na loja para `generic-x64`? | **Sim**, é o encaixe correto |
| Adotar a arquitetura (cage + WebKitGTK)? | Só se a UI web virar requisito de produto, com o custo do §3 assumido |
| Reabrir isto quando? | Se a versão que interessar já tiver passado o `Change Date` (MIT), **e** se o alvo for o PC |

Se algum dia essa decisão for reaberta, os três números que decidem são: **RAM
do aparelho**, **custo em MiB da pilha WebKitGTK no rootfs de 1 GiB**, e
**versão do Rust na árvore**. Dois dos três já estão medidos:

| Número | Estado |
| --- | --- |
| RAM do X35H | **964 MB** (medido no aparelho, 04/11) — fecha a questão para esse aparelho |
| RAM do X55 | **2 GiB** (medido no U-Boot) |
| Custo da pilha WebKitGTK no rootfs | **não medido** — exigiria um build de teste com GTK3+cage |
| Rust na árvore | **1.74.1**; o app pede 1.90 |

Ou seja: a conversa só recomeça do zero se alguém aparecer com um aparelho de
**4 GB ou mais** e disposição de subir o Rust. Em 2 GB ou 1 GB, os números já
responderam.
