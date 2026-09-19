# Documentação do código

Esta pasta explica **como o sistema é feito**. Para entender *por que* ele
existe, leia `docs/BRIEFING.md`; para saber *o que está provado e o que não
está*, leia `docs/ESTADO-DO-PROTOTIPO.md`.

Para a visão geral do sistema — contexto, direcionadores, implantação,
riscos e evolução — leia antes [`docs/arquitetura/`](../arquitetura/README.md).
Aqui o foco é o código.

## Ordem de leitura

| # | Documento | Responde |
|---|---|---|
| 1 | [Arquitetura](01-arquitetura.md) | Como as peças se encaixam e por que são sete |
| 2 | [Núcleo compartilhado](02-nucleo.md) | O que não pode divergir entre serviços |
| 3 | [Modelo de dados](03-modelo-de-dados.md) | Três bases, e o que o banco recusa sozinho |
| 4 | [Eventos e auditoria](04-eventos-e-auditoria.md) | Como se reconstrói o que se sabia |
| 5 | [Contratos on-chain](05-contratos-onchain.md) | O que vive na cadeia e por quê |
| 6 | [Serviços](06-servicos.md) | Cada serviço, arquivo por arquivo |
| 7 | [Autenticação](07-autenticacao.md) | Escopos, perfis e recusa por omissão |
| 8 | [Interfaces](08-interfaces.md) | Três superfícies com propósitos opostos |
| 9 | [Operação](09-operacao.md) | Subir, migrar, agendar, conteinerizar |
| 10 | [Verificação](10-verificacao.md) | O que cada validador realmente prova |
| 11 | [Glossário](11-glossario.md) | Vocabulário do domínio |

## Princípio de escrita destes documentos

Comentário e documento explicam **por quê**; o código já diz o quê. Onde houver
decisão que um sucessor questionaria, o texto traz o motivo e a alternativa
rejeitada — e, quando a decisão foi errada e corrigida depois, o erro fica
registrado. Boa parte do que este sistema aprendeu veio de defeito encontrado,
não de acerto planejado.

## Tamanho do repositório

| Área | Arquivos | Linhas |
|---|---:|---:|
| `packages/nucleo/src` | 15 | 955 |
| `contracts/` (interfaces + implementação) | 11 | 1.047 |
| `services/core/src` | 9 | 1.436 |
| `services/oracle/src` | 6 | 671 |
| `services/eudr/src` | 6 | 666 |
| `services/compliance/src` | 8 | 659 |
| `infra/simulador-registradora/src` | 4 | 258 |
| `apps/web` (fonte, sem `.next`) | 13 | 968 |
| `infra/ci` (validadores) | 9 | 998 |
| `docs/contracts/db` (esquema congelado) | 19 | 1.495 |

Os validadores somam quase mil linhas — aproximadamente o mesmo que o núcleo.
Não é exagero: em G1, três revisores independentes acharam defeitos que os
testes da própria construção declaravam cobertos, e a resposta foi tornar cada
princípio verificável por máquina.
