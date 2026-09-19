# 8. Interfaces — três superfícies com propósitos opostos

> `apps/web` — Next.js 15.5, React 19, 13 arquivos de fonte, 968 linhas.
> Renderização no servidor, sem estado no cliente.

## 8.0 Por que três painéis e não um com permissões

Produtor, credor e auditor não querem versões diferentes da mesma tela. Querem
coisas **opostas**:

| Superfície | Objetivo | Deve esconder | Deve destacar |
|---|---|---|---|
| Produtor | Decidir rápido, sem carga cognitiva | Toda a mecânica | Quanto, quando, confirmar |
| Credor | **Não** decidir rápido; deliberar | Nada de ruim | O que está errado |
| Auditoria | Reconstruir o passado | Nada | Evidência e cadeia |

A tela do credor é deliberadamente **mais difícil** que a do produtor. Um painel
único com permissões teria de escolher um dos dois desenhos, e escolheria o
confortável.

---

## 8.1 A decisão de arquitetura: tudo no servidor

```ts
// Acesso aos serviços. Tudo do lado do servidor: o navegador não fala com o
// núcleo nem com o compliance, e nenhuma credencial de serviço chega ao
// cliente — o token é montado aqui, no servidor, e some antes do HTML sair.
```

Todas as páginas são *server components* (`export const dynamic =
'force-dynamic'`). Consequências:

- **Nenhuma credencial no navegador.** Não há token em `localStorage`, nem
  chamada direta do cliente às APIs.
- **Nenhum estado de cliente para divergir do servidor.** O que a tela mostra é
  o que a API devolveu naquele instante.
- **O CORS quase não importa** — o navegador não fala com as APIs. A restrição
  de origem existe assim mesmo, como segunda camada.

O custo é real: sem interatividade rica, cada ação é uma ida ao servidor. Para
três painéis de consulta e um fluxo de três passos, é troca favorável.

### O token de escopo reduzido

```ts
/**
 * A interface age com o escopo de leitura do credor, não com um token
 * onipotente: se uma tela passar a precisar de escopo que ela não tem, o erro
 * aparece no desenvolvimento em vez de um privilégio silencioso em produção.
 */
const ESCOPOS_WEB: Escopo[] = ['contrato:ler', 'auditoria:ler', 'oraculo:ler',
                               'produtor:ler', 'pii:tratamentos'];
```

Cinco escopos, todos de leitura. A interface **não consegue** reconciliar
divergência, eliminar titular, emitir DDS nem operar o simulador — mesmo que
alguém escreva o código que tente.

Sem `geo:bruto`: a web nunca vê polígono.

### Degradação silenciosa nas leituras

```ts
const pegar = async <T>(url: string, padrao: T): Promise<T> => {
  try { … if (!r.ok) return padrao; … } catch { return padrao; }
};
```

Serviço fora do ar → valor padrão, página renderiza. A alternativa (erro 500 na
página inteira porque um dos cinco serviços caiu) seria pior.

**Mas isto é uma troca com risco declarado:** degradação silenciosa pode
esconder falha. O que impede o pior caso é o desenho das telas — o painel do
credor mostra explicitamente "sem quórum" e "conciliação pendente" em vez de
omitir o campo. Ausência de dado aparece como ausência, não como zero.

`postar()` **não** degrada: escrita que falha precisa falhar.

---

## 8.2 O fluxo do produtor — e o teste que o vigia

```tsx
/**
 * Três decisões, e só três: quanto antecipar, de qual talhão, e confirmar.
 * Todo o resto — registro, espelho, conciliação, oráculo — acontece sem pedir
 * nada a quem planta café.
 */
```

Texto real da tela:

> **Antecipar a safra**
> Três passos. A gente cuida do resto e avisa se algo mudar.

Nenhuma palavra de sistema. Não há "token", "on-chain", "hash", "oráculo",
"quórum", "espelho", "âncora" nem "conciliação".

### `test/sem-jargao.mjs`

```js
// E7 aponta que o produtor abandona fluxo com jargão. A regra não sobrevive
// sem medição: jargão volta a aparecer a cada alteração, e ninguém percebe até
// o teste de usabilidade seguinte.
```

O validador tem três partes, e a segunda é a interessante:

**1. Lista de 19 palavras proibidas** no texto exibido.

**2. Extração só do texto visível.**

```js
// Comentário de código pode citar o jargão — explicar a regra não é violá-la.
```

Remove comentários e extrai apenas conteúdo entre tags e atributos visíveis
(`placeholder`, `title`, `aria-label`). Sem isso, o próprio comentário que
explica a regra reprovaria o arquivo — e a saída preguiçosa seria parar de
comentar, o que piora o código para satisfazer o validador.

**3. Contagem de decisões, não de telas.**

```js
// Contagem de decisões, não de telas: três etapas com sete escolhas cada é pior
// que cinco etapas com uma escolha cada.
const decisoes = botoes + campos;
if (passos > 3) falhas.push(…);
if (decisoes > 5) falhas.push(…);
```

Este é o ponto que quase toda métrica de usabilidade erra. "Três telas" é fácil
de cumprir espremendo tudo em três telas densas — e a carga cognitiva aumenta
enquanto a métrica melhora. Contar botões e campos mede o que importa.

---

## 8.3 O painel do credor — o ruim primeiro

```tsx
<p className="sub">
  O que está errado aparece primeiro. Contrato congelado não é detalhe de rodapé,
  e preço sem quórum não é preço.
</p>
```

A ordem da página é: faixa de alerta de contratos congelados → fontes sem quórum
→ placar de detecção → lista de contratos.

A ordem inversa (métricas bonitas no topo, problemas no rodapé) é o padrão de
mercado, e é o desenho que produz decisão de crédito mal informada. Se um
contrato está congelado por divergência, isso precisa ser a primeira coisa na
tela, não um ícone amarelo em uma coluna.

### Os selos que recusam o binário

```tsx
if (s === 'CONFORME')     return <span className="selo ok">EUDR conforme</span>;
if (s === 'NAO_CONFORME') return <span className="selo alerta">EUDR não conforme</span>;
if (s === 'LIMITROFE')    return <span className="selo atencao">EUDR limítrofe</span>;
return <span className="selo neutro">sem selo</span>;
```

Quatro estados, três cores. **"Limítrofe" e "sem selo" não são verdes.** A
tentação de mostrar dois estados (conforme / não conforme) simplificaria a tela
e mentiria: "sem selo" viraria verde por omissão, exatamente como "sem quórum"
viraria preço.

Mesmo desenho para conciliação: `CONGELADO` e `DIVERGENTE` em alerta,
`PENDENTE` em atenção (não em verde — pendente não é conciliado), `CONCILIADO`
em ok.

---

## 8.4 O painel de auditoria — três cliques

```tsx
/**
 * A pergunta do regulador — o que se sabia, quando e com base em quê — precisa
 * ser respondida em menos de três cliques: aqui, contrato (1) → trilha (2). O
 * terceiro clique é o detalhe da evidência.
 */
```

O alerta que abre a página:

```tsx
{cadeia.inconsistentes > 0 ? (
  <div className="faixa-alerta">
    Cadeia de auditoria inconsistente em {cadeia.inconsistentes} registro(s):
    alguém alterou ou suprimiu histórico. Este é o alerta mais importante e o
    mais esquecido.
  </div>
) : (
  … {cadeia.registros} registros … cadeia de hash íntegra, verificada agora —
  supressão de registro seria detectável
)}
```

O caso bom **também comunica**: diz que a verificação aconteceu *agora* e o que
ela detectaria. "Cadeia íntegra" sem dizer quando foi verificado é afirmação
sem valor — pode ser de meses atrás.

O placar de detecção declara suas próprias premissas:

```tsx
Tipos que dependem de premissas do simulador estão declarados no ADR-0006.
```

O painel mostra 13 de 14 tipos detectados e **não esconde o décimo quarto**.
`TITULO_INEXISTENTE_NO_REGISTRO` aparece como não detectado, e a nota de
`DUPLICIDADE_DE_ANCORA` explica que a detecção é por prevenção (o contrato
reverte a segunda emissão) e não por conciliação.

Um placar que mostrasse 14/14 escondendo as duas ressalvas seria mais bonito e
menos verdadeiro.

---

## 8.5 Rotas

```
/                     entrada com as três superfícies
/produtor             fluxo de três passos
/credor               painel de risco
/credor/[id]          contrato: conciliação, garantias, MTM
/auditoria            trilha, placar, cadeia, bases, tratamentos
/auditoria/[id]       trilha do contrato, com "o que se sabia até <data>"
```

`/auditoria/[id]` aceita o parâmetro `?ate=` e reconstrói o estado de
conhecimento **naquele instante**. É a materialização literal de P5 numa tela: o
auditor pergunta "o que vocês sabiam no dia 14 de março?" e a resposta é uma URL.

---

## 8.6 Estilo

`globals.css`, 95 linhas, sem framework. Variáveis CSS para as cores, quatro
classes de selo (`ok`, `atencao`, `alerta`, `neutro`), grade simples.

Não há Tailwind nem biblioteca de componentes. Para seis páginas de conteúdo
denso e pouca interação, a dependência custaria mais do que entrega — e o
repositório inteiro já carrega o argumento de minimizar cadeia de dependências
não auditada.

---

## 8.7 Segurança de dependências

Next.js **15.5.25**, atualizado a partir de 15.1.3 por causa de
CVE-2025-66478. [#REF] NestJS atualizado para 11.

Estado após as atualizações: de 10 vulnerabilidades em dependências de produção
(1 crítica) para **4, nenhuma crítica**. As quatro remanescentes estão em
dependências transitivas de ferramenta de desenvolvimento, sem versão corrigida
disponível no momento da medição.

O número é reportado como está, com a data da medição, em vez de arredondado
para "sem vulnerabilidades conhecidas".

---

## 8.8 O que a interface não faz

- **Não autentica pessoas.** Não há tela de login: o token é de serviço, montado
  no servidor. Autenticação de usuário final exige emissor de identidade, que o
  protótipo não tem (`07-autenticacao.md` §7.9).
- **Não escreve quase nada.** O fluxo do produtor é demonstrativo; a originação
  real acontece pela API.
- **Não tem acessibilidade verificada.** Há `aria-label` nos pontos óbvios, mas
  nenhuma auditoria de contraste, navegação por teclado ou leitor de tela foi
  feita. Declarar isso é mais útil que a alternativa.

---

**Próximo:** [9. Operação](09-operacao.md).
