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
