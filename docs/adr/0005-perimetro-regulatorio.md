# ADR-0005 — Delimitar o perímetro regulatório por restrição estrutural, e não por qualificação do produto

- **Estado:** Proposto — decorrente da decisão humana em G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E1 em G1, G3 e G4
- **Portão:** G1 (retroativo — ausência apontada por E1 A3)

## Contexto

Este ADR existe porque **não existia**. E1 apontou em G1 que a decisão mais
consequente do projeto — em que perímetro regulatório a plataforma se coloca —
não estava registrada em lugar nenhum, contra a regra escrita no próprio
`CLAUDE.md`. Quatro ADRs tratavam de rede, privacidade, quórum e
upgradeability; nenhum, da fronteira.

O red team formulou a pinça com precisão: ou o espelho é valor mobiliário — token
semi-fungível, fracionável, transferível entre participantes habilitados pela
própria plataforma, exibido a um "comprador de risco" com marcação a mercado,
selo e simulação de perda —, ou não é, e então é representação digital de valor
sobre a qual a plataforma administra instrumentos de controle. Quem escolhe o
perímetro é o fiscal, não o material de marketing.

## Alternativas consideradas

**Qualificar o produto por documento.** Escrever um parecer sustentando que o
espelho não é valor mobiliário e anexá-lo. Rejeitada: é exatamente o que o red
team ataca. Documento não é prova de conduta, e a conduta é o que se examina.

**Registrar-se preventivamente.** Buscar autorização como PSAV ou submeter
oferta a registro. Rejeitada para o MVP por custo e prazo incompatíveis com a
fase — e porque submeter-se a um regime não pedido é decisão maior que a que o
MVP existe para informar.

**Restringir estruturalmente a circulação.** Tornar impossível, no código, o
conjunto de fatos que caracteriza a oferta pública: fracionamento a terceiros
indeterminados, circulação fora do registro, promessa de rendimento.

## Decisão

Adotar a terceira. O perímetro é definido por **quatro restrições estruturais**,
cada uma com verificação automatizada:

1. **Circulação fechada.** Nenhum espelho é transferido para endereço não
   habilitado em `IRegistroParticipantes`, e a habilitação exige atestação de
   KYC válida e não expirada.
2. **Nenhuma circulação fora do registro.** Toda transferência ou fracionamento
   on-chain gera `contrato.titularidade-alterada`, e a conciliação classifica
   como divergência **crítica** (`TRANSFERENCIA_SEM_CESSAO`,
   `FRACIONAMENTO_NAO_REFLETIDO`) quando não há cessão correspondente no
   registro. Congelamento imediato. Este é o fechamento do defeito A1 de E1.
3. **Nenhuma promessa de rendimento.** Verificada por varredura de código e de
   texto exibido (`infra/ci/validar-p7.mjs`), não só de nomes de função em ABI.
4. **Nenhuma custódia e nenhuma interposição.** O cofre de garantias registra
   vínculos e não movimenta valor; a plataforma não recebe, não guarda e não
   repassa recursos — conciliar pagamento é tudo o que ela faz.

**O que a plataforma assume ser:** prestadora de serviço de registro espelhado,
verificação de atributos e conciliação, remunerada por serviço prestado, entre
partes que contratam diretamente entre si.

**O que ela assume não ser:** emissora, ofertante, intermediária, custodiante,
contraparte central ou seguradora.

## Consequências

Positivas: a defesa deixa de ser vocabulário e passa a ser conduta verificável;
um fiscal que abra o repositório encontra as proibições como testes que
reprovam o build, e não como parágrafos.

Negativas, e são caras: a circulação fechada limita a liquidez do espelho, que
é justamente o que tornaria o produto atraente — o MVP compra segurança
regulatória pagando com atratividade. E a restrição depende de o
`IRegistroParticipantes` ser mantido com rigor: uma habilitação vencida não
revogada reabre a porta.

**Risco residual declarado:** nenhuma dessas restrições impede que um fiscal
qualifique o conjunto como contrato de investimento coletivo se entender que há
esforço de terceiro gerando expectativa de lucro. A restrição reduz a
probabilidade; não a elimina. Quem afirmar o contrário está vendendo.

## Critérios de revisão

1. Consulta formal à CVM ou ao BCB, ou manifestação de qualquer das duas sobre
   estrutura análoga.
2. Demanda de mercado por circulação aberta do espelho — que é pedido para sair
   deste perímetro, e precisa ser tratado como tal.
3. Qualquer funcionalidade nova que crie expectativa de rendimento gerido pela
   plataforma.
4. Entrada de terceiro custodiando ativo dentro do fluxo.

## Veto e ressalvas

E1 reprovou G1 tendo como achado crítico exatamente a lacuna que este ADR
fecha. A decisão humana foi prosseguir. Este ADR não converte a reprovação em
aprovação: registra a escolha e o risco residual.

## Fontes

- [Parecer de Orientação CVM 40/2022](https://conteudo.cvm.gov.br/legislacao/pareceres-orientacao/pare040.html) — critérios de qualificação de criptoativo como valor mobiliário.
- Lei 6.385/76, art. 2º, IX (contrato de investimento coletivo); Lei 14.478/2022
  (PSAV); Lei 10.214/2001 (contraparte central); DL 73/1966 (seguro). [#REF]
- Lei 8.929/1994, art. 12, com redação da Lei 13.986/2020 e alteração da Lei
  14.421/2022 (registro como condição de eficácia; prazo de 30 dias úteis).
