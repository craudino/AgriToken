# 7. Autenticação — escopos, perfis e recusa por omissão

> `packages/nucleo/src/auth.ts` e `guarda.ts`. 21 casos de autorização
> verificados por `infra/demo/aceite-auth.mjs`.

## 7.0 O princípio do desenho

```ts
/**
 * Princípio que rege o desenho: **nenhuma rota é pública por omissão**. Quem
 * escrever rota nova sem declarar escopo recebe recusa, não liberação — o
 * inverso é como toda API acaba aberta sem ninguém decidir isso.
 */
```

Toda API que acaba aberta seguiu o mesmo caminho: o padrão era liberar, alguém
esqueceu de anotar uma rota, e ninguém percebeu porque nada falhou. Aqui o
esquecimento falha no primeiro teste.

---

## 7.1 JWT HS256 escrito à mão — a troca

```ts
/**
 * O JWT é HS256 implementado aqui, sem dependência externa: são trinta linhas
 * de código verificável contra uma cadeia de dependências que ninguém audita.
 */
```

Escrever criptografia à mão geralmente é má ideia, e a exceção precisa ser
justificada. O que se ganha: trinta linhas auditáveis em uma sentada, sem
árvore de dependências transitivas em um sistema cuja premissa é
auditabilidade. O que se perde: as correções de segurança que uma biblioteca
madura recebe.

A troca é consciente e **tem prazo**:

```ts
/**
 * A troca vale enquanto o segredo for simétrico e compartilhado entre serviços
 * do mesmo perímetro; um emissor externo com JWKS é o passo seguinte, e a
 * verificação abaixo é o ponto único onde ele entra.
 */
```

O comentário nomeia a condição de validade e onde a substituição acontece. Isso
é o mínimo que uma decisão dessas deve deixar registrado.

### As armadilhas clássicas, fechadas

```ts
// 'alg: none' e a confusão de algoritmo são as duas falhas clássicas de JWT;
// aceitar o algoritmo que o token declara é confiar no atacante.
if (cab.alg !== 'HS256') throw new ErroAutenticacao(401, 'algoritmo não aceito');
```

Um verificador que lê `alg` do token e usa o algoritmo indicado aceita
`alg: none` e aceita um token HS256 assinado com a chave pública RS256. [#REF] A
verificação **impõe** HS256 em vez de perguntar.

```ts
if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) …
```

Comparação em tempo constante. `===` sobre assinatura vaza informação por
tempo de resposta.

### O segredo de desenvolvimento

```ts
// Um segredo de desenvolvimento em ambiente que não é de desenvolvimento é a
// forma mais comum de uma API "autenticada" ser aberta na prática.
if (!ehDesenvolvimento() && s === SEGREDO_DESENVOLVIMENTO) throw new Error(…);
if (!ehDesenvolvimento() && s.length < 32) throw new Error(…);
```

O processo **não sobe** com o segredo padrão fora de desenvolvimento, nem com
segredo curto. Falha alta na partida, em vez de API aparentemente autenticada
com chave pública no repositório.

---

## 7.2 Escopos — 22, granulares por ação

```
contrato:ler            contrato:escrever
conciliacao:executar    conciliacao:reconciliar
produtor:onboarding     produtor:ler
pii:eliminar            pii:tratamentos
credencial:emitir       credencial:verificar
participante:habilitar
geo:ingerir  geo:avaliar  geo:bruto
dds:emitir
oraculo:ler  oraculo:coletar  oraculo:disputar  oraculo:publicar-fonte
registro:ler            auditoria:ler
simulador:operar
```

Dois pares merecem explicação, porque a separação é o ponto:

**`conciliacao:executar` × `conciliacao:reconciliar`** — disparar um ciclo é uma
coisa; decidir que uma divergência está resolvida é outra, muito mais grave. Um
escopo só juntaria as duas, e o serviço que detecta passaria a poder dispensar.

**`geo:avaliar` × `geo:bruto`** — avaliar conformidade não exige ver o polígono.
Só o serviço EUDR precisa da geometria bruta; painel e credor veem o veredito e
o centroide ofuscado.

---

## 7.3 Perfis — sete, cada um com uma frase que o justifica

```ts
/** Perfis. O token carrega escopos; o perfil é só a forma de emiti-los. */
```

A verificação é sempre sobre escopo. O perfil é conveniência de emissão, não
autoridade — o que evita a classe de bug em que uma checagem confere o perfil e
outra confere o escopo, e as duas divergem.

| Perfil | Escopos | A razão, no código |
|---|---|---|
| `produtor` | 4 | *"Vê o que é dele e origina. Não concilia, não reconcilia."* |
| `credor` | 3 | *"Avalia antes de ofertar: lê contrato, evidência e linhagem."* |
| `operador-conciliacao` | 4 | *"Separar este papel de quem espelha é o que impede que o mesmo processo que detecta a divergência também a dispense (P1)."* |
| `operador-privacidade` | 3 | *"Executa pedido de titular. **Não vê contrato.**"* |
| `auditor` | 5 | *"Leem tudo o que é leitura, e não escrevem nada."* |
| `servico` | 17 | Chamadas entre serviços |
| `demonstracao` | 22 | Tudo, **só em desenvolvimento** |

Duas decisões que uma modelagem menos cuidadosa erraria:

**`operador-privacidade` não vê contrato.** Quem opera pedido de eliminação
precisa do titular, não do negócio. Dar acesso "porque é operador" ampliaria a
superfície de PII sem necessidade.

**`credor` não tem `geo:bruto`.** Quem compra risco vê o selo EUDR, a evidência
e a linhagem do oráculo — não o polígono. A avaliação de risco não exige
identificar a propriedade.

**`servico` tem 17 escopos e nenhum deles é `conciliacao:reconciliar`,
`oraculo:disputar` ou `simulador:operar`.** As três ações que exigem decisão
humana estão fora do alcance de qualquer processo automático. É aqui que a
promessa "não existe reconciliação automática" deixa de ser afirmação e vira
propriedade verificável.

---

## 7.4 As duas defesas do perfil de demonstração

```ts
if (p.perfil === 'demonstracao' && !ehDesenvolvimento())
  throw new ErroAutenticacao(403, 'perfil de demonstração não vale fora de desenvolvimento');
if (p.escopos?.includes('simulador:operar') && !ehDesenvolvimento())
  throw new ErroAutenticacao(403, 'escopo de simulador não vale fora de desenvolvimento');
```

Duas checagens, porque um token assinado válido com perfil `servico` e o escopo
`simulador:operar` injetado à mão passaria pela primeira. A segunda olha o
escopo efetivo, não o rótulo.

E ainda há a terceira camada: `GuardaSimulador` devolve **404** para `/sim/*`
fora de desenvolvimento, antes da autenticação (`02-nucleo.md` §2.4).

Três camadas para a mesma coisa é excesso quando a falha é recuperável. Aqui a
falha é "alguém injeta divergência no registro em produção", que não é.

---

## 7.5 CORS sem curinga

```ts
export const origensPermitidas = (): string[] | boolean => {
  const lista = (process.env.CORS_ORIGENS ?? '').split(',')…;
  if (lista.length) return lista;
  if (ehDesenvolvimento()) return ['http://127.0.0.1:3000', 'http://localhost:3000'];
  // Sem lista declarada fora de desenvolvimento, o navegador não fala com a API.
  return false;
};
```

Fora de desenvolvimento, **sem lista declarada não há CORS**. O padrão seguro é
o fechado, e a alternativa (`*` quando a variável não existe) é como CORS
permissivo chega em produção sem ninguém ter decidido isso.

---

## 7.6 A guarda global

```ts
const exigidos = this.reflector.getAllAndOverride<Escopo[]>(CHAVE_ESCOPOS, alvos);
if (!exigidos) throw new HttpException({ …, status: 403, principio_violado: 'P7' }, 403);
```

Rota sem `@Escopos` e sem `@Publica` → 403 com `principio_violado: 'P7'`. O erro
diz qual princípio a rota violou, não apenas que faltou anotação.

Escopo insuficiente é registrado em log de aviso: *"escopo insuficiente repetido
é sinal, não ruído."*

---

## 7.7 O que a autenticação encontrou

Esta é a parte mais útil do documento, e o argumento a favor de fazer
autorização estrita mesmo em protótipo.

Ao aplicar os escopos, **dois acoplamentos indevidos apareceram** — ambos em
código que funcionava e que havia passado por revisão:

1. **`OriginacaoService.registrar()` escrevia no simulador de registradora.** O
   token `servico` não tem `simulador:operar`; a chamada foi recusada. Isso
   expôs que o núcleo fabricava a verdade registral que depois tratava como
   fonte — violação direta de P1. Reescrito como leitura-confirmação.

2. **O serviço EUDR publicava leituras via `/sim/geo`.** Mesma recusa, mesma
   descoberta: um serviço de produção usando superfície de simulação como
   caminho normal. Criada a rota legítima `POST /leituras/fonte`, com escopo
   próprio.

Em nenhum dos dois casos a revisão de código havia notado. O que notou foi a
autorização, porque ela força cada chamada a declarar sob qual autoridade age —
e autoridade que não existe não se consegue declarar.

---

## 7.8 Os 21 casos verificados

`infra/demo/aceite-auth.mjs` verifica, entre outros:

- rota sem escopo → 403;
- token ausente → 401; expirado → 401; assinatura adulterada → 401;
- `alg: none` → 401;
- perfil errado para a rota → 403;
- `credor` tentando reconciliar → 403;
- `operador-privacidade` tentando ler contrato → 403;
- `/sim/*` com `AMBIENTE=producao` → 404.

### O teste tautológico que eu escrevi

Um dos casos era:

```js
codigo === 404 ? 201 : 201       // passava sempre
```

O caso "passava" em qualquer resultado. Era exatamente o defeito que este
projeto vinha criticando nos outros — teste verde que não verifica nada — e
estava no meu próprio arquivo de aceite de autorização.

Reescrito para afirmar o par correto ("autorizado" × "recusado") conforme o
ambiente. Vale registrar porque o padrão é insidioso: um condicional que trata
dois ambientes acaba com os dois ramos no mesmo valor, e o verde é indistinguível
do verde legítimo.

---

## 7.9 O que falta para produção

Registrado honestamente:

- **Segredo simétrico compartilhado.** Comprometer um serviço permite forjar
  token de qualquer perfil. Produção exige emissor externo com JWKS e chaves
  assimétricas — o ponto de substituição está marcado em `verificarToken`.
- **Sem revogação.** `jti` existe no payload e não há lista de revogação. Token
  vazado vale até expirar (1 h no padrão, 15 min para serviço).
- **Sem rotação de segredo.** Trocar o segredo invalida todos os tokens de uma
  vez.

Nenhuma dessas é difícil; todas exigem infraestrutura que o protótipo não tem.
Estão em `docs/ESTADO-DO-PROTOTIPO.md`.

---

**Próximo:** [8. Interfaces](08-interfaces.md).
