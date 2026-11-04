# PC genérico x86_64

Alvo x86_64 para **PC comum**: o mesmo sistema dos handhelds, em qualquer
máquina com UEFI. Sem painel MIPI, sem botões de gamepad, sem rádio onboard.

Existe por um motivo prático: hoje o pipeline só foi provado em ARM64 (CI com
`qemu-aarch64`, X55 e X35H em hardware), e rodar o sistema num PC é a forma mais
barata de separar **defeito do sistema** de **defeito do aparelho**. Se a
interface quebra aqui também, não era o DTS.

> **Draft.** Registrado para não perder a decisão. **Nunca compilado.** O
> `buildrootDefconfig` está preenchido para permitir uma tentativa por dispatch
> com `allow_draft`, não porque alguém já viu esta imagem subir.

## O que está declarado

| Campo | Valor | De onde vem |
| --- | --- | --- |
| `arch` | `x86_64` | — |
| `buildrootDefconfig` | `pc_x86_64_efi_defconfig` | existe no Buildroot 2024.02 |
| `kernelCmdline` | ausente, de propósito | ver abaixo |

### Por que EFI e não BIOS

O defconfig `pc_x86_64_efi_defconfig` monta o disco com GRUB2 EFI (e traz
`dosfstools` e `mtools` para a ESP). `pc_x86_64_bios_defconfig` escreve no MBR.

Os dois não cabem no mesmo defconfig: o genimage do BIOS grava no MBR e o do EFI
precisa de uma partição FAT de sistema. Escolhemos EFI porque é o padrão em
máquina dos últimos dez anos, e algumas placas recentes não têm CSM nenhum —
BIOS legado simplesmente não boota nelas. Para uma máquina só-BIOS, a troca é de
uma linha em `device.json`.

### Por que não há `kernelCmdline`

Nos handhelds ela é obrigatória, e por um motivo concreto: sem console serial
declarado o aparelho liga e não mostra nada, e não há como diagnosticar (§12.24).
Num PC isso não vale — tem teclado e vídeo, e o kernel escolhe o console sozinho.
Declarar `console=ttyS0` num PC sem serial atrapalharia mais do que ajudaria.

O `make-sd-image.sh` **falha** sem `kernelCmdline`, e isso é correto: ele é
ferramenta de handheld. Uma imagem de PC não passa por ele.

## O que provavelmente vai quebrar na primeira tentativa

Nada disto foi medido. São as suspeitas, na ordem em que devem aparecer:

1. **Rootfs de 120M.** É o valor do defconfig da placa pc e é pequeno para o
   `config/common.fragment` (OpenSSH, fontes, SDL2). O fragmento deste aparelho
   já pede 1024M, mas o número é estimativa.
2. **`BR2_ROOTFS_POST_BUILD_SCRIPT` do defconfig.** A placa pc traz
   `board/pc/post-build.sh`. O `prepare-config` **acrescenta** o nosso script à
   lista existente em vez de substituir (§7), então os dois devem rodar — só que
   ninguém testou essa combinação.
3. **Kernel 6.1.24 do defconfig.** `BR2_LINUX_KERNEL_USE_CUSTOM_CONFIG` aponta
   para `board/pc/linux.config`. Os `CONFIG_*` do `kernel-required.txt` dos
   handhelds não se aplicam, e um `linux.fragment` próprio teria de ser escrito
   do zero contra esse kernel.
4. **`assert-config`.** Se algum símbolo do `common.fragment` não existir para
   x86_64, o build pára e **diz qual**. Esse é o comportamento correto: melhor
   falhar do que gerar imagem sem o recurso.
5. **Nada de Mesa/panfrost.** A pilha gráfica é opt-in por aparelho (§12.4).
   Num PC a GPU é outra; ligar `BR2_PACKAGE_MESA3D` aqui exige decidir driver
   (`i915`, `amdgpu`, `nouveau`, `swrast`) — e isso é escolha de imagem, não de
   pipeline.

## Como tentar

No GitHub: *Build Giochi System ARM64* → Run workflow, com

```text
device:       generic-x64
arch:         x86_64
allow_draft:  true
```

Local, em Linux com caminho sem espaços:

```bash
ALLOW_DRAFT=1 bash scripts/build-device.sh generic-x64
```

`device=all` **não** puxa este aparelho: a matriz padrão é ARM64 e ele está
`enabled: false`.

## Quiver Launcher: o candidato natural deste aparelho

O [estudo de viabilidade](../../docs/evaluacao-quiver-launcher.md) recusou o
Quiver como componente da imagem **por causa dos handhelds** — licença BSL 1.1,
ausência de servidor gráfico, Rust 1.90 e 490–770 MiB de RAM. Nada disso vale
aqui:

| Bloqueio no handheld | Aqui |
| --- | --- |
| Sem X11/Wayland/GTK | PC tem os três, e o usuário pode ter mais de um |
| 2 GB de RAM no total | 8–32 GB típicos; 700 MiB deixa de ser problema |
| Rootfs de 1 GiB | Disco de sobra, e o app nem precisa estar na imagem |
| Tela 640x480 | Monitor comum |
| Rust 1.90 contra 1.74.1 da árvore | **continua valendo** — ver abaixo |

Ou seja: **este é o alvo onde o Quiver faz sentido**, e é o primeiro motivo
concreto para o `generic-x64` existir além de separar defeito de sistema de
defeito de aparelho.

### O que ainda não fecha, e como fecha

1. **A licença.** BSL 1.1 permite build oficial não modificado para uso
   pessoal, e proíbe distribuir para terceiros. Então ele **não entra na
   imagem**: entra como aplicativo do usuário, em `/user/apps/quiver/`. A
   própria versão publicada se encarrega do próprio update.
2. **A toolchain.** `tauri 2.12.5` exige Rust 1.90 e `edition 2024`; a árvore
   está em 1.74.1. Só importa se formos **compilar** — e compilar é justamente
   o que a BSL permite ("a build you make yourself"), mas não é necessário: o
   AppImage oficial `amd64` roda neste alvo.
3. **A pilha gráfica.** O AppImage traz a sua (WebKitGTK ou CEF). No PC ela não
   conflita com nada. Ainda assim, decidir a pilha **da imagem** (§checklist)
   não tem relação com a do Quiver — são camadas diferentes.

### O que medir quando este alvo bootar

Três números decidem se a menção vira integração:

```bash
# 1. o AppImage roda em X11, em Wayland e sobre KMSDRM puro?
./QuiverLauncher-*amd64.AppImage --help

# 2. RAM real em máquina de 8 GB, com a biblioteca cheia
#    (o número deles é do Steam Deck; o nosso tem que ser medido)

# 3. o KMSDRM da imagem basta, ou é preciso X11/Wayland no rootfs?
#    Se precisar, o gate tests/graphics-stack.test.mjs já aponta a decisão.
```

Se o item 3 disser "precisa de X11/Wayland", a resposta é a mesma do handheld —
e a menção vira só "roda como app de desktop numa distro normal", não neste
alvo.

## Checklist para sair de draft

- [ ] Primeiro build passar (o `assert-config` dirá o que não existe em x86_64).
- [ ] `bzImage` + `disk.img` gerados pelo genimage, e a imagem bootar em UEFI real.
- [ ] Medir o tamanho do rootfs e corrigir o `EXT2_SIZE` com o número real.
- [ ] Decidir a pilha gráfica (KMSDRM via `i915`/`amdgpu`, ou `swrast` como piso).
- [ ] Confirmar o SSH por rede normal — `usb0`/RNDIS do sistema base é para
      handheld sem rede; num PC a ethernet já resolve, e o gadget pode não fazer
      sentido.
- [ ] Escrever `platform-generic.md` em `docs/` com o procedimento de instalação.
- [ ] **Testar o Quiver Launcher como app de usuário** (§ acima): medir se roda
      com a pilha gráfica que a imagem tiver, sem precisar de X11/Wayland no
      rootfs. É o candidato mais concreto para este alvo.
- [ ] Trocar `status` para `ready` e ligar `enabled` — **só depois** de a imagem
      ter bootado em máquina de verdade (§18).

## Status

Draft. Não use esta pasta para gerar imagem de produção ainda.
