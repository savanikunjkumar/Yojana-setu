import { Module } from '@nestjs/common';
import { SchemesController } from './schemes.controller';
import { SchemesService } from './schemes.service';
import { StatsService } from './stats.service';

@Module({
  controllers: [SchemesController],
  providers: [SchemesService, StatsService],
  exports: [SchemesService],
})
export class SchemesModule {}
