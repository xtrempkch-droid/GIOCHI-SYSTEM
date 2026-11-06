# Painéis do R35S / R36S e clones

O mesmo aparelho sai de fábrica com **pelo menos cinco painéis diferentes**. Este
diretório guarda a descrição de cada um, em texto, para poder compará-los sem
ter os cinco aparelhos na mão.

## De onde veio

Os arquivos `.txt` aqui são o conteúdo da propriedade `panel_description`
extraída dos overlays `.dtbo` do ROCKNIX:

```text
mipi-panel.dtbo.r36s_clone
mipi-panel.dtbo.r36s-panel1
mipi-panel.dtbo.r36s-panel2
mipi-panel.dtbo.r36s-panel3
mipi-panel.dtbo.r36s-panel4
```

**Texto, não binário, de propósito.** Um `.dtbo` versionado não mostra o que
mudou; o texto mostra, e o `git diff` passa a ser útil. Para reproduzir a
extração a partir dos binários:

```bash
node scripts/panel-inspect.mjs --extract mipi-panel.dtbo.r36s-panel4 \
  | grep -v '^# ' > device/r35s/panels/r36s-panel4.txt
```

## O que é o formato

O driver `rocknix,generic-dsi` não tem timing de painel no código: recebe a
descrição como **dado**. Três tipos de linha, separadas por **NUL** (não por
newline — procurar `\n` devolve tudo numa linha só e o parse falha em silêncio):

| Linha | Significa |
| --- | --- |
| `G size=<curto>,<longo> delays=<5> format=rgb888 lanes=4 flags=0x…` | geral: tamanho físico em mm, atrasos de power, formato, lanes |
| `M clock=<kHz> horizontal=<ativo>,<fp>,<sw>,<bp> vertical=<…>` | um modo de vídeo; `default=1` marca o escolhido |
| `I seq=<hex> [wait=<ms>] # orig_cmd=0x…` | comando DCS: 1º byte é o comando, o resto é payload |

`#END` fecha a sequência de inicialização.

**`size` é (lado curto, lado longo), não (largura, altura).** Medido: `size=52,70`
num painel 640x480 dá 70/52 = 1,346 contra 640/480 = 1,333 — confere. Lido como
(largura, altura) daria 0,743 e acusaria erro em quatro painéis que estão certos.

## O refresh é calculável, e é o que identifica o painel

```text
htotal = ativo + front porch + sync width + back porch
vtotal = idem, na vertical
refresh = clock ÷ (htotal × vtotal)
```

Verificado contra o único overlay que declara o refresh pretendido em comentário
(`r36s-panel4`):

| Comentário | htotal × vtotal | conta | declarado |
| --- | --- | --- | --- |
| `# 60` | 732 × 661 = 483 852 | 29 000 000 / 483 852 = **59,94 Hz** | 60 |
| `# 50` | 732 × 792 = 579 744 | **50,02 Hz** | 50 |
| `# 75` | 732 × 528 = 386 496 | **75,03 Hz** | 75 |

Fecha nos três. É essa conferência que dá sentido à ferramenta: quando o
comentário e a conta divergem, um dos dois está errado, e o sintoma no aparelho é
tela que não sincroniza — **sem mensagem nenhuma**.

## Os cinco, lado a lado

```bash
node scripts/panel-inspect.mjs device/r35s/panels/*.txt
```

| Painel | `size` | clock | htotal | vtotal | refresh (calc.) | modos | init |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `r36s_clone` | 153×85 | 30 000 kHz | 990 | 518 | 58,50 Hz | 12 | 24 |
| `r36s-panel1` | 52×70 | 29 000 kHz | 820 | 516 | 68,54 Hz | 3 | 25 |
| `r36s-panel2` | 52×70 | 29 000 kHz | 732 | 512 | 77,38 Hz | 3 | 187 |
| `r36s-panel3` | 52×70 | 29 000 kHz | 732 | 512 | 77,38 Hz | 3 | 188 |
| `r36s-panel4` | 52×70 | 29 000 kHz | 732 | 661 | **59,94 Hz** | 3 | 155 |

Todos: 640×480, 4 lanes, `rgb888`, `flags=0xe03`.

## O que isso permite concluir — e o que não permite

**Permite:** identificar um painel pelo número, sem trocar overlay até ligar. A
tabela acima é a diferença entre "tenta o panel3" e "o panel4 é o de 60 Hz, com
sequência de 155 comandos, e o panel2 tem 187".

**Não permite** decidir qual usar num aparelho sem ligá-lo. Painel DSI **não tem
EDID**: não existe consulta que responda "qual é o seu painel". O caminho que
funciona continua sendo overlay na partição de boot e trocar até ligar.

**Achados que ficam registrados sem veredito:**

| Achado | Situação |
| --- | --- |
| `r36s_clone` declara `size=153,85` (razão 1,80 — painel 16:9 de ~7") com **todos os 12 modos em 640x480** (razão 1,33) | inconsistente. 35% de divergência, e os outros quatro não têm isso. Não se sabe se o `size` é de outro aparelho ou se os modos foram copiados |
| `r36s_clone` **não tem `#END`** | a sequência de init não é fechada. Todos os outros quatro fecham |
| `r36s_clone` tem 12 modos, incluindo 90 e 120 Hz | parece tabela genérica, não o conjunto real do painel |
| `panel1`, `panel2`, `panel3` a 29 MHz dão **68,5 Hz** e **77,4 Hz**, não 60 | pode ser real (painel pequeno aceita refresh alto) ou pode ser clock escolhido para outro alvo — **não dá para decidir sem o datasheet** |
| `panel2` e `panel3` diferem em **um comando** (187 contra 188) | não são o mesmo painel. Qualquer conclusão de "tanto faz" está errada |

Nenhum desses vira `FAIL` no teste: são avisos com número, porque o dado não
permite decidir. Transformar dúvida em falha seria pior — o operador aprenderia a
ignorar o aviso, que é o defeito do §12.34 do `AGENTS.md`.

## A armadilha da ordem dos comandos

O `panel4` tem **dois** comandos `0x11` e **dois** `0x29`:

```text
I seq=1100 # orig_cmd=0x15      ← 0x11 com payload, no MEIO da sequência
I seq=2900 # orig_cmd=0x15      ← 0x29 com payload, no MEIO
...
I seq=11 wait=200 # orig_cmd=0x5    ← este é o sleep-out de verdade
I seq=29 wait=20  # orig_cmd=0x5    ← este é o display-on de verdade
```

Procurar por "existe 0x11" acha o do meio e o teste passa a verificar a coisa
errada. O que importa é **os dois últimos comandos, e nesta ordem**: `0x29` antes
do `0x11` deixa a tela apagada, com o driver reportando sucesso.

## Estado

Os overlays originais são do ROCKNIX e usam o driver `rocknix,generic-dsi`, que é
**fora da árvore**. Nós não usamos esse driver — os painéis da X55 e da X35H vão
por drivers mainline (`hx8394`, `st7703`).

Isso não torna o material inútil: o que é caro de obter não é o driver, são as
**sequências de inicialização** — 155 a 188 comandos DCS por painel, cada um
ajustado para o painel ligar. Aqui elas estão em texto, prontas para alimentar um
driver mainline ou um `panel-simple`-like, sem depender do código do ROCKNIX.
