# ADR-0002 — Manter todo dado pessoal fora da cadeia, por exclusão e não por criptografia

- **Estado:** Proposto — pendente de G1
- **Data:** 2026-09-18
- **Decisores:** orquestrador; veto de E2 em G2, G3 e G4; veto de E1 em G1
- **Portão:** G1

## Contexto

A LGPD assegura ao titular a eliminação de seus dados. Um livro-razão imutável
não elimina nada. Essa incompatibilidade não se resolve com política interna
nem com termo de uso: resolve-se com arquitetura.

Há três estratégias possíveis, e a diferença entre elas é o que acontece no
pior dia.

A primeira é **cifrar o dado pessoal on-chain** e destruir a chave quando o
titular pedir eliminação. É elegante e é frágil: o texto cifrado permanece
público e permanente, e sua segurança depende de o algoritmo resistir por
décadas. O dado de um produtor rural de 2026 continuará lá em 2050, esperando
que a hipótese criptográfica de hoje continue de pé.

A segunda é **hashear o identificante** — publicar `hash(CPF)` em vez do CPF.
Isso é pseudonimização fraca ao ponto de ser enganosa: o espaço de CPFs válidos
tem cerca de 10^11 elementos, e um ataque de dicionário sobre ele é trabalho de
minutos em hardware comum. Quem publica `hash(CPF)` publicou o CPF, com um
passo extra.

A terceira é **não colocar o dado**. É a menos sofisticada e a única que
sobrevive ao pior dia.

## Alternativas consideradas

**Cifragem on-chain com crypto-shredding na cadeia.** Rejeitada pelo motivo
acima: transfere um risco de hoje para um problema de amanhã, e amanhã não há
como recolher o dado.

**Hash de identificante como pseudônimo.** Rejeitada: reidentificável por
dicionário. Onde aparece hash determinístico nesta arquitetura — a âncora de
registro — o insumo **não é dado pessoal** (é identificador de título), e a
determinística é exigência funcional de idempotência (P3): a segunda emissão
precisa colidir com a primeira. O trade-off é consciente e está registrado
abaixo.

**Zero-knowledge para tudo.** Rejeitada por superengenharia — o risco de maior
probabilidade da tabela da Seção 11 do briefing. Para o MVP, um circuito
mínimo e delimitado (provar pertinência de polígono a um conjunto conforme, sem
revelar qual) resolve o caso de uso real; uma biblioteca genérica de provas
consome o runway e não fecha nenhuma lacuna informacional.

## Decisão

**Nenhum dado pessoal entra na cadeia, em nenhuma forma — nem cifrado, nem
hasheado, nem em evento, nem em calldata.** On-chain circulam apenas:

1. **Referências opacas** (`ops.ref_opaca`): pseudônimos aleatórios de 128
   bits, gerados por CSPRNG e **jamais derivados de PII**. A correspondência
   com a identidade real vive apenas em `cpr_pii`, cifrada com chave por
   titular.
2. **Hashes de documento e de evidência**, cujo pré-imagem é documento ou
   dataset, não pessoa.
3. **A âncora de registro**, `keccak256(entidade || "|" || registro_id)`.
4. **Valores numéricos e estados** do ciclo de vida.

A eliminação do titular é executada por **crypto-shredding em `cpr_pii`**:
destruída a chave do titular no KMS, o texto cifrado remanescente vira ruído. A
cadeia não precisa ser tocada, porque nunca soube quem era a pessoa.

Interfaces Solidity de W1 não têm parâmetro `string` em função mutante, e a
restrição é verificada sobre a ABI em CI. Campo de texto livre é a porta pela
qual o dado pessoal entra sem que ninguém decida deixá-lo entrar.

## Consequências

Positivas: o direito à eliminação é exercível sem tocar no livro imutável; a
superfície de vazamento fica confinada a uma base física, com credencial
própria e sem rota de rede a partir dos demais serviços; e a demonstração ao
regulador (Seção 12) passa a ser possível em uma sessão de tela — varredura
limpa e comprovante de irreversibilidade.

Negativas: perde-se a capacidade de auditar on-chain "quem é o titular" sem
passar pelo `services/compliance`, o que adiciona uma dependência ao painel de
auditoria e um ponto de indisponibilidade. Perde-se também a possibilidade de
verificação independente por terceiro que não tenha acesso ao cofre — um
credor não consegue, sozinho, confirmar que por trás da referência opaca existe
uma pessoa habilitada; ele confia na atestação (`IRegistroParticipantes`).
Registre-se com clareza: **isso é uma transferência de confiança, não sua
eliminação.** Quem diz o contrário está vendendo.

**Risco residual aceito e declarado:** a âncora é hash determinístico de
identificador de título. Quem conhecer o espaço de identificadores de uma
registradora pode, por força bruta, descobrir quais títulos estão espelhados.
Identificador de título não é dado pessoal, e a idempotência exigida por P3 não
sobrevive a um sal aleatório. Aceita-se o vazamento de "este título existe e
está espelhado"; não se aceita o vazamento de quem é o titular.

## Critérios de revisão

1. Parecer de autoridade — ANPD ou equivalente — de que pseudônimo aleatório
   em livro imutável constitui tratamento de dado pessoal por si só. [#REF]
2. Necessidade funcional de que terceiro verifique identidade sem intermediário,
   caso em que o caminho é credencial verificável com apresentação seletiva, e
   não dado on-chain.
3. Detecção de qualquer PII on-chain em ambiente real: o incidente reabre a
   decisão e dispara o plano de resposta, porque nesse ponto a cadeia precisa
   ser considerada comprometida de forma permanente.

## Veto e ressalvas

A registrar no dossiê de G1. E2 tem veto sobre esta decisão em G2, G3 e G4.

## Fontes

- Lei 13.709/2018 (LGPD), art. 18, VI (eliminação) e art. 16 (retenção por
  obrigação legal). [#REF]
- Ordem de grandeza do espaço de CPFs (11 dígitos, com dois verificadores):
  cálculo direto sobre a regra de formação. [#REF]
