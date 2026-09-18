# Parecer E6 — Economista institucional

- **Especialista:** E6 — Economista institucional
- **Viés declarado:** desconfio de soluções técnicas para problemas de incentivo.
- **Pergunta-guia:** que custo de transação isto elimina, e para quem?
- **Portão:** G1 — Fronteira regulatória e coerência econômica
- **Data:** 2026-09-18
- **Objeto:** artefatos congelados da Fase 0 (`docs/contracts/`, `contracts/interfaces/`,
  `docs/adr/`, `CLAUDE.md`, `infra/ci/`, `README.md`, `AGENT.md` de domínio).
  Nenhuma implementação existe; avalia-se a especificação.

---

## Veredicto

**Aprovado com ressalvas.**

A especificação é coerente com a tese econômica em três pontos que costumam falhar
nesta classe de projeto, e isso precisa ser dito antes das ressalvas, porque é o que
justifica não reprovar. Primeiro, a disciplina de escopo foi mantida: não há artefato
de prova de conhecimento zero na Fase 0 — o risco nº 1 da Seção 11 do briefing foi
contido por omissão deliberada, e o ADR-0002 (linhas 47–49) registra a razão econômica
correta. Segundo, o ADR-0003 identifica, com precisão incomum, a diferença entre
eliminar e transferir custo de mensuração, e o campo `independente_de` em
`ops.fonte_oraculo` ataca a redundância aparente, que é a forma mais cara de falsa
segurança. Terceiro, o ADR-0001 admite explicitamente que o banco replicado com trilha
assinada é o plano B mais barato, o que mantém a opção real aberta em vez de fechá-la
por compromisso com a tecnologia escolhida.

As ressalvas abaixo, no entanto, não são cosméticas. A mais grave (A1) diz respeito ao
propósito declarado do MVP: como especificado, o sistema saberá medir uma das oito
lacunas e terá de responder às outras sete por anedota. Isso não impede escrever código,
mas impede que o dossiê de G4 cumpra o critério da Seção 8 — e um MVP que atravessa G1
sem instrumento de medição chega a G4 com um sistema que funciona e sem a evidência que
altera decisão de investimento.

---

## Achados, por severidade

### A1 — ALTA. Nenhum artefato da Fase 0 instrumenta custo, e seis das oito lacunas da Seção 1.1 são lacunas de custo ou de disposição a pagar

**Artefato:** `docs/contracts/db/ops/100_visoes_auditoria.sql` (`ops.vw_placar_conciliacao`),
`docs/contracts/db/ops/080_conciliacao.sql` (`sim.injecao`), e a ausência correspondente
em todo `docs/contracts/db/ops/*.sql` e `docs/contracts/openapi/*.yaml`.

Existe exatamente um placar no repositório, e ele mede uma coisa: quantas divergências
injetadas foram detectadas e em quanto tempo. É o instrumento certo para a lacuna nº 1.
Não existe nenhum outro. Uma varredura por campos de custo, tarifa, esforço ou
contrapartida econômica em `docs/contracts/db/`, `docs/contracts/openapi/` e
`docs/contracts/events/` retorna apenas `latencia_ms`, `duracao_ms` e `latencia_ms` de
fonte de oráculo — tempo de máquina, não custo econômico.

Confronte-se isso com o enunciado das lacunas. F1 é, literalmente, "custo real de
verificação por produtor": `ops.produtor` guarda `situacao_kyc` e `kyc_valido_ate`, e
nada que permita dizer quantas intervenções manuais, quantas horas de analista, quantas
fontes falhadas ou quantos reprocessamentos um onboarding consumiu. F4 é "custo e
viabilidade do selo": `ops.evidencia_eudr` guarda o resultado e o hash, e nada sobre o
que custou produzi-lo — inclusive quando `LIMITROFE` obriga reavaliação. F7 é
"disposição a pagar do lado credor", tratada em A5. F5 e F6 são lacunas de calibração
cujo insumo — dispersão observada, prazo real de recuperação — a base prevê armazenar
(`ops.simulacao_nivel_resultado.recuperacao_dias_p50/p90`), mas apenas como parâmetro de
entrada da simulação, nunca como observação medida.

Consequência econômica: o valor da informação comprada por esta fase é muito menor do
que o custo pago por ela sugere. Um sistema que funciona e não mede o que custa
funcionar é infraestrutura, não instrumento. A Seção 12 do briefing exige que o dossiê
de G4 responda, lacuna por lacuna, se foi resolvida; como especificado, a resposta será
verificável para F3 e narrada para as demais.

### A2 — ALTA. A lacuna nº 1 é comprada contra um simulador cuja interface a própria equipe especificou, e a premissa mais carregada do MVP não tem ADR

**Artefato:** `docs/contracts/openapi/registradora.yaml` (rotas `/titulos/{entidade}/{registro_id}`
e `GET /titulos?desde=`, esquema `Titulo` com `onus`, `cessoes`, `conteudo_hash`);
`docs/contracts/db/ops/080_conciliacao.sql` (`ops.politica_divergencia`, SLA de 15 minutos
e de 1 minuto para `DUPLICIDADE_DE_ANCORA`); `docs/adr/README.md` (índice com quatro ADRs).

O briefing (6.2) manda simular a registradora, e o simulador está bem construído: o
schema `sim`, a tabela `sim.injecao` como placar e os doze tipos do catálogo são o
desenho correto do teste de aceite. O problema não é o simulador; é o que se conclui
dele. O sistema detectará divergências que ele próprio injetou, num formato de resposta
que ele próprio desenhou, num canal de notificação que ele próprio presumiu existir. O
que isso compra é a corretude do algoritmo de comparação — real, mas barata. O que não
compra é a viabilidade econômica da conciliação contínua, que depende de três premissas
embutidas no `registradora.yaml` e nunca declaradas como tais:

1. que a entidade autorizada exponha um feed incremental de alterações por marco temporal;
2. que a projeção do título inclua ônus averbados, cessões registradas e um hash
   documental estável — sem `onus` e `cessoes`, quatro dos doze tipos de divergência
   ficam indetectáveis por construção;
3. que a consulta seja tarifada de forma compatível com um SLA de detecção de 15 minutos.

Se qualquer uma cair, o SLA da `ops.politica_divergencia` é ficção e o congelamento
automático — que é o mecanismo de enforcement inteiro de P1 — não dispara a tempo. Não
verifiquei nesta sessão a interface, a granularidade de atualização nem o preço praticado
por registradoras autorizadas de CPR no Brasil. [#REF]

Sob a minha pergunta-guia: o custo de monitoramento não é eliminado, é deslocado para
uma fatura de consulta que ninguém precificou. E, pela regra da Seção 3.2 passo 5 —
"não há decisão não registrada" —, a premissa mais carregada do projeto deveria ter um
ADR com critérios de revisão, como têm a escolha da rede e a política de quórum. Não tem.

### A3 — MÉDIA-ALTA. A garantia de "nenhuma decisão contratual com fonte única" é mais forte no ADR do que no artefato, e a diferença recai sobre o produtor

**Artefato:** `docs/contracts/db/ops/060_oraculos.sql` — `CONSTRAINT efetiva_tem_quorum`
(exige apenas `fontes_independentes >= 1` para os estados `EFETIVA` e `DEGRADADA`),
`ops.politica_quorum` (`PRECO` com `permite_degradado = true`), e a função
`ops.fn_valida_uso_leitura`, que aceita `DEGRADADA` como insumo de decisão contratual;
`docs/contracts/db/ops/050_garantias_e_waterfall.sql` (`ops.evento_inadimplencia.gatilho`
inclui `LTV_ROMPIDO`); `docs/adr/0003-politica-quorum-oraculos.md`, que afirma em negrito
"**Não há caminho de código que produza decisão contratual com fonte única.**"

O DDL não sustenta a afirmação. O caminho está aberto e é curto: preço em degradação com
uma única fonte independente → `ops.marcacao_mercado` → `ltv_pct` → gatilho
`LTV_ROMPIDO` → `ops.evento_inadimplencia` → percurso de garantias. As três camadas que o
ADR invoca protegem coisas diferentes do que ele promete: o CHECK em `politica_quorum`
impede *configurar* leitura contratual de fonte única, e o gatilho em `uso_leitura` impede
consumir leitura *sem efeito* — nenhum dos dois impede consumir uma leitura efetiva
produzida em degradação.

A assimetria importa porque as consequências não são simétricas. O credor que age sobre
um preço degradado vê uma bandeira de degradação; o produtor que sofre a excussão sobre
esse preço não vê nada e não tem, na especificação, caminho de contestação próprio — a
`ops.disputa_leitura` registra `aberta_por_ref` mas nenhuma rota, política ou prazo
garante que o produtor seja parte legitimada a abri-la. É o padrão clássico de
transferência disfarçada de eliminação: o custo de mensuração residual não sumiu, foi
alocado a quem tem menos informação e menos voz.

### A4 — MÉDIA. Nada verifica que o polígono ingerido é o talhão do produtor, e o incentivo do produtor é submeter o polígono conforme, não o correto

**Artefato:** `docs/contracts/openapi/eudr.yaml` (`POST /talhoes`, que aceita GeoJSON ou
KML com validação apenas topológica; `422` para "autointerseção, área incoerente,
projeção errada"); `docs/contracts/db/ops/030_produtor_e_talhao.sql`
(`geo.talhao_geometria.origem` com valores `SICAR | UPLOAD_KML | LEVANTAMENTO_CAMPO`;
`CONSTRAINT area_coerente`); `docs/contracts/db/ops/070_eudr.sql`
(`ops.evidencia_eudr`, `ops.dds`).

O `area_coerente` compara área declarada com área calculada, e ambas derivam do mesmo
artefato entregue pelo produtor: pega erro de digitação, não pega substituição. O quórum
geoespacial do ADR-0003 dá redundância sobre *onde há desmatamento*, por interseção de
duas bases independentes — decisão correta e bem fundamentada —, mas nenhuma redundância
sobre *de quem é aquele polígono*. A `origem` é registrada e depois não faz diferença
alguma: nenhum CHECK, nenhuma política e nenhum campo de `ops.evidencia_eudr` ou de
`ops.dds` distingue um selo apoiado em geometria puxada do SICAR de um selo apoiado em
um KML anexado por quem tem interesse direto no resultado. O credor que lê a evidência
não consegue ver essa diferença, o que é o mesmo que ela não existir para efeito de
decisão.

O incentivo é inequívoco: sob a EUDR, o polígono conforme do vizinho é a rota mais barata
para o selo. Não conferi nesta sessão incidência documentada de substituição de polígono
na prática do setor cafeeiro. [#REF] A consequência econômica independe da incidência: se
o elo mais fraco do selo é uma declaração não verificada, o custo de mensuração foi
empurrado adiante — para o comprador europeu, para a auditoria futura, ou de volta para
a visita de campo que a plataforma existe para eliminar.

### A5 — MÉDIA. Componente sem lacuna correspondente (DID/VC) e lacuna sem componente correspondente (F7, disposição a pagar)

**Artefato:** `docs/contracts/openapi/compliance.yaml`
(`GET/POST /produtores/{ref}/credenciais`, `POST /verificacoes/credencial`);
`docs/contracts/db/ops/030_produtor_e_talhao.sql` (`ops.produtor.did`);
`services/compliance/AGENT.md` (W5); e, do outro lado, `apps/web/AGENT.md`.

A camada de identidade descentralizada e credenciais verificáveis não mapeia para
nenhuma das oito lacunas. F1 pergunta quanto custa verificar um produtor; emitir
credencial portátil não mede esse custo — pressupõe um mercado futuro de reuso da
credencial que o MVP não vai observar, porque não há segunda parte no piloto para
apresentá-la. Que a Seção 5 do briefing a liste na stack não a salva: a regra de ouro da
Seção 1.2 diz que proposta sem lacuna correspondente é rejeitada por padrão, e essa
regra vale contra o briefing tanto quanto contra um agente construtor. É escopo
expandido com carimbo, que é a variedade mais difícil de cortar depois.

Do lado oposto, F7 — "disposição a pagar do lado credor" — não tem instrumento nenhum.
O `apps/web/AGENT.md` define o painel do comprador por cliques, primeira dobra e
ausência de jargão, e sua definição de pronto é um teste de usabilidade. São critérios de
E7, não meus. Nada em `core.yaml` nem em `ops` registra a reação revelada de um credor:
um preço oferecido, um prazo alterado, uma taxa exigida, uma recusa e seu motivo. Um
painel bem desenhado que nunca registra uma decisão de contraparte produz demonstração,
que é exatamente o critério que o briefing (Seção 1, parágrafo final) declara insuficiente.

---

## Custo de verificação residual (item 4 do meu checklist)

A resposta não é "nada", e convém que fique escrita antes que alguém a esqueça. Mesmo com
tudo funcionando como especificado, o credor continua tendo de verificar por conta
própria: (i) que o polígono é do produtor (A4); (ii) que a conciliação de fato rodou —
`ops.conciliacao_execucao` e `ops.divergencia` vivem na base do operador, e ausência de
divergência é indistinguível de ausência de conciliação para quem olha de fora; (iii) que
uma divergência classificada como `FALSO_POSITIVO` em `ops.divergencia` realmente o era,
sendo que quem classifica é o operador e a classificação o favorece; e (iv) a existência
física e a qualidade da safra penhorada, que nenhum módulo do MVP toca.

O item (ii) merece registro à parte porque é estrutural: o único sinal inegável a
terceiros é o evento `EspelhoCongelado` em `contracts/interfaces/IEspelhoCPR.sol`, que
só existe quando há divergência. O silêncio não prova vigilância, e é o silêncio que o
credor vai observar 99% do tempo.

---

## Condição para que as ressalvas se convertam em aprovação plena

Não proponho implementação. Registro apenas o que precisa existir como decisão registrada
e como evidência mensurável antes de G4, sob pena de o dossiê daquele portão não poder
cumprir o critério da Seção 8: um instrumento de medição de custo por lacuna (A1); um ADR
sobre a interface e a economia da registradora real, com critérios de revisão (A2); a
reconciliação entre o texto do ADR-0003 e o que o DDL efetivamente garante, em qualquer
das duas direções (A3); a distinção visível, para o credor, entre selo apoiado em
geometria verificada e em declaração (A4); e a decisão explícita de cortar DID/VC ou de
apontar a lacuna que ele fecha (A5).

## Marcações [#REF] deste parecer

1. Interface, granularidade de atualização e preço de consulta praticados por
   registradoras autorizadas de CPR no Brasil — não verificados nesta sessão (A2).
2. Incidência documentada de substituição de polígono na prática do setor cafeeiro —
   não verificada nesta sessão (A4).
