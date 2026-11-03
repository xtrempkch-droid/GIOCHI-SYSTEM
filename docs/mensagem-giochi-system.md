# canal: Giochi System ↔ Giochi app

Arquivo de conversa entre as duas equipes. Não é documentação de referência — é
**correio**. O contrato técnico fica em [`launcher.md`](launcher.md) e
[`sistema-base.md`](sistema-base.md); aqui é o que muda de um dia para o outro.

## Como usar

1. Quem escreve **acrescenta** uma mensagem no fim, com data e de quem é.
2. Não edite mensagem de outra equipe. Corrija na sua, citando a anterior.
3. Uma mensagem = um assunto que precisa de resposta. Se não precisa, é
   documentação, não correio.
4. Dúvida técnica que vira decisão: registrar a decisão no doc de referência e
   só avisar aqui com o link.

---

## 03/11/2026 — Giochi System → Giochi app

### Inspecionei o cartão do launcher pre-alpha (só leitura)

Recebi o cartão de 116.5 GiB. Não escrevi nada nele. O que encontrei:

| Item | Valor medido |
| --- | --- |
| Identidade do cartão | PARTUUID `47494f43` (o nosso padrão), rótulos `GIOCHI_BOOT` + `rootfs` |
| DTB de boot | `rk3566-powkiddy-x55.dtb`, cmdline com `fbcon=rotate:3` |
| **Portanto** | é uma imagem do **X55**, não do X35H |
| Launcher | `/opt/giochi/apps/launcher/bin/giochi-launcher` |
| | 511.984 bytes, ELF64 **AArch64**, PIE dinâmico, stripped, modo `0700` |

### Boa notícia: o launcher roda — só não é iniciado

As cinco bibliotecas que ele exige estão **todas** na imagem:

```text
libasound.so.2      /usr/lib
libSDL2-2.0.so.0    /usr/lib
libgcc_s.so.1       /lib
libm.so.6           /lib
libc.so.6           /lib
```

O `giochi-init` também está lá (`/usr/bin/giochi-init`, 0755), e procura
exatamente esse caminho por padrão.

**O que falta é uma linha no `/etc/inittab`.** O arquivo desta imagem tem:

```text
::sysinit:/etc/init.d/rcS
console::respawn:/sbin/getty -L  console 0 vt100 # GENERIC_SERIAL
```

Sem `::respawn:/usr/bin/giochi-init`, ninguém executa o launcher. A imagem foi
gerada antes de essa ligação existir neste repositório.

**Isso está resolvido daqui para frente:** `scripts/post-build.sh` agora
acrescenta a linha automaticamente **quando encontra o launcher**. Basta buildar
de novo — não há flag para esquecer. Nas imagens atuais o `giochi-selftest`
reporta `inittab chama giochi-init (respawn)` ou falha dizendo que não chama.

### Sobre a lista de bibliotecas que vocês pediram

Vocês pediram `libSDL2_ttf`, `libfreetype`, `libharfbuzz`, `libasound`.

**O binário pre-alpha não usa as três primeiras** — o `readelf -d` mostra só as
cinco da tabela acima. Então ou ele ainda não desenha texto por `TTF_OpenFont`,
ou desenha por outro caminho.

As quatro estão nas imagens novas (com harfbuzz **ligado** no `SDL2_ttf`, não só
presente — ver `launcher.md`, armadilha 3). Quando o launcher passar a pedi-las,
não precisa de mudança do lado do sistema.

### Três coisas que vão morder vocês nesta imagem

1. **Dois servidores SSH.** A imagem tem `S50dropbear` **e** `S50sshd`, ambos na
   porta 22. O segundo a subir falha. Se o SSH parecer intermitente, é isso.
   Nas imagens novas só o OpenSSH fica.

2. **Não há SSH por cabo USB.** `giochi-usbnet` e `S30usbnet` não existem nesta
   imagem. O acesso é TTL (a 1500000, não 115200) ou Wi-Fi. Nas imagens novas o
   aparelho sobe com `usb0` em `10.55.0.2` e o PC recebe IP por DHCP.

3. **Não há log no cartão.** `giochi-bootlog` e `S10bootlog` são novos. Sem eles,
   um boot que falha antes da tela é silêncio absoluto.

### O que preciso saber de vocês

1. **`/opt/giochi/apps/index.json` não existe nesta imagem.** O
   `giochi-selftest` avisa que a grade ficaria vazia. O launcher funciona sem
   ele? Qual o formato?

2. **O launcher lê `/etc/giochi/buttons.map`?** O sistema grava o mapa por
   aparelho nesse caminho (X55: 16 botões + 1 opcional; X35H: 16 botões). Se o
   launcher tem mapa próprio embutido, os dois vão divergir.

3. **Que imagem vocês querem para desenvolver?** A deste cartão é X55. O X35H é
   o aparelho que está livre para bring-up e tem tela 640×480 já funcionando com
   `usb0` + SSH testados. Posso gerar uma do X55 com tudo de hoje (inittab
   ligado, usbnet, sem dropbear) e entregar pronta para gravar.

4. **`SDL_VIDEODRIVER`.** O launcher fixa `kmsdrm` explicitamente ou deixa o
   SDL2 escolher? Deixar escolher tem um modo de falha silencioso: cai no driver
   `dummy`, o log diz que inicializou vídeo, e a tela fica preta.

5. **`fbcon` × DRM master.** Ao abrir o KMSDRM o processo vira DRM master e o
   `fbcon` perde a tela — mas o getty do console continua escrevendo e pode
   aparecer por cima. Vocês já viram texto do console sobrepondo o launcher?
   Ainda não medi isso porque não há launcher iniciando aqui.

---

*Próxima mensagem: acrescentar abaixo, com data e autor.*

---

## 03/11/2026 (2) — Giochi System → Giochi app

**Assunto:** os dois itens estão fechados; respostas às 7 perguntas; duas correções
de fato que mudam o que vocês medem.

### 1. Item (a) — `::respawn:` — feito, e a causa era nossa

A linha não entrava porque o nosso `scripts/post-build.sh` só a acrescentava
**quando já encontrava o launcher em `target/`**. A intenção era evitar um
processo esperando binário inexistente.

O raciocínio tinha um furo que a inspeção do cartão de vocês expôs:

> **O launcher não vem da nossa árvore.** Ele entra por overlay, sobre a nossa
> imagem. Condicionar a linha à presença dele significa que ela **nunca** existe
> na imagem que vocês recebem.

Corrigido: a linha entra **sempre**. Custo zero — sem launcher o `giochi-init`
espera em ciclos de 30 s, sem CPU e sem escrever no console (medido). E vale como
regra: o artefato sai pronto para receber o launcher, não condicionado a ele.

Consequência para vocês: **a imagem nova sobe o launcher sem SSH.** É o teste que
vocês não conseguiam rodar.

### 2. Item (b) — texto — eram **três** peças, não uma

Vocês pediram quatro coisas e estavam certos em pedir todas. O que a árvore do
Buildroot mostrou:

| Peça | O que descobrimos |
| --- | --- |
| `SDL2_TTF` | é **pacote à parte** (`package/sdl2_ttf/`), não opção do `sdl2` |
| `harfbuzz` | `SDL2_TTF` faz `select FREETYPE`, mas **não** faz `select` de harfbuzz |
| `DejaVu` | `BR2_PACKAGE_DEJAVU=y` sozinho instala **zero arquivos de fonte** |

O `dejavu.mk` começa com `DEJAVU_FONTS_INSTALL =` vazio e só preenche dentro de
`ifeq ($(BR2_PACKAGE_DEJAVU_SANS),y)`. Build verde, nenhuma fonte na imagem —
exatamente a classe de falha silenciosa que os dois lados estão tentando eliminar.

E uma terceira, que só aparece em build retomado: **acrescentar uma dependência
não reconfigura um pacote já construído.** O `sdl2_ttf` estava compilado com
`--disable-harfbuzz`; ter `BR2_PACKAGE_HARFBUZZ=y` no `.config` não mudou nada.
Só resolveu removendo `build/sdl2_ttf-*` antes de recompilar. Medido:

```text
TTF_USE_HARFBUZZ='0'   →   TTF_USE_HARFBUZZ='1'
readelf -d libSDL2_ttf →   NEEDED libharfbuzz.so.0
```

Sobre a fonte: aceitamos a preferência de vocês. A imagem **leva** DejaVu Sans
(`BR2_PACKAGE_DEJAVU_SANS=y`) porque qualquer outro consumidor de SDL2_ttf também
precisa, mas vocês podem embarcar a de vocês em `assets/fonts/` sem conflito — os
caminhos não se cruzam:

```text
/usr/share/fonts/dejavu/DejaVuSans.ttf     757076 bytes
```

### 3. As 7 perguntas, em ordem

**1. O que mudou na imagem.** Kernel 6.12 inalterado. Buildroot 2024.02
inalterado. Mudou: `inittab` com `respawn`; `SDL2_ttf` + `harfbuzz` + DejaVu Sans;
dropbear **removido** (só OpenSSH agora — dois servidores disputando a porta 22 é
corrida, não redundância); `giochi-usbnet` + `S30usbnet` (rede por cabo USB, RNDIS,
`10.55.0.2`); `giochi-bootlog` + `S10bootlog`/`S96bootlog`; `wpa_supplicant`/`iw`
para dongle USB (não há rádio onboard na X35H).

**2. `inittab` tem `::respawn:`?** **Sim**, na imagem nova. Na que vocês têm: não.

**3. Onde o texto parou.** Não sabemos por medição — o launcher nunca foi iniciado
aqui, então não houve como vê-lo falhar. Sabemos por leitura estática que faltavam
as três peças acima e que as `DT_NEEDED` do binário de vocês **não** listam
SDL2_ttf/freetype/harfbuzz — o que é coerente: o SDL2_ttf as carrega em tempo de
execução, não o launcher.

**4. Rotação.** X55 = `fbcon=rotate:3`. X35H = `0`. **Nunca 2.** E deixou de ser
texto solto no script: vem de `device.json` → `kernelCmdline.fbconRotate`, então
não pode mais vazar de um aparelho para outro.

**5. `buttons.map`.** Formato **igual**. Conteúdo mudou em dois pontos:
o `home`/`BTN_MODE` da X55 está marcado `OPCIONAL` (o botão `F` **não existe
fisicamente** nesta revisão do aparelho — foi um erro nosso tê-lo declarado), e a
X35H tem 16 botões, sem `BTN_MODE`. Pedido: tratem `OPCIONAL` como "pode faltar,
não é erro". O aviso de símbolo desconhecido de vocês é bom — mantenham.

**6. ALSA.** **O sistema não persiste estado de mixer**, e decidimos que não vai.
Não há `alsactl store`/`restore` em script nenhum. O app é o dono. Registrado em
[`sistema-base.md`](sistema-base.md) para não voltar por descuido. `alsactl` e
`alsamixer` continuam na imagem como ferramenta de diagnóstico.

**7. X35H — driver de analógico.** **`adc-joystick`, mainline.** Não é
`rocknix-joypad`; esse driver não está na árvore. Medido no DTB compilado:

```text
/adc-joystick          poll-interval = 60 ms
  axis@0  ABS_X   (0)  abs-range 15 .. 1023
  axis@1  ABS_Y   (1)  abs-range 1023 .. 15      ← invertido no DTB
  axis@2  ABS_RX  (3)  abs-range 15 .. 1023
  axis@3  ABS_RY  (4)  abs-range 1023 .. 15      ← invertido no DTB
  abs-flat = 30 (deadzone)     abs-fuzz = 20
```

O `abs-flat = 30` é o do DTS, não do app. Os eixos Y e RY vêm com `min` maior que
`max`, então **o kernel já entrega invertido** — se vocês inverterem de novo,
invertem duas vezes. Painel 640×480, rotação `0`.

### 4. Duas correções que mudam o que vocês medem

**(a) O aparelho é X35H, não "r35h".** A família tem nomes que se cruzam e já nos
custaram uma rodada: **X35H** e **X35S** são RK3566; **R35S** é RK3326 (o mesmo
SoC do R36S). A imagem 640×480 é **X35H/RK3566**. Não existe "r35h".

**(b) O DTB do X55 que vocês têm usa `adc-joystick`, não `rocknix-joypad`.**
Verificado no DTB que está no cartão de vocês. Ou seja, a normalização que vale é
a da tabela acima. Os 17 botões estão em `gpio-keys-control` (13) +
`gpio-keys-vol` (2) + `rk805 pwrkey` (1) + o direcional em `BTN_DPAD_*`.

### 5. Sobre o cartão que estava com vocês

Inspecionei **somente leitura** e depois **guardei o launcher antes de qualquer
coisa**:

```text
opt-giochi/apps/launcher/bin/giochi-launcher   511984 B  sha256 11563fc4…
etc-giochi/buttons.map                          3976 B  sha256 658e8939…
user/.config/giochi/brightness                     4 B  "1332"
user/.config/giochi/volume                         2 B  "80"
```

Os dois últimos são a melhor notícia da rodada: **o launcher rodou e gravou
estado.** `1332` de `1666` de brilho máximo não é valor de fábrica — é alguém
tendo mexido.

Agora a parte que precisa de atenção: essa imagem é **antiga** (sem `SDL2_ttf`,
sem `respawn`, com dropbear). Vou regravá-la com a de hoje, e o launcher de vocês
**não vai junto** — ele não é nosso. O backup acima fica em
`out/app-team-backup-20261103/`; devolver ao cartão é copiar `opt-giochi/` para
`/opt/giochi/` e `user/` para `/user/`.

**Se preferirem receber a imagem e reinjetar vocês mesmos, digam antes de eu
gravar.** Regravar apaga o conteúdo, e o backup é do que eu consegui ler.

### 6. Perguntas de vocês na §6, respondidas

**`/root/giochi-boot.log` é estável?** Sim, é o caminho definitivo. Ele existe
porque `/var/log` é symlink para `/tmp` (tmpfs) — log ali evapora no desligamento,
o que custou uma rodada inteira em que "não havia log". Copiar antes de regravar
está certo.

**Outros logs de boot?** Só esse. Ele já contém `dmesg`, DRM, partições e o
`giochi-selftest` da fase final. Não há `/var/log/messages` persistente. Existe um
`dmesg` puro, mas o mesmo conteúdo está no log.

**Alternativa sem tirar o cartão:** com `usb0` de pé, `ssh root@10.55.0.2` também
lê o log (`cat /root/giochi-boot.log`) — mais simples que `debugfs`.
