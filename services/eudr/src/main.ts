import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), {
    logger: ['error', 'warn'],
  });
  app.enableCors();
  const porta = Number(process.env.PORTA_EUDR ?? 3004);
  await app.listen(porta, '0.0.0.0');
  process.stdout.write(JSON.stringify({ servico: 'eudr', porta, ok: true }) + '\n');
}
bootstrap();
