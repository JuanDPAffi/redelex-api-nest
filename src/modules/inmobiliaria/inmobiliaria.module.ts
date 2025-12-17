import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InmobiliariaController } from './controllers/inmobiliaria.controller';
import { InmobiliariaService } from './services/inmobiliaria.service';
import { Inmobiliaria, InmobiliariaSchema } from './schema/inmobiliaria.schema';
import { User, UserSchema } from '../auth/schemas/user.schema'; 

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Inmobiliaria.name, schema: InmobiliariaSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [InmobiliariaController],
  providers: [InmobiliariaService],
  exports: [MongooseModule, InmobiliariaService],
})
export class InmobiliariaModule {}