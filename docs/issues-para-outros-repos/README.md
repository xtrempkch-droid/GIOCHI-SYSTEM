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

## Estado de cada um (conferido em 26/11/2026)

| Repo | Título | Arquivo | Situação |
| --- | --- | --- | --- |
| `GIOCHI-APP` | PortMaster: listar os ports no launcher e oferecer como app de loja (sideload) | [`APP-ports-e-loja.md`](APP-ports-e-loja.md) | **aberta como `#2`** — o formulário duplicou e a `#5` foi fechada como duplicata |
| `GIOCHI-OS` | Documentar e garantir o contrato de entrada: o controle virtual "Giochi Gamepad" na junção | [`OS-documentar-na-juncao.md`](OS-documentar-na-juncao.md) | **a issue FOI DELETADA** (a `#1` tinha o corpo errado e sumiu) — **reabrir** |

Já resolvidas, e os arquivos podem sair desta pasta:

| Repo | Issue | O que era | Estado |
| --- | --- | --- | --- |
| `GIOCHI-GAMES` | `#1` | o `neon-drift` tratava o A como freio | **fechada, corrigida de verdade**: `gamepad.rs` agora faz `Button::A => ACELERAR` / `Button::B => FREAR`, com o comentário citando a issue |
| `GIOCHI-GAMES` | `#2` | o contrato de entrada, para a equipe dos jogos | **aberta**, e é o material que a equipe usa |
| `GIOCHI-APP` | `#1` (antiga) | contrato de entrada: enumerar e analógico | **deletada** junto com o repo — o corpo errado foi embora |

> **Correção de rumo, 26/11/2026.** A versão anterior desta tabela dizia que
> `APP#1` e `OS#1` estavam "abertas com o corpo errado, precisa substituir". As
> duas foram **deletadas** em algum momento entre 20 e 26/11, junto com a
> `GAMES#3`/`#4`. O material do APP foi reaberto como `#2`; o do OS **não**, e é
> o único pedido desta pasta que hoje não existe em lugar nenhum além daqui.

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
