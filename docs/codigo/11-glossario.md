# 11. Glossário

Vocabulário do domínio e do repositório. Quando um termo tem significado
específico **aqui**, a diferença está anotada.

---

## Domínio do crédito rural

**CPR — Cédula de Produto Rural.** Título de crédito emitido por produtor rural,
representando promessa de entrega de produto ou de pagamento do seu equivalente
financeiro. Instituída pela Lei 8.929/1994; a modalidade financeira e o regime
de registro em entidade autorizada decorrem de alterações posteriores, entre
elas a Lei 13.986/2020. [#REF]

**Registradora / entidade registradora.** Entidade autorizada a registrar
títulos. **Neste sistema é a fonte de verdade (P1)**, e o protótipo usa um
simulador no lugar de uma real — com as consequências declaradas no ADR-0006.

**Âncora de registro.** `sha256("entidade|registro_id")`. Determinística, para
que a segunda emissão colida e reverta (P3). Ver `02-nucleo.md` §2.1.

**Espelho.** O token que representa a CPR registrada. **Nunca fonte de verdade.**
A palavra foi escolhida para ser literal: espelho reflete, não determina.

**Cessão.** Transferência da titularidade do crédito, registrada na entidade
registradora. Cessão não refletida no token e transferência on-chain sem cessão
são divergências distintas, e as duas são detectadas.

**Waterfall.** Ordem de absorção de perdas por nível de garantia. Cinco níveis,
política imutável depois de registrada.

**LTV — *loan-to-value*.** Razão entre dívida e valor do colateral. **Passa de
100%** quando a garantia vale menos que a dívida — o domínio que limitava a 100
tornava a subcolateralização inexprimível (SMC-011).

**MTM — marcação a mercado.** Valor atualizado a partir de leitura de oráculo.
Leitura `EM_DISPUTA` não move MTM.

**Averbação.** Registro da garantia real no cartório competente, que a torna
oponível a terceiros. **Garantia não averbada não absorve perda** no modelo
(SMC-006).

**Excussão.** Execução da garantia.

**Saca.** 60 kg, para café. Unidade de `ops.sacas`.

---

## Regulatório

**LGPD — Lei 13.709/2018.** Lei Geral de Proteção de Dados. Este sistema é
governado pelo art. 16 (retenção obrigatória) e pelo direito à eliminação, cuja
tensão com livro imutável é resolvida por crypto-shredding. [#REF]

**ROPA.** Registro das operações de tratamento, exigido pelo art. 37 da
LGPD. [#REF] Aqui é tabela consultável (`pii.operacao_tratamento`), não documento.

**EUDR — Regulamento (UE) 2023/1115.** Regulamento da União Europeia sobre
produtos livres de desmatamento. Data de corte: 31/12/2020. Prazos de aplicação
adiados pelo Regulamento (UE) 2025/2650 para 30/12/2026 (grandes operadores) e
30/06/2027 (micro e pequenas). [#REF] A data de corte não mudou nos adiamentos —
mas vive na tabela, não no código, porque regra com histórico de mudança vira
dado.

**DDS — *Due Diligence Statement*.** Declaração de diligência devida exigida
pelo EUDR.

**CAR — Cadastro Ambiental Rural.** **Número de CAR é tratado como dado
pessoal** neste sistema: identifica a propriedade e, por ela, o titular. Vive
cifrado no cofre (`car_numero_cif`).

**Novação.** Substituição de uma obrigação por outra. **P7 proíbe** que o sistema
a execute; `validar:p7` procura identificadores que a denunciem.

**Interposição como contraparte.** Assumir posição entre as partes. Proibida
por P7.

**Valor mobiliário.** A caracterização depende, entre outros fatores, da
expectativa de rendimento criada no investidor — razão pela qual `validar:p7`
examina **o texto exibido**, não só o código. [#REF]

---

## Técnico

**ERC-3525.** Norma de token semifungível: combina identidade (como ERC-721) com
valor fracionável dentro de um `slot` (como ERC-20). Escolhida porque a CPR
precisa das duas propriedades. [#REF]

**Slot.** No ERC-3525, o agrupamento de tokens da mesma natureza. Aqui, a safra
e a commodity.

**UUPS.** Padrão de proxy atualizável em que a lógica de atualização vive na
implementação. Usado no `EspelhoCPR`, **não** na `AncoraRegistro` — a unicidade
do colateral não pode depender de quem controla o proxy (ADR-0004).

**Storage gap.** `uint256[40] private __vazio`. Espaço reservado para variáveis
futuras sem colidir com o storage existente — armadilha clássica do UUPS.

**QBFT.** Consenso da rede Besu, com quatro validadores (ADR-0001).

**Besu.** Cliente Ethereum permissionado. Rede-alvo; **nunca executada** neste
protótipo.

**Crypto-shredding.** Eliminar o dado destruindo a chave que o cifra. Uma chave
**por titular** — chave compartilhada tornaria a eliminação individual
impossível.

**Índice cego.** `HMAC-SHA256` do documento, com chave de serviço. Permite buscar
sem decifrar, e não é reversível por dicionário como um hash simples seria.

**Referência opaca.** Pseudônimo de 128 bits, **aleatório**. Nunca derivado de
PII (ADR-0002).

**Forma canônica.** JSON com chaves ordenadas e sem espaços. Implementada duas
vezes (`canonico()` em TypeScript, `jsonb_canonical()` em SQL) e comparada em CI.

**Outbox.** Padrão em que o evento é gravado na mesma transação do fato. Aqui,
`ops.evento`.

**Trava consultiva.** `pg_try_advisory_lock`. Eleição de líder entre réplicas da
agenda; some sozinha se o processo morrer.

**Deriva de migração (*drift*).** Divergência entre ambientes causada por edição
de migração já aplicada. Detectada por checksum.

**Recusa por omissão.** Rota sem escopo declarado responde 403. O inverso é como
toda API acaba aberta sem ninguém decidir isso.

**RFC 9457.** *Problem Details for HTTP APIs*. Estendida aqui com
`principio_violado`. [#REF]

---

## Deste repositório

**P1–P7.** Os sete princípios inegociáveis da Seção 2 do briefing:

| | |
|---|---|
| **P1** | O registro prevalece |
| **P2** | Dado pessoal não toca a cadeia |
| **P3** | Unicidade do colateral |
| **P4** | Redundância de oráculo por padrão |
| **P5** | Auditabilidade completa |
| **P6** | Determinismo e reprodutibilidade |
| **P7** | Fronteira regulatória codificada |

**A1–A7.** Os agentes construtores, com fronteiras de diretório em `CLAUDE.md`:
A1 Chain, A2 Core, A3 Oráculos, A4 EUDR & Geo, A5 Compliance, A6 Interfaces,
A7 Plataforma.

**E1–E8.** Especialistas revisores, invocados nos portões. E1 jurista
regulatório, E2 privacidade, E3 segurança de contratos, E4 crédito e risco
agrícola, E5 dados geoespaciais, E6 economista institucional, E7 design e
fricção, E8 confiabilidade.

**W1–W8.** Blocos de trabalho do briefing.

**Red team regulatório.** Adversário declarado: fiscal hostil ou advogado da
contraparte em disputa. Invocado em G1 e G4.

**Portões (G1–G4).** Pontos de revisão obrigatória. **G1 executado**; G2 e G3
**nunca executados**.

**SMC.** Solicitação de mudança de contrato, em `docs/contracts/MUDANCAS.md`.
Doze até aqui:

| | |
|---|---|
| SMC-001 | Saída do congelamento deixa de ser uma string |
| SMC-002 | Quórum exigido também no ramo degradado |
| SMC-003 | Verificação de P7 alcança o código-fonte |
| SMC-004 | Catálogo passa a enxergar o sentido token→registro |
| SMC-005 | Timelock ganha proposta |
| SMC-006 | Garantia real ganha oponibilidade |
| SMC-007 | Instrumentação de custo |
| SMC-008 | ADRs ausentes |
| SMC-009 | Geometria das bases de desmatamento no banco |
| SMC-010 | Resolução espacial como coluna da base de referência |
| SMC-011 | LTV deixa de ser limitado a 100% |
| SMC-012 | Credencial de base exigida por quem a usa |

**ADR.** Registro de decisão de arquitetura, em `docs/adr/`. Oito:

| | |
|---|---|
| ADR-0001 | Rede distribuída |
| ADR-0002 | Privacidade on-chain/off-chain |
| ADR-0003 | Política de quórum de oráculos |
| ADR-0004 | Upgradeability de contratos |
| ADR-0005 | Perímetro regulatório |
| ADR-0006 | Premissas da registradora |
| ADR-0007 | Tensão entre P1 e P7 |
| ADR-0008 | Desvios de ambiente do protótipo |

**Lacuna informacional.** Pergunta que o MVP existe para responder. São oito, e
o estado de cada uma está em `docs/ESTADO-DO-PROTOTIPO.md` — incluindo a que
**não** foi resolvida.

**Congelado (contrato).** `situacao_conciliacao = 'CONGELADO'`. Operações
suspensas até reconciliação humana. Não confundir com:

**Congelado (artefato).** `docs/contracts/` e `contracts/interfaces/`: mudança
exige SMC.

---

## Termos que este sistema recusa

Vale registrar o que **não** se diz, e por quê:

**"Rendimento", "retorno garantido", "investimento".** Proibidos no texto
exibido, porque criam a expectativa que caracteriza valor mobiliário (P7).
`validar:p7` procura.

**"Token", "blockchain", "hash", "oráculo", "quórum", "espelho", "âncora",
"conciliação".** Proibidos **na tela do produtor** — não no sistema.
`sem-jargao.mjs` verifica, e ignora comentários de código: explicar a regra não
é violá-la.

**"Custódia".** O `CofreGarantias` registra vínculos e não guarda valor. O nome
engana por herança do domínio, e o comentário do contrato corrige explicitamente.

---

**Volta ao [índice](README.md).**
