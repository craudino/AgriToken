import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, HttpException, applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Escopo, Principal, verificarToken, temEscopo, ErroAutenticacao, ehDesenvolvimento } from './auth';
import { log, versaoServico } from './index';

export const CHAVE_ESCOPOS = 'cpr:escopos';
export const CHAVE_PUBLICA = 'cpr:publica';

/** Declara os escopos exigidos por uma rota. */
export const Escopos = (...escopos: Escopo[]) => SetMetadata(CHAVE_ESCOPOS, escopos);

/**
 * Marca rota como pública. Só `/saude` deveria usar isto, e o uso fica visível
 * no diff — que é o objetivo: abrir rota precisa ser um ato deliberado.
 */
export const Publica = () => applyDecorators(SetMetadata(CHAVE_PUBLICA, true));

/**
 * Guarda global. A regra é a recusa por omissão: rota sem `@Escopos` e sem
 * `@Publica` responde 403. Quem esquecer de declarar escopo descobre no
 * primeiro teste, não no primeiro incidente.
 */
@Injectable()
export class GuardaEscopo implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly servico: string) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const alvos = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICA, alvos)) return true;

    const exigidos = this.reflector.getAllAndOverride<Escopo[]>(CHAVE_ESCOPOS, alvos);
    if (!exigidos) {
      throw new HttpException(
        { title: 'Rota sem escopo declarado', status: 403, principio_violado: 'P7',
          detail: 'Recusa por omissão: declare @Escopos ou @Publica.' }, 403);
    }

    const cabecalho = String(req.headers?.authorization ?? '');
    if (!cabecalho.startsWith('Bearer ')) {
      throw new HttpException({ title: 'Credencial ausente', status: 401 }, 401);
    }

    let principal: Principal;
    try {
      principal = verificarToken(cabecalho.slice(7));
    } catch (e) {
      const erro = e as ErroAutenticacao;
      throw new HttpException({ title: erro.motivo ?? 'Credencial inválida', status: erro.status ?? 401 },
                              erro.status ?? 401);
    }

    if (!temEscopo(principal, exigidos)) {
      // O log registra a tentativa: escopo insuficiente repetido é sinal, não ruído.
      log.aviso({ correlacaoId: String(req.headers?.['x-correlacao-id'] ?? '-'), origem: versaoServico(this.servico) },
        'acesso recusado por escopo', { sub: principal.sub, perfil: principal.perfil, exigidos });
      throw new HttpException(
        { title: 'Escopo insuficiente', status: 403, detail: `exigido: ${exigidos.join(', ')}` }, 403);
    }

    req.principal = principal;
    return true;
  }
}

/**
 * Rotas de simulação só existem em desenvolvimento. O escopo já é recusado
 * fora dele, e esta guarda fecha a porta de novo no próprio serviço: uma
 * superfície que injeta divergência em registro não pode existir onde há dado
 * real, nem que o token esteja correto.
 */
@Injectable()
export class GuardaSimulador implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const rota = String(req.url ?? '');
    if (rota.startsWith('/sim/') && !ehDesenvolvimento()) {
      throw new HttpException(
        { title: 'Superfície de simulação indisponível neste ambiente', status: 404 }, 404);
    }
    return true;
  }
}

/** Principal da requisição, para quem precisa saber quem agiu. */
export const principalDe = (req: unknown): Principal | undefined =>
  (req as { principal?: Principal }).principal;
