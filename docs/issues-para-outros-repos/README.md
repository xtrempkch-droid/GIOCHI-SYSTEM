# Issues para os repositórios vizinhos

Corpo dos pedidos que vão para as equipes do `Giochi app`, do `Giochi os` e do
`Giochi games`. Ficam aqui, versionados, porque **esta máquina não tem como
escrever issue pela API** — `POST`/`PATCH` devolvem `401 Requires authentication`,
não há `gh`, não há token e não há credential helper (medido em 17/11/2026).

O conteúdo do **contrato** está em [`../contrato-de-entrada.md`](../contrato-de-entrada.md).
O **guia de implementação** por stack (evdev, SDL, engine, launcher) está em
[`../entrada-para-equipes.md`](../entrada-para-equipes.md).
Os arquivos desta pasta são o **recorte por equipe**: o que cada uma precisa ler,
sem o resto.

## Como usar

1. Abra `https://github.com/xtrempkch-droid/<repo>/issues/new`
2. **Título**: está na tabela abaixo
3. **Corpo**: selecionar tudo do arquivo, copiar, colar

Cada arquivo é o corpo **puro** — não tem cabeçalho, não tem `---`, não tem
instrução. Selecionar tudo e colar é o passo inteiro.

## Estado de cada um (conferido em 26/11/2026, com `gh`)

A coluna do **arquivo** é o que importa para colar: o teste
`tests/issues-vizinhos.test.mjs` lê esta tabela e confere que o corpo existe,
está inteiro e fala do assunto daquela equipe. O número da issue está ao lado
porque é o que se usa para responder lá.

| Repo | Título | Arquivo | Issue |
| --- | --- | --- | --- |
| `GIOCHI-APP` | PortMaster: listar os ports no launcher e oferecer como app de loja (sideload) | [`APP-ports-e-loja.md`](APP-ports-e-loja.md) | **`#2` aberta** — canônica (a `#5` foi fechada como duplicata) |
| `GIOCHI-OS` | Contrato de entrada: documentar o controle virtual "Giochi Gamepad" na junção | [`OS-documentar-na-juncao.md`](OS-documentar-na-juncao.md) | **`#5` aberta** — canônica (a `#2`/`#3`/`#4` são duplicatas fechadas) |
| `GIOCHI-APP` | Controle virtual "Giochi Gamepad": preferir na enumeração, e o analógico tem faixa única | [`APP-enumeracao-e-analogico.md`](APP-enumeracao-e-analogico.md) | **`#6` aberta** — republicada; a `#1` original tinha sido deletada |
| `GIOCHI-APP` | Regras de engenharia do Giochi para o app: launcher, loja e o DRM | [`REGRAS-APP.md`](REGRAS-APP.md) | **`#7` aberta** — 26/11/2026, conferida |
| `GIOCHI-OS` | Regras de engenharia do Giochi para o os: a junção e a verificação da imagem | [`REGRAS-OS.md`](REGRAS-OS.md) | **`#6` aberta** — 26/11/2026, conferida |
| `GIOCHI-ENGINE` | Regras de engenharia do Giochi para a engine: GPU, áudio e memória | [`REGRAS-ENGINE.md`](REGRAS-ENGINE.md) | **`#8` (ENGINE) e `#18` (ENGINE-3D) abertas** — mesmo corpo |
| `GIOCHI-GAMES` | Regras de engenharia do Giochi para os jogos: entrada, fps e licença | [`REGRAS-GAMES.md`](REGRAS-GAMES.md) | **`#6` aberta** — 26/11/2026, conferida |


### As regras de engenharia (26/11/2026)

As doze regras que este projeto acumulou estavam só no `AGENTS.md` do sistema.
O documento base — com a medição que criou cada uma — é
[`../regras-para-outras-equipes.md`](../regras-para-outras-equipes.md), e os
quatro arquivos `REGRAS-*.md` são o **recorte por equipe**: cada um cita só o
que aquela equipe faz, mais um pedido concreto no fim.

`REGRAS-ENGINE.md` vale para os **dois** repos da engine (`GIOCHI-ENGINE` e
`GIOCHI-ENGINE-3D`) — é a mesma equipe e o mesmo alvo, e abrir duas cópias
criaria o problema que o documento condena (duas fontes da verdade).

Já resolvidas em repo vizinho:

| Repo | Issue | O que era | Prova |
| --- | --- | --- | --- |
| `GIOCHI-GAMES` | `#1` | o `neon-drift` freava com o A | o `gamepad.rs` deles hoje faz `Button::A => ACELERAR` / `Button::B => FREAR`, com o comentário citando a issue |

## O caminho que funciona: `gh`, e não o formulário

A ferramenta de issues do MCP **renderiza um formulário interativo em vez de
executar**, e nesta interface ele não abre. Pior: ela reporta `awaiting_user_submission`
**e a chamada é executada de qualquer forma** — foi assim que `APP#2`/`#5` e
`OS#2`/`#3`/`#4` apareceram em dobro e em quádruplo (26/11/2026). É o mesmo
defeito de 17/11, quando quatro submissões viraram quatro cópias no `GAMES`.

**O caminho que funciona**, e que ficou instalado nesta máquina:

```bash
# 1. o CLI (não vem por padrão; ~/.local/bin)
V=$(curl -sI https://github.com/cli/cli/releases/latest | grep -i '^location:' | sed 's/.*tag\/v//' | tr -d '\r\n')
curl -sL -o /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${V}/gh_${V}_linux_amd64.tar.gz"
tar xzf /tmp/gh.tar.gz -C /tmp && cp /tmp/gh_${V}_linux_amd64/bin/gh ~/.local/bin/

# 2. login por device flow (o código aparece no terminal; o token fica local)
gh auth login --hostname github.com --git-protocol ssh --skip-ssh-key --web
#    → abrir https://github.com/login/device e digitar o código

# 3. e então:
gh issue create --repo xtrempkch-droid/GIOCHI-OS \
   --title "..." --body-file docs/issues-para-outros-repos/OS-documentar-na-juncao.md
gh issue close 6 --repo xtrempkch-droid/GIOCHI-SYSTEM --reason completed --comment "..."
```

**Rode o `gh auth login` em background.** Em primeiro plano ele morre no
timeout do shell e o código expira antes de alguém digitá-lo — aconteceu na
primeira tentativa. O token fica em `~/.config/gh/hosts.yml` (keyring) e **não
passa pela conversa**, que é a razão de preferir device flow a colar um PAT.

E confira **depois** de cada `create`: a ferramenta pode ter criado mesmo tendo
dito que não. `gh issue list --repo <repo> --state all` responde em um segundo.

## Por que os arquivos desta pasta continuam existindo

Eles são o **corpo puro** de cada pedido. Mesmo com `gh` funcionando, ter o texto
versionado vale por três razões:

1. o corpo de uma issue não tem histórico — mudar de ideia é editar sem rastro,
   e aqui cada mudança aparece no `git log`;
2. um repo vizinho pode apagar a issue (aconteceu: `OS#1` sumiu entre 20 e 26/11),
   e o texto continuaria só na memória de quem escreveu;
3. `tests/issues-vizinhos.test.mjs` confere que o corpo está inteiro, sem HTML e
   falando do assunto daquela equipe — antes de ser publicado, não depois.

## O que já foi feito (e pode sair daqui)

`APP-enumeracao-e-analogico.md` descreve um pedido que **não tem issue aberta**
(era a `#1`, deletada). O conteúdo continua válido — a enumeração e a faixa dos
eixos ainda são o contrato —, mas ele precisa ser reaberto para chegar a alguém.
Enquanto isso, o arquivo fica: apagar seria perder a análise.

`OS-documentar-na-juncao.md` é o caso espelho: a `#1` do OS foi deletada e o
pedido **desapareceu de lá**. É o único desta pasta que hoje depende inteiramente
de alguém colar daqui.

## Por que o corpo do APP e do OS está errado

Os dois foram criados com o **texto do `GIOCHI-GAMES`**. Medido pelo `md5` do
body: `36446c266e62` nos dois, idêntico entre si e diferente do `GAMES #2`.

A causa foi o formulário interativo da ferramenta de issues, que **não se renova
entre chamadas**: quatro submissões viraram quatro cópias do mesmo texto no
`GAMES`, e as duas seguintes herdaram esse mesmo conteúdo. Além disso o corpo
chegou em **HTML renderizado** (`<h2 dir="auto">…`), não em markdown.

O conteúdo essencial (o contrato) está nos três repos, então ninguém está sem a
informação. O que falta é o **recorte**: o APP precisa ler sobre
`EvdevInput::open` e o `Vigia`; o OS sobre `docs/juncao.md` e a verificação da
imagem.

**Substituir é um `Edit` na issue**: abrir, *Edit*, apagar tudo, colar o arquivo
daqui. Nada de formulário.

E o **título também está errado** nas duas: as duas issues abertas se chamam

```text
Contrato de entrada: mirar o controle virtual "Giochi Gamepad", não enumerar /dev/input/event*
```

que é o título do `GAMES #2`. O título certo de cada uma está na coluna
*Título* da tabela acima — trocar junto com o corpo, no mesmo `Edit`.

## O que impede isso de apodrecer

`tests/issues-vizinhos.test.mjs` (5 casos) lê **esta** tabela e confere os
arquivos: existem, têm corpo inteiro (> 1500 B), não têm tag HTML, não começam
com `#` nem `---`, e cada um fala do que *aquela* equipe tem de fazer
(`EvdevInput`/`enumerar` para o APP, `junção`/`imagem` para o OS). Trocar dois
arquivos de lugar reprova — verificado. Sem isso, um corpo trocado seria colado
igual, e o erro só apareceria no repo de outra equipe.
