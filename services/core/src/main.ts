import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { GuardaEscopo, GuardaSimulador, origensPermitidas, ambiente } from '@cpr/nucleo';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule, new FastifyAdapter({ logger: false }), { logger: ['error', 'warn'] });

  // CORS sem curinga: fora de desenvolvimento, sem CORS_ORIGENS declarada, o
  // navegador simplesmente não fala com esta API.
  app.enableCors({ origin: origensPermitidas(), credentials: true });

  // A ordem importa: a guarda do simulador responde 404 antes da autenticação,
  // para que a superfície de simulação não se revele nem a quem tem token.
  app.useGlobalGuards(new GuardaSimulador(), new GuardaEscopo(app.get(Reflector), 'services/core'));

  const porta = Number(process.env.PORTA_CORE ?? 3003);
  await app.listen(porta, '0.0.0.0');
  process.stdout.write(JSON.stringify({ servico: 'core', porta, ambiente: ambiente(), ok: true }) + '\n');
}
bootstrap();
