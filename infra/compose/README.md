# Ambiente de teste em contêineres

> **Este diretório não foi executado.** O ambiente em que foi escrito não tem
> daemon Docker. A estrutura corresponde ao que os serviços consomem hoje e ao
> que o briefing pede, mas a primeira execução vai encontrar erro. Trate como
> ponto de partida verificável, não como configuração validada — e corrija
> aqui, não em cópias locais.

## O que sobe

| Camada | Serviços | Por quê assim |
|---|---|---|
| Dados | `bd-ops`, `bd-pii`, `bd-audit` | Três instâncias, não três bancos numa só. A separação do ADR-0002 é física |
| Migração | `migracao` | Roda até o fim e sai; serviço só sobe depois que ela sai com zero |
| Cadeia | `besu-1` a `besu-4` | Quatro validadores QBFT: tolera uma falha bizantina (3f+1 com f=1) |
| Aplicação | `compliance`, `oracle`, `core`, `eudr` | Um contêiner por serviço |
| Teste | `registradora` | Só no perfil `teste`. Em ambiente com dado real não sobe |
| Interface | `web` | Única porta exposta ao hospedeiro |

## Quatro redes, e isso é controle de acesso

`cofre` liga apenas `compliance` e `bd-pii`. Um `core` comprometido não alcança
o cofre de PII porque **não existe rota de rede** até ele — não porque falta
senha. É a diferença entre separação de credencial e separação de topologia, e
é o que o ADR-0002 descreve.

## Antes de subir

```bash
# 1. Genesis e chaves dos validadores (uma vez por ambiente)
bash infra/compose/besu/gerar-genesis.sh
export BOOTNODE=enode://$(sed 's/^0x//' infra/compose/besu/rede/validador-1/chave.pub)@besu-1:30303

# 2. Segredos. Não há valor padrão para nenhum: o compose falha se faltar.
export CPR_SEGREDO_JWT=$(openssl rand -hex 32)
export SENHA_BD_OPS=... SENHA_BD_PII=... SENHA_BD_AUDIT=...
export SENHA_APP_OPS=... SENHA_APP_PII=... SENHA_APP_AUDIT=...
export CHAVE_INDICE_CEGO=$(openssl rand -hex 32)
export CORS_ORIGENS=https://teste.seu-dominio

# 3. Subir
docker compose -f infra/compose/docker-compose.yml --profile teste up -d
```

`AMBIENTE` padrão é `homologacao`, não `desenvolvimento`: o perfil de
demonstração e o escopo de simulador não valem, e as rotas `/sim` respondem
404. Para um ambiente de demonstração com injeção de divergência, defina
`AMBIENTE=desenvolvimento` **e saiba o que está fazendo** — é a superfície que
injeta divergência em registro.

## O que falta aqui, e é conhecido

1. **Usuários de aplicação nas bases.** A migração cria o esquema; os papéis
   `cpr_ops_app`, `cpr_pii_svc` e `cpr_audit_svc` precisam de senha e GRANT,
   hoje feitos por `infra/db/subir-local.sh` no ambiente local. Falta o
   equivalente aqui.
2. **KMS de verdade.** O volume `chaves-kms` guarda chave de titular em
   arquivo. Funciona e não é KMS: sem HSM, a destruição de chave é uma
   remoção de arquivo, e a garantia de irreversibilidade vale o que vale o
   volume.
3. **Contratos implantados.** Não há passo de implantação dos contratos na
   rede Besu; `infra/enderecos.json` é produzido pelo script do Hardhat contra
   o nó local.
4. **TLS e proxy reverso.** Só a `web` expõe porta, mas sem terminação TLS.
5. **Backup.** Nenhum volume tem rotina de cópia.
