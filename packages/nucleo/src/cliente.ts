import { emitirToken } from './auth';

/**
 * Chamada entre serviços. Cada serviço se identifica com token próprio de
 * perfil `servico` — não com o token do usuário que originou a requisição.
 *
 * A escolha é deliberada: repassar o token do usuário faria o serviço agir com
 * a autoridade dele, e um credor acabaria conseguindo, por via indireta, o que
 * o escopo dele recusa na porta da frente. Confusão de delegação é assim que
 * autorização correta vira autorização inútil.
 */
let cache: { token: string; expiraEm: number } | null = null;

const tokenDeServico = (nome: string): string => {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora + 30_000) return cache.token;
  const ttl = 900;
  cache = { token: emitirToken({ perfil: 'servico', sub: nome, ttlSegundos: ttl }), expiraEm: agora + ttl * 1000 };
  return cache.token;
};

export interface OpcoesChamada {
  metodo?: 'GET' | 'POST';
  corpo?: unknown;
  correlacaoId?: string;
  servico: string;
}

export const chamar = async (url: string, o: OpcoesChamada): Promise<Response> =>
  fetch(url, {
    method: o.metodo ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokenDeServico(o.servico)}`,
      ...(o.correlacaoId ? { 'x-correlacao-id': o.correlacaoId } : {}),
    },
    ...(o.corpo !== undefined ? { body: JSON.stringify(o.corpo) } : {}),
  });

/** Atalho para as chamadas que só querem o JSON. */
export const chamarJson = async <T>(url: string, o: OpcoesChamada): Promise<T> =>
  (await chamar(url, o)).json() as Promise<T>;
