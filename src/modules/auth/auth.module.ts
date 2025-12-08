import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SystemOrJwtGuard } from '../../common/guards/system-or-jwt.guard';
import { User, UserSchema } from './schemas/user.schema';
import {
  PasswordResetToken,
  PasswordResetTokenSchema,
} from './schemas/password-reset-token.schema';
import { Inmobiliaria, InmobiliariaSchema } from '../../modules/inmobiliaria/schema/inmobiliaria.schema'; // Ajusta la ruta si es necesario
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
      // 2. REGISTRAMOS EL SCHEMA DE INMOBILIARIA
      // Esto es obligatorio porque AuthService usa @InjectModel(Inmobiliaria.name)
      { name: Inmobiliaria.name, schema: InmobiliariaSchema },
    ]),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default_secret',
        signOptions: {
          expiresIn: '1h',
        },
      }),
      inject: [ConfigService],
    }),

    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    JwtStrategy, 
    JwtAuthGuard, 
    // 3. REGISTRAMOS EL SYSTEM GUARD
    // Al ponerlo aquí, Nest puede inyectarle ConfigService correctamente
    SystemOrJwtGuard 
  ],
  exports: [
    PassportModule, 
    JwtModule, 
    JwtAuthGuard,
    SystemOrJwtGuard // Exportamos para que otros módulos puedan usarlo
  ],
})
export class AuthModule {}