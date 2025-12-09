import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './config/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { RedelexModule } from './modules/redelex/redelex.module';
import { MailModule } from './modules/mail/mail.module';
import { InmobiliariaModule } from './modules/inmobiliaria/inmobiliaria.module'; // <--- AGREGAR ESTO
import { UsersModule } from './modules/users/users.module';
import { SupportModule } from './modules/support/support.module'; // <--- AGREGAR ESTO

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuthModule,
    RedelexModule,
    MailModule,
    InmobiliariaModule,
    UsersModule,
    SupportModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}