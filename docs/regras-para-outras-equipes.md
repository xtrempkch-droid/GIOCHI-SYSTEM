# Regras de engenharia do Giochi — o que vale para todas as equipes

> Este documento não é sobre o `Giochi System`. É o que **sobreviveu ao
> repositório onde nasceu**: cada regra abaixo custou um build de 40 minutos, um
> boot sem tela ou uma tarde de diagnóstico errado, e nenhuma delas é específica
> de Buildroot.
>
> Ele existe porque as regras ficaram no `AGENTS.md` de um repo só. As equipes do
> `app`, do `os`, da `engine` e dos `jogos` produzem artefatos que vão **para o
> mesmo aparelho**, e um erro de qualquer uma aparece como "o sistema está
> quebrado".
>
> Medido em 26/11/2026. Cada exemplo tem procedência; nenhum é parábola.

---

## R1 — Medir antes de afirmar

Toda afirmação técnica carrega o comando que a produziu. Número sem procedência
é opinião, e opinião em issue de outra equipe custa o dia de alguém.

**O caso que criou a regra.** Uma issue acusou "falta o transporte HID do kernel
(`CONFIG_HID`/`BT_HIDP`/`UHID`)" com cinco evidências. Rodando os cinco comandos:

| Evidência da issue | Medido | Veredito |
| --- | --- | --- |
| `modinfo hidp` sem depender de `hid` | `modinfo: not found` — não existe na imagem | **impossível de ter sido medido ali** |
| `strings …/hidp.ko` vazio | o glob não expandia (o arquivo mora em `hidp/hidp.ko`) | o vazio era **glob que não casou** |
| `/sys/bus/hid/drivers/` sem `hidp` | `hidp` não é driver de dispositivo, é `hid_ll_driver` | conceito trocado |
| `CONFIG_HID` ausente | `CONFIG_HID=y` desde sempre | **falso** |
| `hci0` existe | `/sys/class/bluetooth/` vazio | **outro aparelho** |

Quatro de cinco não reproduziam. Uma delas era verdadeira (`UHID` desligado) — e
foi corrigida. As outras quatro teriam mandado a equipe implementar o que já
existia.

**Como aplicar:** antes de escrever uma issue ou um commit, rode o comando. Se
não puder rodar, escreva *"não medi"* em vez do que você acha.

## R2 — Verde não é correto

Build verde, teste passando e serviço no ar **não provam** que o artefato está
certo. O defeito caro é exatamente o que atravessa todos os gates.

Três exemplos medidos neste projeto, todos da mesma forma:

| O gate existia, e | Resultado |
| --- | --- |
| a primeira linha dele lia uma variável que a plataforma **não exporta** | nunca rodou; build verde, zero cobertura |
| ele cobria 3 dos 4 arquivos de configuração | o quarto podia ter qualquer erro, em silêncio |
| ele comparava com o **nome do arquivo** que existia, não com o efeito | passou num aparelho sem áudio |

**Como aplicar:** pergunte *"o que exatamente este gate reprova?"* e tente
reprová-lo de propósito. Um gate que nunca falhou não é um gate: é decoração. A
verificação por **mutação** — estragar o código e ver o teste ficar vermelho —
custa dois minutos e é a única prova.

## R3 — Pergunte pela consequência, não pelo indireto

"O arquivo existe" é uma pergunta. "Funciona" é outra. Quase todo diagnóstico
errado deste projeto foi o indireto respondendo sozinho. Casos medidos:

| O indireto | O que ele não distingue | A pergunta certa |
| --- | --- | --- |
| driver de GPU presente | GPU × **CPU em software** | a mesma `GL_VERSION` sai idêntica com `softpipe`; só o `GL_RENDERER` separa |
| device de entrada criado com os botões certos | o app **recebe** os botões | sem `EV_SYN/SYN_REPORT`, o kernel tem os eventos e o cliente **não vê nenhum** |
| biblioteca instalada | ela é **usada** | `readelf -d`/`ld.so --list` mostram `NEEDED`; a lib no disco não prova nada |
| `/sys/class/net/usb0` existe | a rede funciona | neste kernel é **symlink pendurado**; `ip link` responde, `[ -e ]` não |
| `modprobe` não deu erro | o módulo faz algo | "compilou a variante errada" dá módulo presente e nenhum botão |
| pidfile ausente | o processo não roda | o busybox `udhcpd` não grava pidfile; `pidof` vê |

**Como aplicar:** para cada verificação, escreva a frase *"isto prova que ___"*.
Se a frase não fecha, a verificação é fraca.

## R4 — Teste que pergunta a coisa errada é pior que teste nenhum

Um falso negativo custa uma investigação. Um **falso positivo** custa o bloco
inteiro: depois da terceira vez que ele acusa errado, o operador aprende a
ignorar — inclusive quando estiver certo.

Casos medidos:

- `ls /usr/lib/x.so* /lib/x.so*` sai **não-zero** quando **um** dos padrões não
  casa, mesmo listando o outro. Cinco `FAIL` falsos em num aparelho com as cinco
  bibliotecas no lugar.
- `ps` sem argumento, no `procps-ng`, lista **só a própria TTY**. Rodou num
  aparelho com 94 processos e mostrou 2 — quase se concluiu "o launcher não está
  rodando" com ele desenhando na tela.
- `pidof giochi-init` responde "ausente" com o processo vivo, porque ele é
  `/bin/sh script` e `pidof` casa pelo **nome**.
- um `timeout` do busybox devolve **143**, não 124: tratar como falha reprovou um
  emulador que estava rodando a 60 fps.

**Como aplicar:** todo teste tem um caso negativo — *o que ele deve reprovar* — e
ele é testado nos dois sentidos.

## R5 — "Não existe" e "existe desligado" dão o mesmo sintoma

Antes de dizer que a plataforma não tem X, leia o manifesto/manifest/Kconfig e
procure a subopção. A confusão já custou três correções erradas neste projeto —
casos medidos, não hipótese:

| Alegação | Fato |
| --- | --- |
| "o `amixer` não vem no Buildroot" | vem, como **subopção desligada** por padrão |
| "o símbolo `FEATURE_TAR_GZIP` existe" | foi **renomeado**; o `=y` era descartado em silêncio |
| "sem `modinfo`, o módulo não tem dependência" | sem `modinfo`, não há **resposta** |

**Como aplicar:** a diferença entre *não empacotado* e *empacotado e desligado*
muda a correção — uma exige receita nova, a outra é uma linha.

## R6 — Uma fonte da verdade, ou duas que divergem

Duas listas, dois mapas ou dois nomes para a mesma coisa divergem **no dia em
que um muda**, e o sintoma aparece só onde os dois caminhos estão ativos.

**O caso.** Um jogo somava a máscara do `evdev` com a do `SDL_GameController`.
Aberto o A: o evdev acendia "acelerar" e o SDL acendia "frear" — o carro recebia
os dois. Cada mapa estava correto isolado; o erro era ter dois.

**Como aplicar:** todo dado que duas partes precisam conhecer mora em **um**
lugar, versionado, e as duas derivam dele. Se a segunda parte precisa de uma
tabela, ela é **gerada** da primeira.

## R7 — Repositório alheio é somente leitura

Cada repo tem um responsável. Mudança "de passagem" chega sem revisão de quem
responde pelo produto, e mistura o seu diff com o trabalho que já estava lá.

**O entregável é a issue**: o que foi medido, o arquivo e a linha, a consequência,
e o que a correção provavelmente é. Isso vale mesmo quando o patch é trivial de
escrever — e vale ainda mais aí, porque ninguém vai revisar.

**Como aplicar:** se a investigação terminar em "o defeito é no arquivo deles", o
resultado é **relatório**. Nunca um commit no repo deles.

## R8 — Licença antes de recurso

A imagem assinada do Giochi não leva **GPL, AGPL nem LGPL**. Isso já barrou três
coisas boas:

| O que | Licença | Onde ficou |
| --- | --- | --- |
| `gptokeyb2` do PortMaster | GPL-2.0 | fica em `/user`, instalado pela loja |
| `7-Zip` do PortMaster | LGPL-2.1 | idem |
| **PPSSPP** | **GPL-2.0-or-later** | idem |
| blob da ARM (`libmali`) | proprietário | idem, e só se um dia for necessário |

A separação que resolve quase todo caso é **três perguntas diferentes**:

| Pergunta | Como se responde |
| --- | --- |
| dá para **embarcar** na imagem? | licença do pacote |
| dá para **instalar** em `/user`? | sim — é app baixado, com a licença dele |
| dá para **rodar** neste hardware? | medição, e é a única que ninguém quer pular |

Quem confunde as três ou bloqueia à toa, ou embarca o que não pode.

## R9 — Não confie no relatório: reproduza

Relato de terceiro é **hipótese** até o comando rodar aqui. Não por má-fé: porque
a imagem mudou, o aparelho é outro, ou a ferramenta não existe naquele sistema.

**O caso medido:** um relatório de outra equipe listava oito itens, e **três já
estavam resolvidos** — eles mediram uma imagem mais antiga. Um dos itens "sem `libudev` não há hotplug"
era premissa errada: o SDL2 desta imagem usa `inotify`, e o sintoma relatado
acontece **com ou sem** libudev.

**Como aplicar:** ao receber um relatório, a primeira resposta é qual
**commit/imagem** ele mediu. Se não disser, o relatório não tem data e não vale.

## R10 — Registre o que NÃO foi medido

A lacuna declarada vale mais que a afirmação otimista. Quem lê precisa saber onde
pisar; quem escreve, lembrar em três semanas.

Formato que funciona, de um documento real deste repo:

```text
## O que NÃO foi provado
- o build dos handhelds em Buildroot 2025.02 (só o alvo virtual foi construído)
- a faixa do analógico no X35H (herdada da X55, não medida no aparelho)
```

Sem isso, o próximo leitor trata a dedução como medição — e o documento passa a
mentir sozinho.

## R11 — Meça no aparelho, não no desktop

O desktop mente, e mente sempre na mesma direção: ele é mais permissivo. Quatro
divergências medidas entre a mesma coisa rodando no PC e no handheld:

| No desktop | No aparelho |
| --- | --- |
| SDL aceita um nó só-de-botões como joystick (via `libudev`) | **rejeita** — a imagem não tem libudev, e o caminho é outro |
| `timeout` devolve 124 | o do busybox devolve **143** |
| `awk` tem `strtonum` | o do busybox **não tem** — devolve vazio, e a soma "passa" com zero |
| `ps` lista tudo | lista a **própria TTY** |

**Como aplicar:** funcionalidade que depende de hardware, kernel ou de um applet
do busybox só é "pronta" depois de rodar no alvo. E a bancada precisa existir:
sem aparelho, o certo é marcar `SKIP` com o motivo, não `PASS`.

## R12 — Estado que sobra mente sobre a próxima execução

Arquivo de marcação, cache, build retomado, diretório temporário: tudo isso
sobrevive e passa a valer como verdade sem ninguém decidir.

Casos medidos:

- um marcador "console liberado" ficou órfão depois de um `kill -9` (o `trap` não
  roda), e o aparelho voltou **sem interface** e sem mensagem. Correção: gravar
  o PID junto e verificar se o dono vive;
- um arquivo de "reinicie a GUI" sobreviveu e a GUI abria e fechava em 1 s, sem
  erro;
- um build retomado **não** reaplica patch novo, e o log diz que aplicou;
- um pacote já compilado **não** é reconfigurado quando uma dependência aparece:
  a biblioteca entra na imagem e o consumidor continua compilado sem ela.

**Regra prática:** todo estado persistente tem dono, prazo ou verificação. Estado
sem dono é defeito esperando o momento.

---

## Checklist para qualquer equipe

Antes de fechar uma tarefa:

- [ ] Rodei o comando que sustenta cada afirmação do meu relatório/commit.
- [ ] Estraguei de propósito o que o teste protege, e ele ficou vermelho.
- [ ] Cada verificação minha responde *"isto prova que ___"* com uma frase que fecha.
- [ ] Tenho um caso negativo testado (algo que **deve** reprovar).
- [ ] O dado que duas partes conhecem mora em um lugar só.
- [ ] Se o problema é em repo de outra equipe, escrevi issue — não commit.
- [ ] O que eu uso é compatível com a licença do destino.
- [ ] Medi **no aparelho** o que depende de hardware.
- [ ] Escrevi o que **não** foi medido.
- [ ] Nenhum estado que eu deixo para trás vai ser lido como verdade sem checagem.
