// Acesso aos serviços. Tudo do lado do servidor: o navegador não fala com o
// núcleo nem com o compliance, e nenhuma credencial de serviço chega ao cliente.
const CORE = process.env.URL_CORE ?? 'http://127.0.0.1:3003';
const COMPLIANCE = process.env.URL_COMPLIANCE ?? 'http://127.0.0.1:3001';
const ORACLE = process.env.URL_ORACLE ?? 'http://127.0.0.1:3002';
const EUDR = process.env.URL_EUDR ?? 'http://127.0.0.1:3004';

const pegar = async <T>(url: string, padrao: T): Promise<T> => {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return padrao;
    return (await r.json()) as T;
  } catch {
    return padrao;
  }
};

export const postar = async <T>(url: string, corpo: unknown): Promise<T> => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlacao-id': crypto.randomUUID() },
    body: JSON.stringify(corpo),
    cache: 'no-store',
  });
  return (await r.json()) as T;
};

export interface Contrato {
  id: string; registro_id: string; estado: string; situacao_conciliacao: string;
  commodity: string; quantidade_sacas: string; valor_face: string; valor_mtm: string | null;
  vencimento: string; selo_eudr: string | null; produtor_ref: string; token_id: string | null;
}

export interface Divergencia {
  id: string; tipo: string; severidade: string; estado: string; campo: string | null;
  valor_registro: unknown; valor_onchain: unknown; ocorrida_em: string | null;
  detectada_em: string; latencia_deteccao_ms: number | null; congelou_contrato: boolean;
}

export const listarContratos = () =>
  pegar<{ itens: Contrato[] }>(`${CORE}/contratos`, { itens: [] }).then((r) => r.itens);

export const obterContrato = (id: string) => pegar<Contrato | null>(`${CORE}/contratos/${id}`, null);

export const obterConciliacao = (id: string) =>
  pegar<{ situacao: string; ultima_execucao_em: string | null; divergencias: Divergencia[] }>(
    `${CORE}/contratos/${id}/conciliacao`, { situacao: 'NAO_APLICAVEL', ultima_execucao_em: null, divergencias: [] });

export const obterTrilha = (id: string, ate?: string) =>
  pegar<Array<{ quando: string; categoria: string; fato: string; origem: string; evidencia: unknown }>>(
    `${CORE}/contratos/${id}/trilha${ate ? `?ate=${encodeURIComponent(ate)}` : ''}`, []);

export const obterGarantias = (id: string) =>
  pegar<Array<Record<string, unknown>>>(`${CORE}/contratos/${id}/garantias`, []);

export const obterPlacar = () =>
  pegar<{ por_tipo: Array<Record<string, unknown>>; total_injetadas: number; total_detectadas: number; cobertura_pct: number | null }>(
    `${CORE}/placar/conciliacao`, { por_tipo: [], total_injetadas: 0, total_detectadas: 0, cobertura_pct: null });

export const obterDegradacao = () =>
  pegar<Array<{ tipo: string; fontes_ativas: number; fontes_independentes_ativas: number; fontes_exigidas: number; sem_quorum: boolean }>>(
    `${ORACLE}/saude/degradacao`, []);

export const obterLinhagem = (leituraId: string) =>
  pegar<Record<string, any> | null>(`${ORACLE}/leituras/${leituraId}/linhagem`, null);

export const obterSituacaoProdutor = (ref: string) =>
  pegar<Record<string, any> | null>(`${COMPLIANCE}/produtores/${ref}/situacao`, null);

export const obterTratamentos = (ref?: string) =>
  pegar<Array<Record<string, unknown>>>(
    `${COMPLIANCE}/tratamentos${ref ? `?produtor_ref=${ref}` : ''}`, []);

export const obterCadeiaAuditoria = () =>
  pegar<{ registros: number; inconsistentes: number }>(`${CORE}/auditoria/cadeia`, { registros: 0, inconsistentes: 0 });

export const obterTalhao = (id: string) => pegar<Record<string, any> | null>(`${EUDR}/talhoes/${id}`, null);
export const obterEvidencia = (id: string) => pegar<Record<string, any> | null>(`${EUDR}/evidencias/${id}`, null);
export const obterBases = () => pegar<Array<Record<string, unknown>>>(`${EUDR}/bases`, []);

export const URLS = { CORE, COMPLIANCE, ORACLE, EUDR };
