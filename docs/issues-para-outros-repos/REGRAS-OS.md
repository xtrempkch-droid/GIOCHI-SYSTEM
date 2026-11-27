## Por que esta issue existe

As regras de engenharia deste projeto nasceram dentro do repositório do sistema e
ficaram lá. As doze completas, cada uma com a medição que a criou, estão em:

https://github.com/xtrempkch-droid/GIOCHI-SYSTEM/blob/main/docs/regras-para-outras-equipes.md

A equipe do **os** tem um papel específico: vocês são a **junção**. Tudo o que o
sistema, o app e a engine produzem se encontra na imagem que vocês publicam, e um
erro de qualquer uma das outras três aparece no relatório de vocês. Isso muda
quais regras mais importam.

## 1. A junção é por artefato declarado, nunca por import

Não há import de código entre os repositórios — a comunicação é por **artefato
declarado explicitamente**. Consequência prática: quando a imagem sai sem uma
capacidade, a pergunta não é "quem esqueceu", é **"o artefato declarou isso?"**.

Dois exemplos medidos, os dois do lado de vocês:

| O que estava no `release.json` | O que a imagem tinha | Efeito |
| --- | --- | --- |
| `input.portmaster.runtime: false` para o alvo virtual | 0 MB de python3 | **certo** — prometer diferente seria mentira |
| `runtime: true` (ou omitido) para handheld | sem python3 | a GUI do PortMaster não abre, e o sintoma no aparelho não aponta para a config |

**Regra:** o que a imagem **tem** e o que o `release.json` **declara** são o mesmo
fato, verificado no build. Divergir é o defeito, e ele é silencioso por
construção.

## 2. Verificar que a imagem carrega o contrato — não que o arquivo exista

Esta é a regra que mais rende. O projeto publicou duas imagens em que o serviço
**estava instalado** e o contrato **não valia**:

| Instalado | Faltava | Sintoma no aparelho |
| --- | --- | --- |
| `S52gamepad` + o daemon | `CONFIG_INPUT_UINPUT` no kernel | o daemon falha; cada aparelho volta ao layout dele |
| o daemon com as capabilities certas | `EV_SYN/SYN_REPORT` no evento | o device existe, o app **não recebe nada** |
| o pacote do PortMaster em `/user` | `python3` na imagem | a GUI não abre: `No available python3` |

Nenhum desses aparece no build. O `giochi-selftest` do sistema responde
`PASS`/`FAIL`/`SKIP` por capacidade — e o `SKIP` só é aceitável quando a imagem
**não prometeu** aquilo. Serviço instalado e não funcionando é `FAIL`.

**Regra:** a verificação da junção pergunta pela **consequência** (o app recebe
evento? a GUI abre?), nunca pela existência do arquivo.

## 3. Medir no aparelho, e registrar a lacuna

O `giochi-selftest` é a ferramenta, e ele é honesto por desenho: quando não pode
provar, diz `SKIP` com o motivo. Reproduzam esse critério no relatório de vocês —
`PASS 43 · WARN 0 · FAIL 0 · SKIP 3` vale mais que `tudo ok`, porque os três
`SKIP` dizem onde ninguém pisou.

E vale a versão negativa da regra: **um `FAIL` falso é pior que nenhum teste**.
Depois da terceira vez que um bloco acusa errado, ele é ignorado — inclusive
quando está certo. Antes de publicar um veredito, estrague de propósito o que ele
protege e veja se fica vermelho.

## 4. Estado que sobra mente

Três casos medidos, todos que já morderam na junção:

- o marcador `/run/giochi/dev-free-console` ficou órfão depois de um `kill -9`
  (o `trap` não roda), e o aparelho voltou **sem interface**, sem mensagem.
  Correção aplicada no sistema: gravar o PID junto e conferir se o dono vive;
- `/run/giochi/launcher-parado` sobrevivia a uma arrancada nova, e o selftest
  reportava "desistiu" com a interface no ar;
- build retomado com cache **não reaplica** patch novo e **não reconfigura**
  pacote quando uma dependência aparece: o log diz que aplicou.

**Regra:** todo estado persistente tem dono, prazo ou verificação.

## 5. Licença é parte do artefato, não do código

A imagem assinada não leva GPL/AGPL/LGPL. Isso é decisão de projeto, e a junção
é onde ela é aplicada — um pacote GPL que entra por qualquer caminho contamina a
imagem inteira.

O caminho alternativo já existe e é de vocês também: **app de loja em `/user`**,
baixado pelo usuário com a licença dele. PortMaster, PPSSPP e o blob da ARM estão
nessa categoria, cada um pelo seu motivo.

**Regra:** antes de acrescentar um pacote à imagem, a licença vem antes do
tamanho. E "é GPL" sem a fonte citada não vale — já houve três casos de
"não existe" que eram "existe desligado".

## 6. Repositório alheio é somente leitura

Quando o defeito é no sistema, no app ou na engine, o entregável de vocês é
**issue com medição** — o comando, o arquivo, a consequência. Não é patch, mesmo
quando o patch é uma linha. Vale para nós, e é assim que este pedido chegou até
vocês.

## O que pedimos, em ordem

1. **Adotar as regras** — `docs/regras.md` no repo de vocês apontando para o
   documento base, com o commit que adotou.
2. **Publicar no `release.json` só o que a imagem entrega**, e derivar esse campo
   do build, não de uma lista escrita à mão.
3. **Verificar o contrato pela consequência** — o `giochi-selftest` é o caminho,
   e o resultado dele cabe no relatório.
4. **Citar o commit da imagem** em todo relatório de medição. Um relatório sem
   commit não tem data, e mede uma imagem que talvez não exista mais.

Se algum item não couber no desenho de vocês, responda **com a medição** — a
primeira regra do documento é medir antes de afirmar.
