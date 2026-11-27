## O que mudou no sistema

O item **1** da tabela de pendências do `docs/cartao-sd.md` de vocês está
resolvido: **`/user` agora é uma partição separada**, e não mais um diretório
dentro do rootfs. Isso muda o que o app pode assumir — e desbloqueia o argumento
da loja que dependia dele.

Layout novo (três partições, `commit` de 26/11/2026):

```text
  64 MiB    p1  FAT32  256 MiB  GIOCHI_BOOT   Image, DTB, extlinux.conf, boot.scr
 320 MiB    p2  ext4  1024 MiB  GIOCHI        sistema — tamanho FIXO, nunca cresce
1344 MiB    p3  ext4  o resto  GIOCHI_USER   ← /user: dados do usuário
```

| Antes | Agora |
| --- | --- |
| `/user` era diretório no rootfs | `/user` é a **p3** (`GIOCHI_USER`), montada pelo `/etc/init.d/S20userdata` |
| regravar a imagem apagava os apps comprados | regravar reescreve p1+p2 e **a p3 sobrevive** |
| `--grow` crescia o rootfs | `--grow` cresce a **p3**, de 704 MiB até o resto do cartão |

Medido em 26/11/2026 num cartão de 116 GiB com `--grow`: a p3 foi de 704 MiB
para ~115 GiB.

## As três perguntas objetivas que vocês levaram ao canal

A resposta de cada uma, agora com fato em vez de proposta:

### 1. Convenção de montagem (o item 1c)

**`/user`.** Fixo, sempre. O app **para de montar** — quem monta é o sistema.

E o caminho é estável mesmo quando a origem muda: a partição é encontrada pelo
**rótulo** `GIOCHI_USER`, nunca pelo nome do device. Isso importa porque
`mmcblk0` num boot pode ser o cartão do sistema e no seguinte o de dados.

O `/etc/giochi/pontos-de-montagem` que vocês já leem continua válido e agora
aponta para uma montagem real:

```text
/user
/opt/giochi
/media
```

### 2. Onde ficam os apps com eMMC (os itens 1b e 1d)

**Nenhum dos três aparelhos habilitados tem eMMC** — medido no device tree:

| Aparelho | Slot de eMMC |
| --- | --- |
| `powkiddy-x55` | `no-mmc` no `sdmmc1`; o `mmc0` existe no SoC e o kernel reclama `Failed to initialize a non-removable card` a cada boot |
| `powkiddy-x35h` | idem (herda o DTS da X55) |
| `r35s` | nenhum nó de eMMC |

Ou seja: a pergunta "apps no cartão ou no eMMC" não tem segundo lado hoje.
**Apps em `/user`**, que é a p3 do cartão. Quando aparecer um aparelho com eMMC,
`/user` é o mesmo caminho e a resposta não muda — o que muda é qual device está
por baixo, e isso o app não precisa saber.

### 3. "Partição de dados" e "slot 2" são a mesma coisa? (o item 1c, segunda metade)

**São duas coisas diferentes, e as duas funcionam:**

- a **p3** é a partição de dados do cartão do sistema — existe sempre, vem na
  imagem;
- o **slot 2** é um cartão separado, que o usuário põe para ter mais espaço. Se
  ele tiver o rótulo `GIOCHI_USER`, o sistema monta em `/user`; se não tiver,
  **não monta** — aparece em `/media/<LABEL>` como mídia removível.

Com os dois rotulados, a preferência é o do **cartão do sistema**. Sem essa
regra, a escolha dependeria da ordem de probe, que varia entre boots.

## O que vocês precisam mudar

### Você não é mais quem cria as pastas

As quatro pastas do contrato passaram a ser criadas pelo build **e** garantidas
na montagem, seja qual for o cartão:

```text
/user/games    jogos
/user/apps     apps (um diretório por app)
/user/musica   músicas
/user/ports    ports do PortMaster
```

Hoje o launcher e o app de música **não** têm `create_dir_all` para elas
(conferido no código). Sugestão: manter um `mkdir -p` defensivo **e** parar de
tratar a ausência como erro de usuário — com a partição montada, "a pasta
`/user/musica` não existe" passou a significar **defeito do sistema**, não
"usuário não criou".

Vale usar `mkdir -p` idempotente em vez de checar existência: custa nada e
cobre uma imagem antiga.

### O primeiro boot pode mover o conteúdo

A p3 nasce **vazia** na imagem. Montar por cima do `/user` do rootfs esconderia
o que está lá, então o `S20userdata` guarda o `/user` de baixo em
`/run/giochi/user-antes-da-montagem` e **migra** para a partição — só se ela
estiver vazia.

Duas consequências para o app:

1. **Não leia `/run/giochi/user-antes-da-montagem`.** É estado transitório de um
   único boot; depois da migração ele é apagado.
2. Se o app gravar em `/user` **antes** do `S20userdata` rodar, o arquivo vai
   para o rootfs e é migrado. Não é perda — mas num `S0?` de vocês seria
   escrito num lugar que some na próxima regravação. **Use `S21` ou posterior**,
   se algum dia precisarem de init script.

### `df` muda de resposta, e é a certa

Até agora `df /user` respondia com o tamanho do **rootfs**. Agora responde com o
tamanho da **partição de dados** — que pode ser o cartão quase inteiro.

Duas leituras que passam a estar erradas:

| Assumia | Agora |
| --- | --- |
| `/user` está no mesmo device que `/` | estão em devices **diferentes** |
| espaço livre de `/` = espaço para instalar app | instalar app consome espaço da **p3**; o `/` pode estar cheio com a p3 vazia |

Vale a checagem certa: `stat -f -c %a /user` e `df /user`, nunca `df /`.

## O que ainda NÃO está feito (para não prometerem por nós)

Três itens da tabela de vocês continuam abertos, e é melhor saber agora:

| Item | Estado |
| --- | --- |
| **1** partição de dados | **FEITO** (esta issue) |
| **1b/1d** eMMC | respondido acima: não existe eMMC nos três aparelhos |
| **1c** convenção de montagem | **FEITO**: `/user`, e o app para de montar |
| **2** montar `GIOCHI_BOOT` no boot | **não feito.** A p1 continua sem entrada em `fstab` e sem montagem automática |
| **3** automount de mídia removível | **não feito.** Não há `mdev.conf` nem udev ativo: um pendrive ou um cartão **sem** o rótulo não aparece montado |

O item 2 tem uma consequência prática para vocês: se o `giochi-boot.log` é lido
pelo app, ele continua precisando montar a p1 por conta própria.

## O que pedimos

1. **Remover a montagem de `/user` do app.** Quem monta é o `S20userdata`, e o
   caminho é fixo. Montar por cima é o defeito do §12.28 do nosso lado — "nunca
   desmonte o que você não montou" — e do lado de vocês derrubaria o usuário no
   meio de um download.
2. **Trocar a criação das pastas por `mkdir -p` defensivo** e parar de reportar
   ausência de `/user/musica` como mensagem para o usuário: com a partição
   montada, isso virou diagnóstico de sistema.
3. **Ler o espaço por `/user`, não por `/`.** `df /user` (ou `stat -f`) — as duas
   são partições diferentes e a do usuário é a que importa para instalar.
4. **Atualizar o `docs/cartao-sd.md` de vocês** marcando os itens 1, 1b, 1c e 1d
   como resolvidos, com o commit que adotou — é o que faz o documento não voltar
   a descrever o mundo antigo (§R9).
5. **Não ler `/run/giochi/user-antes-da-montagem`**, e se precisarem de init
   script, usar número **depois** do `S20` (é o `S21` para cima).

Se algum item não fizer sentido no desenho de vocês, respondam **com a medição**
— a primeira regra do nosso documento de regras é medir antes de afirmar, e ela
vale para os dois lados.
