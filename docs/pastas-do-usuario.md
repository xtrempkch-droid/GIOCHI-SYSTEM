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

## Os DOIS cartões: sistema é ext4, dados aceitam FAT

Esta é a distinção que mais importa, e confundir as duas **quebra o aparelho**:

| | Cartão do SISTEMA (o que boota) | Cartão de DADOS (o seu sdcard2) |
| --- | --- | --- |
| Partições | p1 boot (FAT32), **p2 sistema (ext4)**, p3 dados | uma ou mais |
| Formato do sistema | **ext4, obrigatório** | não tem sistema |
| Formato dos dados | p3: exFAT (padrão), vfat ou ext4 | **qualquer: FAT32, exFAT, ext4** |
| Por quê | ext4 guarda permissão, symlink e device node | é só arquivo de usuário |

**A p2 nunca pode ser FAT.** FAT não guarda bit de execução, symlink nem device
node: o kernel carrega, procura o `/sbin/init` e não encontra. O sintoma é tela
preta sem mensagem — e não há como recuperar sem regravar. O `make-sd-image.sh`
**recusa** um rootfs que não seja ext4 (verifica o magic `0x53ef`) justamente
para isso não acontecer por acidente.

## O cartão do sistema

```text
  64 MiB    p1  FAT32  256 MiB  GIOCHI_BOOT   Image, DTB, extlinux.conf
 320 MiB    p2  ext4  1024 MiB  GIOCHI        sistema (FIXO, ext4 sempre)
1344 MiB    p3  exFAT  o resto  GIOCHI_USER   /user
```

A p3 nasce em **exFAT** porque facilita a vida de quem tem Windows — assim a
mesma partição de dados do cartão do sistema já abre no Explorer. Mas isso é
**conveniência**, não obrigação: `--user-fs ext4` deixa tudo em ext4 e funciona
igual (só não abre no Windows).

| `--user-fs` | Lido por | Limite | Quando usar |
| --- | --- | --- | --- |
| **`exfat`** (padrão) | Windows, macOS, Linux ≥ 5.7 | nenhum | o caso normal |
| `vfat` (FAT32) | **tudo** | **4 GiB por arquivo** | compatibilidade máxima |
| `ext4` | só Linux | nenhum | quem nunca põe o cartão no Windows |

## O segundo cartão (o sdcard2)

O aparelho tem dois controladores SD. Um cartão no **segundo slot** é montado em
`/user` quando tem a pasta **`giochi-user`** na raiz — e o formato dele pode ser
**qualquer um dos três**:

```bash
# no Windows: formatar o cartão como exFAT ou FAT32,
# depois criar uma pasta chamada  giochi-user  na raiz. Dois cliques.
```

```bash
# no Linux:
sudo mkfs.vfat -F 32 -n SDCARD2 /dev/sdX1     # ou mkfs.exfat
sudo mount /dev/sdX1 /mnt && sudo mkdir /mnt/giochi-user && sudo umount /mnt
```

**FAT32 é o que tem a maior compatibilidade** — é o que TV, câmera e Windows
antigo leem. O teto é 4 GiB por arquivo, o que não atrapalha jogo nem música, e
atrapalha imagem de disco. **exFAT** não tem esse teto e o Windows lê nativo.

A ordem de preferência é: a p3 do cartão do sistema primeiro; o segundo cartão
como alternativa. Com os dois presentes, a p3 ganha — mesma imagem, mesmo
conteúdo, e é o que o build gerou. Sem essa ordem a escolha dependeria da
enumeração do kernel, que varia entre boots.

### Medido em 27/11/2026, com as opções reais do `S20userdata`

```text
exFAT: mount -t exfat -o uid=0,gid=0,fmask=0000,dmask=0000,iocharset=utf8
       drwxrwxrwx  musica     rwxrwxrwx  ports/jogo.sh → EXECUTOU
                              musica/Música.mp3        → acento preservado
```

`fmask=0000` não é detalhe: **FAT e exFAT não guardam permissão** — é o mount que
decide. Sem ele, `ports/*.sh` e o binário de um jogo não rodam, e o sintoma é
"permission denied" num arquivo que está lá. O custo, dito na frente: nesses dois
formatos **todo arquivo é 0777**. Num aparelho onde tudo roda como root isso não
abre nada que já não estivesse aberto.

### Duas armadilhas de kernel, as duas medidas

**1. `iocharset=utf8` sem `CONFIG_NLS_UTF8` derruba o mount INTEIRO.** A
mensagem é `mount: wrong fs type, bad option, bad superblock … missing codepage`
— acusa superbloco para um problema de módulo. O que se perde é o `/user`
completo, não só o acento do nome do arquivo.

Por isso o `S20userdata` monta em **degraus**: completo → sem charset → sem
permissão. Cada queda avisa no console o que foi perdido. É a diferença entre
"`Música.mp3` aparece como `M?sica.mp3`" e "não há `/user`".

**2. O mesmo vale para `codepage=437`.** O kernel desta árvore tem
`CONFIG_NLS_CODEPAGE_437=y` e `CONFIG_NLS_ISO8859_1=y`; o `NLS_UTF8` passou a
ser pedido em 27/11/2026 (estava `is not set`). Numa imagem antiga, sem ele, os
degraus 2 e 3 é que salvam.

### O primeiro boot com a partição vazia

A partição nasce vazia. Montar por cima do `/user` do rootfs esconderia o
LEIA-ME e o que já estivesse lá — então o script guarda o conteúdo antes de
montar e **migra**, mas só se a partição estiver vazia. Se já tiver qualquer
coisa (o save de um jogo), **não toca** e diz isso.

Em exFAT/FAT a migração usa `cp -r` e não `cp -a`: dono e permissão não existem
lá, e `cp -a` tentaria preservar o que não há.

## O aviso que continua valendo

**Encher `/user` até o limite deixa o sistema sem espaço.** Com `--grow`, a p3
ocupa o cartão quase todo, mas o sistema (p2) tem tamanho fixo: log, PID e `/tmp`
moram nele. Se a p3 for formatada como o cartão inteiro, não há folga para nada.

E o inverso, que é o que doía mais: **sem `--grow`, a p3 fica com 704 MiB**. Dá
para um punhado de jogos, não para uma biblioteca.

## Isso foi resolvido: o primeiro boot cresce a p3 sozinho

Quem grava a imagem com `dd` puro, balenaEtcher ou Raspberry Pi Imager não passa
`--grow` — e ficava com 704 MiB num cartão de 120 GB. Agora **o aparelho resolve
no primeiro boot**, antes de qualquer outra coisa.

Medido num cartão de 120 GiB: a p3 sai de `704 MiB` para **`121535 MiB`
(~118,7 GiB)**, e `df -h /user` mostra `118G`.

### Como funciona

O `S20userdata` roda **antes** de montar `/user` — é a única janela do boot em
que a partição está desmontada, e crescer exige isso.

1. lê o tamanho real do disco em `/sys/class/block/<cartao>/size` (setores de 512);
2. lê o LBA inicial e o tamanho da p3 na entrada 3 do MBR (`0x1DE`);
3. calcula `novo = total_do_disco - lba_inicial - 2048` (1 MiB de margem);
4. se `novo <= atual`, não faz nada — **é o caso de todo boot depois do primeiro**;
5. grava os 4 bytes do tamanho e ajusta o filesystem.

### Por que não usa `fdisk`/`sfdisk`

`sfdisk` **não está** no Buildroot 2025.02 (só `LIBFDISK`), e o `fdisk` do
busybox por script é frágil: numa bancada ele criou uma partição de **512 bytes**
em vez de 1 GiB, **sem erro nenhum**. Um `fdisk` que erra em silêncio é a última
ferramenta que se quer mexendo no cartão que acabou de bootar.

A entrada de partição no MBR é uma estrutura fixa de 16 bytes em `0x1BE + 16*(n-1)`.
Escrever 4 bytes com `dd` é determinístico e não depende de ferramenta nenhuma.

### Os três formatos não são iguais

| Formato da p3 | Como cresce | Dados |
| --- | --- | --- |
| **ext4** | `resize2fs`, preservando | **nada se perde** |
| **exFAT** (padrão) | não existe resize → **reformata** | só se estiver vazia |
| **vfat** | idem | só se estiver vazia |

exFAT e FAT **não têm ferramenta de resize** — nem no Linux, nem no upstream. Por
isso o script monta a partição, confere que só há as quatro pastas, o marcador
`giochi-user` e o `LEIA-ME.txt`, e só então reformata.

Se houver **qualquer** arquivo do usuário — um save, uma música — o script **não
mexe** e avisa:

```text
S20userdata:   AVISO: a p3 é exfat e crescer exigiria reformatar
S20userdata:          há dados do usuário ('meu-jogo.sav') — não vou apagar
S20userdata:          para usar o cartão inteiro: regrave com --grow, ou copie
S20userdata:          o conteúdo, formate do zero e devolva
```

Na dúvida (não conseguiu montar para conferir), **não cresce**. Preservar o dado
é sempre a escolha certa.

### O que você precisa saber

| Situação | O que acontece |
| --- | --- |
| gravou com `dd`/balenaEtcher em cartão de 128 GB | primeiro boot cresce a p3 sozinho |
| gravou com `flash-sd.sh --grow` | já vem no tamanho; o boot não mexe em nada |
| trocou para um cartão maior sem regravar | cresce no próximo boot |
| p3 tem jogos e você quer o espaço | copie o conteúdo, formate do zero, devolva |
| preferir preservar tudo | use `--user-fs ext4` ao gerar a imagem |

**O crescimento só acontece na p3 do cartão do sistema.** O segundo cartão não é
tocado: ele já vem no tamanho que você formatou, e mexer na partição de um cartão
alheio é o tipo de coisa que apaga o save de outra pessoa.
