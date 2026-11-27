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

**Pelo cartão:** a partição do sistema é `ext4`, e o Windows **não a monta**. Na
prática, para copiar arquivo à mão o caminho é SSH (no Linux, `sudo mount
/dev/sdX2 /mnt` também funciona). A partição FAT (`GIOCHI_BOOT`, 256 MiB) existe
e é montável em qualquer sistema — mas ela é do **boot** (`Image`, DTB,
`extlinux.conf`): não ponha jogos lá, e não a encha.

## O que cada uma espera dentro

| Pasta | Formato |
| --- | --- |
| `games/` | o launcher varre a pasta; um jogo por entrada |
| `apps/` | **um diretório por app**, com o binário dentro |
| `musica/` | arquivos de áudio soltos — o app lista as faixas |
| `ports/` | `<nome>.sh` + `<nome>/`, o layout do EmulationStation |

O layout de `ports/` não é escolha nossa: é a convenção do PortMaster, e o
`giochi-ports --rodar` aceita os dois (o instalado por ele e o feito à mão).

## O aviso que importa

**`/user` NÃO é uma partição separada.** É um diretório dentro do rootfs do
sistema, e **regravar a imagem apaga o conteúdo**.

A partição de dados (piso de 4 GiB + o resto do cartão) está **projetada e não
implementada** — ver `AGENTS.md` §3. Enquanto ela não existe:

| Situação | Espaço disponível | Consequência |
| --- | --- | --- |
| imagem gravada **com** `--grow` | o cartão quase todo (o p2 cresce) | cabe uma biblioteca grande |
| imagem gravada **sem** `--grow` | ~1,7 GiB de rootfs no total | cabe pouco, e o sistema divide o espaço |

Medido em 07/11/2026: um cartão de 116,1 GiB gravado com `--grow` ficou com o
`p2` em **115,8 GiB**. Sem `--grow`, o rootfs é o da imagem (1,0 GiB de dados).

Ou seja: **`--grow` é obrigatório** para quem quer usar o aparelho sem a loja.
Sem ele, "pôr os arquivos à mão" esbarra no tamanho.

E o corolário que não é óbvio: `--grow` também significa que **tudo** divide o
mesmo filesystem. Encher `/user` de ROMs até o limite deixa o sistema sem espaço
para log, PID e o próprio `/tmp` — e o sintoma não é "disco cheio", é o aparelho
travando de formas estranhas.

## Por que as pastas existem vazias na imagem

Elas **não existiam** até 26/11/2026 — nem o build as criava, nem o launcher,
nem o app de música (medido: não há um `create_dir_all` para elas em nenhum dos
dois). O resultado era o defeito que aparece como culpa do usuário: copiar para
`/user/musica/x.mp3` falha porque o diretório não existe, e o app responde *"a
pasta /user/musica não existe"*.

Agora o `scripts/post-build.sh` cria as quatro e escreve
**`/user/LEIA-ME.txt`** — que é a mesma informação deste documento, **no
aparelho**, para quem está com o cabo na mão e não vai ler o repositório.

`tests/pastas-do-usuario.test.mjs` roda o `post-build.sh` de verdade num alvo
sintético e exige as quatro pastas, o symlink e o aviso no LEIA-ME. Verificado
por mutação: sem o bloco, 1 pass / 2 fail.
