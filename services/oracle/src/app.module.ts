import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { QuorumService } from './quorum.service';

@Module({ controllers: [AppController], providers: [QuorumService] })
export class AppModule {}
