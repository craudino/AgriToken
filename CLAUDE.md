# CPR Digital — instruções permanentes

Leia `docs/BRIEFING.md` antes de decidir qualquer coisa estrutural. Este
arquivo é o resumo operacional; o briefing é a autoridade.

## Princípios inegociáveis (Briefing, Seção 2)

**P1 — O registro prevalece.** O token é representação, nunca fonte de verdade.
Em qualquer divergência entre o registro na entidade autorizada e o estado
on-chain, o sistema sinaliza, congela operações sobre aquele contrato e exige
reconciliação humana. Nunca "corrige" o registro a partir do token.

**P2 — Dado pessoal não toca a cadeia.** Nenhum CPF, nome, dado bancário ou
polígono georreferenciado bruto vai on-chain, em nenhuma circunstância, nem em
campo de metadados, nem em evento, nem em calldata. On-chain circulam apenas
identificadores opacos, hashes e provas.

**P3 — Unicidade do colateral.** O sistema deve tornar estruturalmente
impossível mobilizar duas vezes a mesma garantia. Ancoragem no identificador
único de registro, com verificação idempotente na emissão.

**P4 — Redundância de oráculo por padrão.** Nenhuma decisão contratual
materialmente relevante pode depender de uma única fonte externa. Toda leitura
crítica exige quórum mínimo de duas fontes e possui caminho de disputa.

**P5 — Auditabilidade completa.** Todo evento de estado gera registro imutável,
com timestamp, origem, autor e evidência. O sistema deve conseguir responder,
para qualquer contrato e qualquer instante, à pergunta "o que se sabia, quando
se soube e com base em quê".

**P6 — Determinismo e reprodutibilidade.** Nenhuma lógica contratual pode
depender de fonte não determinística on-chain. Toda execução deve ser
reproduzível a partir do log.

**P7 — Fronteira regulatória codificada.** O sistema não executa novação, não
se interpõe como contraparte, não custodia ativo virtual de terceiro e não
promete rendimento. Estas proibições existem como testes automatizados que
falham se a fronteira for cruzada.

**Em conflito entre conveniência de implementação e princípio: pare e escale.
Não contorne.**

## Fronteiras de diretório

| Agente | Escreve em | Nunca escreve em |
|---|---|---|
| A1 Chain | `contracts/`, `test/chain/` | resto |
| A2 Core | `services/core/` | resto |
| A3 Oráculos | `services/oracle/` | resto |
| A4 EUDR & Geo | `services/eudr/` | resto |
| A5 Compliance | `services/compliance/` | resto |
| A6 Interfaces | `apps/web/` | resto |
| A7 Plataforma | `infra/`, `.github/` | resto |

`docs/contracts/` é congelado. **Nenhum agente o edita.** Precisa mudar? Abra
solicitação de mudança de contrato ao orquestrador (`docs/contracts/MUDANCAS.md`),
com motivo, impacto por agente e proposta de versão. Editar contrato congelado
sem passar por aí é a origem previsível do retrabalho em cascata.

`contracts/interfaces/*.sol` é congelado no mesmo regime, ainda que fique sob o
diretório de A1: as ABIs em `docs/contracts/abi/` derivam dele e o CI compara.

## Comandos

```bash
npm run validar            # tudo abaixo, na ordem
npm run validar:openapi    # lint 3.1 + invariantes de fronteira
npm run validar:eventos    # esquemas, exemplos e varredura de PII
npm run validar:contratos  # compila interfaces, compara ABIs congeladas
npm run validar:esquema    # sobe bases efêmeras e roda conformidade do DDL
```

O CI roda `npm run validar` em todo PR. Falha nele não é ruído: cada teste ali
corresponde a um princípio da Seção 2.

## Commits e PRs

Commit no imperativo, em português, explicando **por que** e não o que — o
diff já diz o que. Primeira linha até 72 caracteres. Um commit por decisão
coerente.

PR contra `develop`, com: o que muda, qual lacuna informacional avança, quais
testes provam, e quais princípios foram tocados. PR que muda contrato congelado
sem ADR é rejeitado sem leitura.

## ADR obrigatório

Toda decisão estrutural gera ADR em `docs/adr/`, no formato de
`docs/adr/0000-template.md`. É decisão estrutural: escolha de tecnologia,
mudança de fronteira entre serviços, alteração de política de quórum, mudança
no modelo de dados congelado, qualquer coisa que um sucessor perguntaria "por
que fizeram assim?". Não há decisão não registrada.

## Proibição explícita de PII on-chain

Não escreva, em contrato, evento, calldata, log estruturado ou metadado de
token: CPF, CNPJ, nome, e-mail, telefone, endereço, dados bancários, número de
CAR ou coordenada geográfica bruta.

Em dúvida sobre se um campo é dado pessoal: **pare e escale ao painel.** O erro
aqui é irreversível — não existe direito à eliminação em livro imutável, e um
vazamento não se recolhe. Custa menos perguntar.

## Escopo

Oito capacidades (Briefing 1.1). Proposta que não mapeie para uma lacuna
informacional da tabela é **rejeitada por padrão**, por melhor que seja.
