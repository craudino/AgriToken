import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { GeoService } from './geo.service';
import { EudrService } from './eudr.service';
import { AgendaEudrService } from './agenda.service';

@Module({ controllers: [AppController], providers: [GeoService, EudrService, AgendaEudrService] })
export class AppModule {}
