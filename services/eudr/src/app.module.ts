import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { GeoService } from './geo.service';
import { EudrService } from './eudr.service';

@Module({ controllers: [AppController], providers: [GeoService, EudrService] })
export class AppModule {}
