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

## Checklist para sair de draft

- [ ] Primeiro build passar (o `assert-config` dirá o que não existe em x86_64).
- [ ] `bzImage` + `disk.img` gerados pelo genimage, e a imagem bootar em UEFI real.
- [ ] Medir o tamanho do rootfs e corrigir o `EXT2_SIZE` com o número real.
- [ ] Decidir a pilha gráfica (KMSDRM via `i915`/`amdgpu`, ou `swrast` como piso).
- [ ] Confirmar o SSH por rede normal — `usb0`/RNDIS do sistema base é para
      handheld sem rede; num PC a ethernet já resolve, e o gadget pode não fazer
      sentido.
- [ ] Escrever `platform-generic.md` em `docs/` com o procedimento de instalação.
- [ ] Trocar `status` para `ready` e ligar `enabled` — **só depois** de a imagem
      ter bootado em máquina de verdade (§18).

## Status

Draft. Não use esta pasta para gerar imagem de produção ainda.
