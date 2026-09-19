import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { QuorumService } from './quorum.service';
import { AgendaOraculoService } from './agenda.service';

@Module({ controllers: [AppController], providers: [QuorumService, AgendaOraculoService] })
export class AppModule {}
