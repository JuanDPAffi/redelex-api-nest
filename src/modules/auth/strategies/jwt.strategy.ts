import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt'; // OJO: Ya no usamos ExtractJwt aquí
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { Request } from 'express';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    super({
      // EXTRAER EL TOKEN DE LA COOKIE AUTOMÁTICAMENTE
      jwtFromRequest: (req: Request) => {
        let token = null;
        if (req && req.cookies) {
          token = req.cookies['redelex_token']; // Nombre de la cookie
        }
        return token;
      },
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

async validate(payload: JwtPayload) {
    const user = await this.userModel.findById(payload.id);

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado o sesión inválida');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Su cuenta ha sido desactivada');
    }

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      nit: user.nit 
    };
  }
}