# Solução de problemas

## `buildrootDefconfig` vazio

**Sintoma:** `ERRO: <device> não tem buildrootDefconfig definido.`

**Causa:** o device está em draft ou incompleto.

**Solução:** defina um defconfig válido em `device/<device>/device.json`. Para testar sem habilitar no CI, use `ALLOW_DRAFT=1`.

## Defconfig não encontrado

**Sintoma:** `make: *** No rule to make target '<defconfig>'`.

**Causa:** o nome não existe na versão fixada do Buildroot.

**Solução:**

- confira `buildroot/configs/<defconfig>` após baixar o Buildroot;
- confirme a versão em `buildroot.version`;
- use um defconfig existente (`qemu_aarch64_virt_defconfig`, `raspberrypi4_64_defconfig` etc.) como base;
- se o defconfig vier de uma árvore externa, ela precisa ser integrada ao build.

## Falta de dependências no host

**Sintoma:** erros de `bison`, `flex`, `libssl`, `ncurses`, `python3`, `swig` ou `make`.

**Solução:** instale as dependências de `docs/building-locally.md`. No GitHub Actions, o workflow já instala.

## Caminho com espaços

**Sintoma:** falha estranha ao aplicar overlays ou ao compilar.

**Causa:** o Buildroot não suporta espaços em alguns caminhos internos.

**Solução:** o script copia overlays para `<work>/.../giochi-system-overlays` e usa `/tmp` por padrão, mas o caminho do repositório ainda pode ser problemático em builds locais. Prefira:

```bash
cd ~/giochi-system
# ou
git clone <repo> ~/src/giochi-system
```

No GitHub Actions, o workspace não tem espaços.

## Overlay não entrou no rootfs

**Sintoma:** `/etc/motd` ou `/etc/giochi-system/device-id` não aparece.

**Verifique:**

```bash
grep '^BR2_ROOTFS_OVERLAY=' work/<device>/build/.config
```

O valor deve conter `giochi-system-overlays/00-common` e o overlay do device. Se não contiver, veja `olddefconfig.log` e `prepare-config.mjs`.

## `BR2_PACKAGE_*` desapareceu do `.config`

**Causa:** símbolo inexistente, dependência não satisfeita ou nome errado.

**Solução:** rode `make menuconfig` no Buildroot ou consulte `buildroot/package/`; use `make olddefconfig` e verifique `buildroot.config`. O Kconfig pode remover silenciosamente opções inválidas.

## Build muito lento

- O primeiro build compila a toolchain interna do Buildroot.
- Use um runner com mais CPU ou uma toolchain externa.
- Reaproveite o cache de downloads.
- Evite builds concorrentes no mesmo workspace.
- Para desenvolvimento, comece pelo `qemu-aarch64`.

## Timeout no GitHub Actions

**Sintoma:** job cancelado antes do fim.

**Solução:**

- aumente `timeoutMinutes` no device (máximo 360);
- reduza pacotes no `config/common.fragment`;
- use cache de downloads;
- considere um runner self-hosted;
- não coloque muitos devices no mesmo job.

## Artefato não encontrado

**Sintoma:** `ERRO: nenhum artefato encontrado em .../images`.

**Causa:** o padrão em `artifacts` não corresponde ao que o Buildroot gerou.

**Solução:** após um build bem-sucedido, liste `output/images/` e ajuste:

```json
"artifacts": ["Image", "rootfs.ext*"]
```

Para imagens de cartão SD, normalmente `sdcard.img`.

## `BR2_ROOTFS_OVERLAY` com espaço

O Buildroot separa overlays por espaço. Não coloque caminhos com espaços diretamente nessa variável. O script de build já resolve isso criando um staging sem espaços; se você editar a configuração manualmente, mantenha esse cuidado.

## Permissão de scripts no rootfs

Arquivos executáveis no overlay precisam do bit `+x` no Git. Em um repositório criado no Windows, confirme:

```bash
git ls-files -s <arquivo>
# 100755 = executável
```

Corrija com:

```bash
git update-index --chmod=+x <arquivo>
```

## SSH não conecta

- Confirme que a rede subiu (`ip addr`).
- Confirme que o `sshd` está rodando.
- Verifique a senha de root.
- Verifique firewall/porta 22.
- No QEMU, use `hostfwd=tcp::2222-:22` para expor a porta.

## Senha de root não funciona

- O build usa `ROOT_PASSWORD` ou o padrão `giochi`.
- A senha é definida no `.config` e aplicada ao rootfs.
- Se você alterou a imagem depois, a senha pode ter mudado.
- O `buildroot.config` do artefato tem a senha redigida; não tente recuperá-la dele.

## Buildroot tarball corrompido

Remova o cache e baixe de novo:

```bash
rm -rf /tmp/giochi-system-cache/downloads/buildroot-*.tar.gz
bash scripts/build-device.sh qemu-aarch64
```

## Cópia recursiva: o disco enche e o build morre sem mensagem

**Sintoma:** o build roda por horas, o disco vai enchendo e o processo morre. O log termina no meio de uma linha e não diz nada útil. Em casos extremos a árvore de trabalho passa de **60 GB**.

**Causa:** uma pasta copia o repositório inteiro para dentro de si mesma, em loop.

O caminho clássico no Buildroot:

```make
# NÃO FAÇA ISSO
MYAPP_SITE_METHOD = local
MYAPP_SITE = $(BR2_EXTERNAL_GIOCHI_PATH)/..   # raiz do repositório
```

O Buildroot faz `rsync` de `SITE` para `output/build/<pkg>/`. Se o diretório de saída fica **dentro** do repositório (que é o caso de `out/`), o rsync copia o próprio `output/`. Na volta seguinte esse `output/` já contém uma cópia de si mesmo, e assim por diante — crescimento exponencial. No log aparece como `Syncing from source dir` parado por muito tempo.

**Como o build avisa agora:** `build-device.sh` mede o espaço livre a cada 20 segundos durante a compilação. Se o consumo passar de 4 GiB num único intervalo, ou o espaço cair abaixo de 2 GiB, ele mata o build (inclusive os compiladores filhos, via `setsid`) e imprime o motivo com a causa provável. Ajuste com `GIOCHI_SYSTEM_GROWTH_LIMIT_MIB` e `GIOCHI_SYSTEM_ABORT_FREE_GIB`.

**Como corrigir de verdade:** nunca aponte `SITE` para a raiz do repositório. Congele as fontes numa pasta fora da árvore que será copiada:

```bash
# Snapshot das fontes, fora do que o rsync copia
mkdir -p "$OUT_DIR/pkg-src"
rsync -a --exclude 'out/' --exclude 'work/' --exclude '.git/' \
  "$ROOT/" "$OUT_DIR/pkg-src/"
```

```make
MYAPP_SITE_METHOD = local
MYAPP_SITE = $(GIOCHI_SYSTEM_PKGSRC)   # aponta para o snapshot
```

O antecessor resolveu assim: um `GIOCHI_PKGSRC` apontando para `dist/<id>/pkg-src`, com os diretórios que importam (`Makefile`, `src`, `apps`, `tools`, `assets`, `schemas`, `scripts`, `Jogos`) — e **nunca** a raiz.

**Se o disco já encheu:** apague a árvore antes de tentar de novo, senão o problema volta na próxima execução.

```bash
rm -rf /tmp/giochi-system-work /tmp/giochi-system-cache/ccache
df -h /tmp
```

## Logs

- `work/<device>/build.log` — compilação.
- `work/<device>/defconfig.log` — defconfig.
- `work/<device>/olddefconfig.log` — merge Kconfig.
- `out/<device>/build-info.txt` — versão, commit e data.
