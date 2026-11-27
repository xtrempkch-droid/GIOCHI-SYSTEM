# Pastas do usuário — onde pôr arquivos sem a loja

> Resposta curta: tudo vive em **`/user`**. As quatro pastas são:
>
> | Pasta | O que vai lá | Quem lê |
> | --- | --- | --- |
> | **`/user/games`** | jogos | o launcher |
> | **`/user/apps`** | aplicativos avulsos (um diretório por app) | o launcher |
> | **`/user/musica`** | músicas | o app de música |
> | **`/user/ports`** | ports do PortMaster | o `giochi-ports` |
>
> E `/roms` é um **symlink para `/user`** — é o nome que o PortMaster espera.

## Como copiar, os dois caminhos

**Por SSH (o cabo que carrega):**

```bash
scp -r MeuJogo/  root@10.55.0.2:/user/games/
scp   musica.mp3 root@10.55.0.2:/user/musica/
```

senha padrão de desenvolvimento: `giochi-dev` (a de release vem de
`GIOCHI_SYSTEM_ROOT_PASSWORD`, e não está nos artefatos).

**Pelo cartão, tirando ele do aparelho:** a partição de dados é a **p3**
(`GIOCHI_USER`), e é `ext4` — o Windows não a monta, e no Linux é:

```bash
sudo mount /dev/sdX3 /mnt      # p3 = dados; p2 é o sistema, não mexa
```

A p1 (`GIOCHI_BOOT`, 256 MiB, FAT) é montável em qualquer sistema — mas ela é do
**boot** (`Image`, DTB, `extlinux.conf`): não ponha jogos lá, e não a encha.

## O que cada uma espera dentro

| Pasta | Formato |
| --- | --- |
| `games/` | o launcher varre a pasta; um jogo por entrada |
| `apps/` | **um diretório por app**, com o binário dentro |
| `musica/` | arquivos de áudio soltos — o app lista as faixas |
| `ports/` | `<nome>.sh` + `<nome>/`, o layout do EmulationStation |

O layout de `ports/` não é escolha nossa: é a convenção do PortMaster, e o
`giochi-ports --rodar` aceita os dois (o instalado por ele e o feito à mão).

## A partição de dados é exFAT — copiar pelo Windows funciona

`/user` é a **terceira partição** do cartão (rótulo `GIOCHI_USER`), montada pelo
`S20userdata` no boot. O layout:

```text
  64 MiB    p1  FAT32  256 MiB  GIOCHI_BOOT   Image, DTB, extlinux.conf
 320 MiB    p2  ext4  1024 MiB  GIOCHI        sistema (NUNCA cresce, NUNCA muda de FS)
1344 MiB    p3  exFAT  o resto  GIOCHI_USER   ← seus jogos, músicas, apps
```

A p3 nasce em **exFAT** de propósito: quem tem Windows abre o cartão no Explorer
e copia para `games`, `musica` ou `apps` como em qualquer pendrive. O sistema
(p2) continua ext4, porque precisa de permissão, symlink e device node.

| `--user-fs` | Lido por | Limite | Quando usar |
| --- | --- | --- | --- |
| **`exfat`** (padrão) | Windows, macOS, Linux (kernel ≥ 5.7) | nenhum prático | o caso normal |
| `vfat` (FAT32) | **tudo** — TV, câmera, Windows antigo | **4 GiB por arquivo** | compatibilidade máxima |
| `ext4` | só Linux | nenhum | quem nunca põe o cartão no Windows |

```bash
bash scripts/build-in-container.sh --sd-image powkiddy-x55        # exFAT
bash scripts/make-sd-image.sh powkiddy-x55 --user-fs vfat         # FAT32
```

### Medido em 27/11/2026, na p3 exFAT da imagem gerada

```text
mount -t exfat -o uid=0,gid=0,fmask=0000,dmask=0000,iocharset=utf8

drwxrwxrwx  musica          rwxrwxrwx  ports/jogo.sh  → EXECUTOU
rwxrwxrwx   musica/Música.mp3            → acento preservado
```

`fmask=0000` não é detalhe: **exFAT e FAT não guardam permissão**, é o mount que
decide. Sem ele, `ports/*.sh` e o binário de um jogo não rodam — e o sintoma é
"permission denied" num arquivo que está lá.

E o custo dessa escolha, dito na frente: **em exFAT todo arquivo é 0777**. Num
aparelho onde todo processo roda como root isso não abre nada que já não
estivesse aberto; quem quiser permissão de verdade usa `--user-fs ext4`.

### O segundo cartão

Um cartão de dados no **segundo slot** também é montado em `/user`, e o critério
é o que o usuário vê: a pasta **`giochi-user`** na raiz do cartão. No Windows é
"Novo > Pasta" e renomear — dois cliques.

```bash
# no Windows: formatar como exFAT e criar a pasta giochi-user na raiz
```

Sem o marcador, o cartão **não** vai para `/user`: ele é mídia removível, e
montá-lo ali confundiria "meu save" com "o cartão do fulano".

### O primeiro boot com a partição vazia

A p3 nasce vazia. Montar por cima do `/user` do rootfs esconderia o LEIA-ME e o
que já estivesse lá — então o `S20userdata` guarda o conteúdo antes de montar e
**migra** para a partição, mas só se ela estiver vazia. Se já tiver qualquer
coisa (o save de um jogo), ele **não toca** e diz isso.

Detalhe de exFAT: a migração usa `cp -r` e não `cp -a`, porque dono e permissão
não existem lá — `cp -a` tentaria preservar e o busybox pode abortar no meio.

## O aviso que continua valendo

**Encher `/user` até o limite deixa o sistema sem espaço.** Com `--grow`, a p3
ocupa o cartão quase todo, mas o sistema (p2) tem tamanho fixo: log, PID e `/tmp`
moram nele. Se a p3 for formatada como o cartão inteiro, não há folga para nada.

E o inverso, que é o que dói mais: **sem `--grow`, a p3 fica com 704 MiB**. Dá
para um punhado de jogos, não para uma biblioteca.
