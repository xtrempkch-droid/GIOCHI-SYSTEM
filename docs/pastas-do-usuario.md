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

## A partição de dados existe desde 26/11/2026

`/user` agora é a **terceira partição** do cartão (rótulo `GIOCHI_USER`), montada
pelo `S20userdata` no boot. O layout:

```text
  64 MiB    p1  FAT32  256 MiB  GIOCHI_BOOT   Image, DTB, extlinux.conf
 320 MiB    p2  ext4  1024 MiB  GIOCHI        sistema (NUNCA cresce)
1344 MiB    p3  ext4  o resto  GIOCHI_USER   ← seus jogos, músicas, apps
```

E a divisão é a que você pediu: **sistema do tamanho da imagem, dados do tamanho
do cartão**. Regravar a imagem reescreve a p1 e a p2 — a **p3 não é tocada**,
então seus arquivos sobrevivem.

| Gravação | p3 |
| --- | --- |
| `flash-sd.sh <img> /dev/sdX` | 704 MiB (o que cabe na imagem de 2 GiB) |
| `flash-sd.sh <img> /dev/sdX --grow` | **o cartão quase todo** |

Medido em 26/11/2026 num cartão de 116 GiB com `--grow`: a p3 foi de 704 MiB
para ~115 GiB. O `--grow` cresce a **última** partição — que agora é a de dados,
e não mais o rootfs.

### O segundo cartão

O aparelho tem dois controladores SD. Um cartão de dados no **segundo slot**
também é montado em `/user` — desde que tenha o rótulo `GIOCHI_USER`:

```bash
# formatar um segundo cartão como dados (no PC)
sudo mkfs.ext4 -L GIOCHI_USER /dev/sdX1
```

Se os dois cartões tiverem o rótulo, o `S20userdata` **prefere o do cartão do
sistema** — nome de device não serve para decidir (`mmcblk0` num boot pode ser o
cartão do sistema e no seguinte o de dados).

Um cartão **sem** o rótulo não é montado em `/user`: ele aparece em
`/media/<LABEL>`, que é a convenção de mídia removível — assim "meu save" nunca
se confunde com "o cartão do fulano".

### O que acontece no primeiro boot com a partição vazia

A p3 nasce formatada e **vazia**. Montar por cima do `/user` do rootfs esconderia
o LEIA-ME e o que já estivesse lá — então o `S20userdata` guarda o conteúdo antes
de montar e **migra** para a partição, mas só se ela estiver vazia. Se já tiver
qualquer coisa (o save de um jogo), ele **não toca** e diz isso.

## O aviso que continua valendo

**Encher `/user` até o limite deixa o sistema sem espaço.** Com `--grow`, a p3
ocupa o cartão quase todo, mas o sistema (p2) tem tamanho fixo: log, PID e `/tmp`
moram nele. Se a p3 for formatada como o cartão inteiro, não há folga para nada.

E o inverso, que é o que dói mais: **sem `--grow`, a p3 fica com 704 MiB**. Dá
para um punhado de jogos, não para uma biblioteca.
