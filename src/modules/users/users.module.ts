import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';
import { User, UserSchema } from '../auth/schemas/user.schema'; // Reusamos el Schema
import { Inmobiliaria, InmobiliariaSchema } from '../inmobiliaria/schema/inmobiliaria.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Inmobiliaria.name, schema: InmobiliariaSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}