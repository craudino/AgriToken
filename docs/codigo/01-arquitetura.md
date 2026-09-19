# 1. Arquitetura

## O formato geral

```
                      ┌──────────────┐
   navegador ────────▶│  apps/web    │  (Next.js, renderização no servidor)
                      └──────┬───────┘
                             │ token de escopo de leitura
        ┌────────────────────┼─────────────────────┬──────────────────┐
        ▼                    ▼                     ▼                  ▼
┌───────────────┐   ┌────────────────┐   ┌─────────────────┐  ┌──────────────┐
│ services/core │──▶│ services/oracle│◀──│  services/eudr  │  │  compliance  │
│   domínio     │   │    quórum      │   │  polígono, selo │  │ cofre de PII │
└───────┬───────┘   └────────┬───────┘   └────────┬────────┘  └──────┬───────┘
        │                    │                    │                  │
        │            ┌───────▼────────┐           │                  │
        │            │  registradora  │           │                  │
        │            │  (simulador)   │           │                  │
        │            └────────────────┘           │                  │
        ▼                                         ▼                  ▼
  ┌──────────┐                              ┌──────────┐      ┌───────────┐
  │ cadeia   │                              │ cpr_ops  │      │  cpr_pii  │
  │ (EVM)    │                              │  +geo    │      │           │
  └──────────┘                              └──────────┘      └───────────┘
                                                  │
                                            ┌─────▼──────┐
                                            │ cpr_audit  │
                                            └────────────┘
```

## Por que serviços separados

A divisão não é por camada técnica nem por gosto: é pela **fronteira que
precisa existir**.

- **`compliance` é separado porque o dado pessoal precisa de uma porta só.** É
  o único serviço com credencial do cofre, e no ambiente em contêineres é o
  único na rede do cofre. Um `core` comprometido não alcança o cofre por não
  existir rota — não por faltar senha.
- **`oracle` é separado porque quórum é decisão, não utilitário.** Se cada
  serviço consultasse suas próprias fontes, a política de redundância viraria
  convenção, e convenção não sobrevive a prazo apertado.
- **`eudr` é separado porque geometria é pesada e reidentificante.** A
  geometria bruta vive num schema com papel próprio, e quem a lê declara
  finalidade.
- **`core` é separado porque é onde o registro prevalece.** Toda escrita de
  estado de contrato passa por ele, de modo que exista um lugar — um só — onde
  P1 pode ser auditado.

## Fluxo de uma CPR, do começo ao fim

1. **Onboarding** (`compliance`): dado identificável entra pela única porta,
   cifrado com chave do titular. Sai uma referência opaca.
2. **Habilitação** (`compliance` → cadeia): o endereço do credor é habilitado
   no `RegistroParticipantes` com hash da atestação de KYC e validade.
3. **Polígono e selo** (`eudr`): geometria ingerida e validada pelo PostGIS,
   cruzada com duas bases, evidência gerada com hash reproduzível.
4. **Originação** (`core`): rascunho com referência opaca e talhões. Nenhum
   dado pessoal atravessa.
5. **Registro** (emitente → registradora; `core` confere): quem registra é o
   emitente. O núcleo lê, confere valor, quantidade e estado, e só então marca
   REGISTRADO.
6. **Espelhamento** (`core` → cadeia): emissão idempotente por âncora. A
   segunda tentativa reverte no contrato, não no backend.
7. **Conciliação contínua** (`core`, agendada): compara registro e cadeia nos
   dois sentidos, classifica divergência, congela e abre incidente.
8. **Marcação a mercado** (`core` + `oracle`): preço com quórum, deságio,
   LTV — inclusive acima de 100%, que é o caso que importa.
9. **Liquidação** (`core` + `oracle`): pagamento confirmado por unanimidade de
   duas fontes e baixa registrada. A plataforma concilia; não custodia.

## Fronteiras entre agentes

O repositório foi construído por sete agentes com diretórios exclusivos
(`CLAUDE.md`). A fronteira sobrevive no código: `docs/contracts/` é congelado,
os tipos TypeScript são **gerados** dele, e o CI reprova divergência. Quem
precisa mudar contrato abre solicitação em `docs/contracts/MUDANCAS.md` — há
doze registradas, e cada uma diz que defeito a originou.

## O que atravessa a fronteira, e em que forma

| De | Para | O que passa | O que **não** passa |
|---|---|---|---|
| `compliance` | qualquer | Atestação ("KYC aprovado, válido até") | Nome, documento, dossiê |
| `eudr` | `core` | Resultado do selo e hash da evidência | Polígono bruto |
| `oracle` | `core`, `eudr` | Valor com quórum e linhagem | Leitura sem quórum |
| `core` | cadeia | Hash, referência opaca, valor | Qualquer texto livre |
| registradora | `core` | Estado do título | — (leitura apenas) |
