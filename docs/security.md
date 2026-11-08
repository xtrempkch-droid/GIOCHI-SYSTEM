# Segurança

## Modelo de ameaça

O Giochi System gera imagens de sistema operacional. Uma imagem contém kernel, rootfs, credenciais e serviços. Trate cada artefato como um binário confiável apenas depois de revisar sua configuração e sua origem.

## Senha de root

- O padrão de desenvolvimento é `giochi-system`.
- Em produção, configure o secret `GIOCHI_SYSTEM_ROOT_PASSWORD` no GitHub Actions ou passe `ROOT_PASSWORD` no build local.
- A senha aceita letras, números, `.`, `-`, `_` e `@`, com 8–128 caracteres. Caracteres especiais de shell/Make são rejeitados de propósito.
- Troque a senha no primeiro boot com `passwd`.
- O `buildroot.config` do artefato tem `BR2_TARGET_GENERIC_ROOT_PASSWD` redigido para `"__REDACTED__"`.
- A senha não é escrita no `build-info.txt`.

## SSH

O pacote `openssh` é incluído no rootfs comum. Antes de expor um device na rede:

- desabilite login de root por senha ou use chaves;
- restrinja `PermitRootLogin`;
- considere remover o OpenSSH de imagens de produção;
- não reutilize a senha padrão em nenhuma interface.

## Cadeia de suprimentos

- A versão do Buildroot é fixada em `buildroot.version`.
- O script baixa o tarball oficial de `buildroot.org` por HTTPS.
- O build usa o `.config` final e registra a versão, o commit e a data no `build-info.txt`.
- O artefato inclui `SHA256SUMS`.
- O SHA256 do tarball do Buildroot é **fixado** em `buildroot.sha256` e conferido
  antes de extrair (`build-device.sh` imprime `sha256: OK`); hash divergente ou
  ausente interrompe o build em vez de seguir com o arquivo trocado.
- Pacotes baixados pelo Buildroot ficam em `.cache/dl` (é o `BR2_DL_DIR`); em
  CI, esse cache deve ser tratado como não confiável até o build validar.

## Segredos no Git

Nunca commite:

- `ROOT_PASSWORD`;
- chaves SSH privadas;
- tokens do GitHub;
- arquivos `.env`;
- imagens geradas com credenciais reais.

Use **Settings → Secrets and variables → Actions**.

## Imagens e releases

- Baixe artefatos apenas de execuções confiáveis do workflow.
- Verifique `SHA256SUMS` antes de gravar.
- Prefira releases assinadas ou com attestations do GitHub quando o projeto crescer.
- Uma imagem de cartão SD pode ser montada e lida; não coloque segredos de produção no rootfs.
- Teste a imagem em hardware isolado antes de distribuir.

## Atualizações

O Giochi System não possui um mecanismo de atualização OTA. Atualizações exigem reconstruir a imagem ou implementar um sistema de pacotes/atualização. Para produção, planeje:

- versionamento de imagens;
- canais de release;
- verificação de integridade;
- processo de rollback;
- política de CVEs e rebuild periódico.

## Serviços de rede

A imagem comum inclui OpenSSH. Não inclua servidores adicionais sem revisar configuração, firewall e autenticação. O `BR2_SYSTEM_DHCP` dos defconfigs de referência configura DHCP em `eth0`; revise o arquivo de rede antes de expor o dispositivo.

## Limitações atuais

- O CI não assina imagens.
- O CI não verifica um SHA256 fixo do tarball do Buildroot.
- As imagens de hardware real (Powkiddy X55 e Steam Deck) ainda não existem; são placeholders.
- O device `qemu-aarch64` é uma referência técnica, não um ambiente de produção.
