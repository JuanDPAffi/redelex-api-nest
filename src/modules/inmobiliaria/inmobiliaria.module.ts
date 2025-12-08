import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InmobiliariaController } from './controllers/inmobiliaria.controller'; // <--- Agregado
import { InmobiliariaService } from './services/inmobiliaria.service';       // <--- Agregado
import { Inmobiliaria, InmobiliariaSchema } from './schema/inmobiliaria.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Inmobiliaria.name, schema: InmobiliariaSchema },
    ]),
  ],
  controllers: [InmobiliariaController], // <--- Agregado
  providers: [InmobiliariaService],      // <--- Agregado
  exports: [MongooseModule, InmobiliariaService], // Exportamos Service por si acaso
})
export class InmobiliariaModule {}