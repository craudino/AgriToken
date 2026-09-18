import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { CofreService } from './cofre.service';
import { EliminacaoService } from './eliminacao.service';
import { CredenciaisService } from './credenciais.service';

@Module({
  controllers: [AppController],
  providers: [CofreService, EliminacaoService, CredenciaisService],
})
export class AppModule {}
