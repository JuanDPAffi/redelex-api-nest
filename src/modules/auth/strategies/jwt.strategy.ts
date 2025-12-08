import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
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
      jwtFromRequest: (req: Request) => {
        let token = null;
        
        // A. Intenta leer desde la Cookie (Prioridad 1)
        if (req && req.cookies && req.cookies['redelex_token']) {
          token = req.cookies['redelex_token'];
        }
        
        // B. Si no hay cookie, intenta leer desde el Header (Prioridad 2)
        if (!token) {
          token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
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
      permissions: user.permissions || [],
      nit: user.nit,
      nombreInmobiliaria: user.nombreInmobiliaria
    };
  }
}