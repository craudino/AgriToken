# ADR-0004 — Contratos atualizáveis por UUPS com timelock, e âncora de registro imutável

- **Estado:** Proposto — pendente de G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E3 em G2 e G3; veto de E1 em G1
- **Portão:** G1

## Contexto

Duas exigências puxam em sentidos opostos.

A primeira é jurídica e econômica: o espelho representa um título com efeitos
perante terceiros. Se o operador da plataforma puder reescrever, a qualquer
momento e sozinho, a lógica que governa o espelho, então o credor não detém
uma representação verificável — detém uma promessa do operador. A pergunta de
E1 se aplica com força: *se um fiscal abrir esta tela amanhã, o que ele conclui
que estamos fazendo?* Uma chave de administrador que altera regras de token
alheio, sem aviso e sem prazo, parece exatamente com o que ela é.

A segunda é operacional: é um MVP. Haverá erro em contrato, e contrato
imutável com erro é dinheiro e prazo perdidos em migração.

## Alternativas consideradas

**Imutabilidade total.** Máxima garantia ao credor, custo alto de correção.
Rejeitada para o MVP, mas **parcialmente adotada**: a âncora de registro é
imutável (ver Decisão).

**Proxy transparente com administrador único.** Rejeitada: concentra em uma
chave o poder de alterar a lógica de todos os espelhos, sem prazo de
contestação. É o padrão que mais se parece com custódia de fato, ainda que não
seja custódia de direito (P7).

**Padrão diamante (EIP-2535).** Rejeitada por complexidade de auditoria
desproporcional ao MVP e por dificultar a verificação independente pelo credor.

**Migração por reemissão.** Corrigir um erro emitindo nova versão do contrato e
migrando os tokens. Rejeitada como estratégia primária: a migração de espelhos
de títulos vivos é operação de risco jurídico (a reemissão poderia ser lida
como novação, o que P7 proíbe), e exigiria parecer caso a caso.

## Decisão

**UUPS (EIP-1822/1967) com timelock e papéis separados**, com três restrições
que são parte da decisão e não detalhes de implementação:

1. **A âncora de registro é imutável.** `IAncoraRegistro` é implementado em
   contrato sem proxy e sem função de atualização. A correspondência
   título↔token não pode ser reescrita por upgrade, nem por erro, nem por má-fé.
   É a única garantia estrutural de P3, e uma garantia que depende de upgrade
   não é estrutural.

2. **Timelock mínimo de 72 horas** entre proposta e execução de qualquer
   atualização de implementação ou concessão de papel sensível, com evento
   emitido na proposta. O credor precisa ter tempo hábil para observar uma
   mudança nas regras do ativo que detém — e, se for o caso, sair antes.

3. **Autorização de upgrade por multiassinatura**, nunca por chave de serviço.
   O papel de reconciliação humana (`PAPEL_RECONCILIADOR_HUMANO`) é
   indelegável a chave automatizada, e a mesma regra vale para o upgrade.

Emergência: a única ação imediata permitida é **pausar**
(`PAPEL_PAUSA`). Pausa congela movimentação; não altera estado, não descongela
contrato congelado por divergência e não muda lógica. Uma pausa que pudesse
alterar estado seria upgrade sem timelock com outro nome.

## Consequências

Positivas: erro corrigível sem migração de tokens; poder de alteração
distribuído e observável; a garantia central (unicidade da âncora) não depende
da boa conduta de quem controla o proxy.

Negativas, e precisam ser ditas ao credor: **o espelho é atualizável.** Por
melhor que seja o desenho, o conjunto de signatários pode, em 72 horas, mudar
a lógica do token. Um credor que exija imutabilidade absoluta não deve ser
convencido de que ela existe aqui — ela não existe. O que existe é
previsibilidade, prazo e trilha.

Custo técnico: storage gap obrigatório em toda implementação, proibição de
construtor com estado, inicializador protegido contra reexecução, e o conjunto
de armadilhas do padrão UUPS — colisão de slot, implementação não inicializada
passível de sequestro, função de upgrade sem proteção de autorização. Cada uma
vira teste obrigatório em W1, sob revisão de E3 (invariantes de
`docs/contracts/abi/README.md`).

## Critérios de revisão

1. Exigência de contraparte relevante — credor institucional ou registradora —
   por imutabilidade de um contrato específico. Atende-se congelando aquele
   contrato, não abandonando o padrão.
2. Achado crítico de E3 sobre o padrão UUPS na implementação de W1.
3. Uso do timelock em janela inferior a 72 horas por pressão operacional: o
   primeiro pedido de exceção é sinal de que o prazo está mal calibrado ou de
   que a disciplina está cedendo. Registra-se e reavalia-se; não se abre a
   exceção silenciosamente.
4. Passagem do MVP a produção com títulos de terceiros em circulação, momento
   em que o conjunto de signatários precisa deixar de ser interno.

## Veto e ressalvas

A registrar no dossiê de G1.

## Fontes

- EIP-1822 (UUPS) e EIP-1967 (slots de proxy): especificações do Ethereum
  Improvement Proposals. [#REF]
- Condição de eficácia do registro da CPR perante terceiros: Lei 8.929/1994,
  art. 12, com redação da Lei 13.986/2020. Ver ADR-0002 e os arquivos de E1.
