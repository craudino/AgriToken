# ADR-0001 — Adotar Hyperledger Besu com QBFT para a rede permissionada do MVP

- **Estado:** Proposto — pendente de G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E1 e E6 em G1; revisão de E3 em G2
- **Portão:** G1

## Contexto

O espelho da CPR precisa de um livro-razão compartilhado entre poucos
participantes conhecidos (plataforma, credores, eventualmente a registradora),
com finalidade determinística e custo previsível. Não há necessidade de
resistência a censura por participante anônimo, e há necessidade forte de
controle de acesso: a rede é de consórcio, não pública.

Há um fato desconfortável que precisa ficar registrado, e não escondido em nota
de rodapé. O Banco Central descontinuou a plataforma baseada em Hyperledger
Besu usada nas fases 1 e 2 do piloto do Drex, por não atender aos requisitos de
privacidade — a dificuldade de conciliar sigilo bancário com rastreabilidade
das operações na mesma infraestrutura. A fase 3 do projeto seguirá com outra
base tecnológica.

Esse fato não invalida a escolha aqui, mas muda o ônus da prova. O Drex
enfrentava um problema estruturalmente mais difícil que o nosso: privacidade
entre participantes concorrentes, em escala nacional, com sigilo bancário
oponível ao próprio operador da rede. O MVP tem outra configuração: baixo
volume, validadores conhecidos e contratualmente vinculados, e — decisivo —
**nenhum dado pessoal on-chain por construção** (ADR-0002). O que o Drex tentou
resolver com criptografia na camada de rede, resolvemos por exclusão: o dado
sensível simplesmente não entra na cadeia.

## Alternativas consideradas

**Hyperledger Fabric.** Modelo de canais e coleções privadas oferece
segregação mais rica. Rejeitada para o MVP por três razões: ferramental de
contrato (chaincode) distante do ecossistema Solidity/Foundry, o que
encareceria o teste de invariantes exigido em W1; menor disponibilidade de
auditores para revisão de segurança; e custo de aprendizado que consome
semanas do runway sem comprar informação sobre nenhuma das oito lacunas.

**Rede pública com camada 2.** Rejeitada por colidir com P2 e com o perímetro
regulatório: publicidade permanente de dados, ainda que hasheados, e exposição
a agentes não habilitados. Também reintroduz custo de gás volátil em moeda
estrangeira, o que degradaria a previsibilidade que o credor exige.

**Banco de dados replicado com trilha assinada, sem cadeia.** É a alternativa
honesta e a mais barata: resolveria auditabilidade e imutabilidade com
`cpr_audit` encadeado. Rejeitada não por insuficiência técnica, mas porque uma
das lacunas informacionais a comprar é justamente a viabilidade técnica e
jurídica do espelho tokenizado (F2) e a disposição a pagar do lado credor por
um ativo que ele possa verificar por conta própria (F7). Sem a cadeia, essas
duas perguntas continuam abertas. **Registre-se, porém, que esta alternativa é
o plano B natural, e o critério de revisão abaixo aponta para ela.**

**Corda.** Modelo de privacidade ponto a ponto é aderente ao problema.
Rejeitada por disponibilidade de equipe e de ferramental de auditoria no
mercado brasileiro. [#REF]

## Decisão

Adotar **Hyperledger Besu com consenso QBFT**, quatro validadores em Docker
Compose no ambiente de desenvolvimento, rede permissionada com lista de
participantes gerida por contrato (`IRegistroParticipantes`).

A decisão vale **para o MVP** e é explicitamente provisória: é uma decisão de
compra de informação, não um compromisso de arquitetura de produção.

## Consequências

Positivas: ferramental Solidity maduro, o que viabiliza a cobertura de 90% e o
fuzzing exigidos em W1; equipe encontra documentação e auditores; finalidade
imediata do QBFT, sem reorganização de cadeia, o que simplifica a conciliação
(um bloco confirmado é definitivo, e a divergência detectada não é artefato de
reorganização).

Negativas, e elas são reais: a privacidade nativa do Besu é fraca — foi
exatamente o que derrubou a plataforma do piloto do Drex. Toda a proteção do
dado passa a depender de P2 ser cumprido com rigor absoluto, porque a cadeia
não oferece segunda linha de defesa. Um único campo de texto livre que escape
para um evento on-chain é irreparável: não há direito à eliminação em livro
imutável. Daí a varredura automática de PII ser portão de build, e não
recomendação (`infra/ci/validar-abis.mjs`, `validar-eventos.mjs`).

Consequência operacional: quatro validadores significam tolerância a uma falha
bizantina (QBFT tolera f falhas com 3f+1 nós). Com quatro nós, f = 1. Perder
dois validadores para a rede.

## Critérios de revisão

Esta decisão é reaberta, sem necessidade de discussão sobre quem errou, se
qualquer um destes ocorrer:

1. **Requisito de confidencialidade entre participantes.** Se surgir demanda de
   que o credor A não veja a existência de operação do credor B — e ela
   surgirá, se houver mais de um credor no piloto —, o Besu não resolve sem
   engenharia de privacidade significativa. É o ponto exato em que o Drex
   tropeçou; repetir o percurso com menos recursos seria ingenuidade.
2. **Latência de finalização acima de 5 segundos** no perfil de carga do
   piloto, ou custo de operação dos validadores acima do orçado.
3. **Exigência regulatória de rastreabilidade** que obrigue a publicar on-chain
   qualquer atributo hoje mantido off-chain.
4. **Descontinuidade de manutenção do projeto Besu** ou perda de suporte a
   QBFT.

Disparado qualquer critério, a ordem de avaliação é: (i) banco replicado com
trilha assinada, sem cadeia; (ii) Fabric com coleções privadas; (iii) Besu com
camada de privacidade dedicada. A ordem é deliberada: a alternativa mais
simples é avaliada primeiro, e não por último.

## Veto e ressalvas

A registrar no dossiê de G1.

## Fontes

- [InfoMoney — BC desliga plataforma do Drex por problemas de privacidade](https://www.infomoney.com.br/minhas-financas/bc-suspendera-plataforma-drex-permanentemente-por-falta-de-seguranca-dizem-fontes/)
- [InvestNews — Por que o BC "desligou" o Drex: as razões técnicas](https://investnews.com.br/economia/por-que-o-bc-desligou-o-drex/)
- Tolerância a falhas do QBFT (3f+1) e ferramental Besu: documentação do
  projeto Hyperledger Besu. [#REF]
