import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { OriginacaoService } from './originacao.service';
import { ConciliacaoService } from './conciliacao.service';
import { MercadoService } from './mercado.service';
import { WaterfallService } from './waterfall.service';
import { LiquidacaoService } from './liquidacao.service';

@Module({
  controllers: [AppController],
  providers: [OriginacaoService, ConciliacaoService, MercadoService, WaterfallService, LiquidacaoService],
})
export class AppModule {}
