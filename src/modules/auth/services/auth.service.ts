import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
// Importamos ValidRoles y la constante de permisos por defecto
import { User, UserDocument, ValidRoles } from '../schemas/user.schema';
import { DEFAULT_ROLE_PERMISSIONS } from '../../../common/constants/permissions.constant'; // <--- IMPORTANTE

import {
  PasswordResetToken,
  PasswordResetTokenDocument,
} from '../schemas/password-reset-token.schema';
import { MailService } from '../../mail/services/mail.service';
import {
  RegisterDto,
  LoginDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/auth.dto';
import { Inmobiliaria, InmobiliariaDocument } from '../../inmobiliaria/schema/inmobiliaria.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    
    @InjectModel(Inmobiliaria.name)
    private readonly inmobiliariaModel: Model<InmobiliariaDocument>,

    @InjectModel(PasswordResetToken.name)
    private readonly passwordResetTokenModel: Model<PasswordResetTokenDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  private generateToken(user: UserDocument): string {
    const payload = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      // No incluimos permissions en el token para mantenerlo ligero.
      // La estrategia JWT (jwt.strategy.ts) los consultará de la BD.
    };
    return this.jwtService.sign(payload);
  }

  async register(registerDto: RegisterDto) {
    const { name, email, password, role, nit, codigoInmobiliaria } = registerDto;

    // 1. Verificar existencia del usuario
    const existingUser = await this.userModel.findOne({
      email: email.toLowerCase(),
    });
    if (existingUser) throw new ConflictException('El email ya está registrado');

    // 2. Validar datos obligatorios
    if (!nit || !codigoInmobiliaria) {
      throw new BadRequestException('NIT y Código de Inmobiliaria son obligatorios');
    }

    // 3. Buscar la inmobiliaria
    const inmobiliaria = await this.inmobiliariaModel.findOne({
      nit: nit,
      codigo: codigoInmobiliaria,
    });

    if (!inmobiliaria) {
      throw new BadRequestException('Datos de inmobiliaria inválidos (NIT o Código incorrectos)');
    }
    if (!inmobiliaria.isActive) {
      throw new UnauthorizedException('Esta inmobiliaria se encuentra inactiva');
    }

    // Normalizamos el email
    const emailLower = email.toLowerCase();
    const isAffiEmail = emailLower.endsWith('@affi.net');
    const isAffiCorporate = (nit === '900053370' && codigoInmobiliaria === 'AFFI');

    // REGLA 1: PROTECCIÓN CORPORATIVA
    if (isAffiCorporate && !isAffiEmail) {
      throw new UnauthorizedException('Restringido: El código AFFI solo puede ser usado por correos corporativos @affi.net');
    }

    // REGLA 2: ASIGNACIÓN DE PROPIEDAD
    if (!isAffiCorporate) {
      if (inmobiliaria.emailRegistrado) {
        if (inmobiliaria.emailRegistrado !== emailLower) {
           throw new ConflictException('Esta inmobiliaria ya tiene un usuario administrador registrado.');
        }
      } else {
        inmobiliaria.emailRegistrado = emailLower;
        await inmobiliaria.save();
      }
    }

    // 4. Hash password y Token
    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(32).toString('hex');

    // --- LOGICA DE ROLES ---
    const assignedRole = isAffiEmail ? ValidRoles.AFFI : ValidRoles.INMOBILIARIA;

    // --- NUEVO: ASIGNACIÓN DE PERMISOS POR DEFECTO ---
    // Buscamos en el mapa qué permisos le tocan a este rol
    const defaultPermissions = DEFAULT_ROLE_PERMISSIONS[assignedRole] || [];

    // 5. Crear usuario
    const user = await this.userModel.create({
      name,
      email: emailLower,
      password: hashedPassword,
      role: assignedRole,
      nit, 
      codigoInmobiliaria,
      nombreInmobiliaria: inmobiliaria.nombreInmobiliaria,
      activationToken: activationToken, 
      isVerified: false, 
      isActive: true, 
      permissions: defaultPermissions
    });

    const frontBase = this.configService.get<string>('FRONT_BASE_URL') || 'http://localhost:4200';
    const activationLink = `${frontBase}/auth/activate?token=${activationToken}&email=${encodeURIComponent(user.email)}`;

    this.mailService.sendActivationEmail(user.email, user.name, activationLink);

    return {
      message: 'Registro exitoso. Por favor revisa tu correo para activar la cuenta.',
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
    }).select('+password');

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Validaciones de estado
    if (!user.isVerified) {
      throw new UnauthorizedException('Debes activar tu cuenta. Revisa tu correo electrónico.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Su cuenta ha sido desactivada. Contacte al administrador.');
    }

    // Verificar Contraseña
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      const currentAttempts = (user.loginAttempts || 0) + 1;
      const maxAttempts = 3;
      const remaining = maxAttempts - currentAttempts;

      user.loginAttempts = currentAttempts;
      
      if (currentAttempts >= maxAttempts) {
        user.isActive = false;
        await user.save();
        throw new UnauthorizedException('Su cuenta ha sido desactivada por múltiples intentos fallidos.');
      } else {
        await user.save();
        throw new UnauthorizedException(`Credenciales inválidas. Le quedan ${remaining} intento(s).`);
      }
    }

    // Login Exitoso
    if (user.loginAttempts > 0) {
      user.loginAttempts = 0;
      await user.save();
    }

    const token = this.generateToken(user);

    return {
      message: 'Login exitoso',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [] // Enviamos permisos al front
      },
      token,
    };
  }

  async activateAccount(email: string, token: string) {
    const user = await this.userModel.findOne({ 
      email: email.toLowerCase() 
    }).select('+activationToken');

    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (user.isVerified) return { message: 'La cuenta ya estaba verificada.' };
    if (user.activationToken !== token) throw new BadRequestException('Token inválido');

    user.isVerified = true;
    user.activationToken = undefined; 
    await user.save();

    return { message: 'Cuenta activada correctamente.' };
  }
  
  async requestPasswordReset(requestDto: RequestPasswordResetDto) {
    const { email } = requestDto;
    const user = await this.userModel.findOne({ email: email.toLowerCase() });

    if (!user) return { message: 'Si el correo existe, se enviará el enlace.' };

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    await this.passwordResetTokenModel.deleteMany({ userId: user._id });
    await this.passwordResetTokenModel.create({ userId: user._id, tokenHash, expiresAt });

    const frontBase = this.configService.get<string>('FRONT_BASE_URL') || 'http://localhost:4200';
    const resetLink = `${frontBase}/auth/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    this.mailService.sendPasswordResetEmail(user.email, user.name, resetLink);
    return { message: 'Si el correo existe, se enviará el enlace.' };
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    const { email, token, password } = resetDto;
    const user = await this.userModel.findOne({ email: email.toLowerCase() });
    if (!user) throw new BadRequestException('Enlace inválido');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenDoc = await this.passwordResetTokenModel.findOne({
      userId: user._id,
      tokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) throw new BadRequestException('Enlace inválido o expirado');

    user.password = await bcrypt.hash(password, 10);
    user.loginAttempts = 0;
    user.isActive = true;
    await user.save();
    await this.passwordResetTokenModel.deleteMany({ userId: user._id });

    return { message: 'Contraseña actualizada correctamente.' };
  }
}