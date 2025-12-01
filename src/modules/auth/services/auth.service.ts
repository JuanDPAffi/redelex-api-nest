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
import { User, UserDocument } from '../schemas/user.schema';
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
import { Inmobiliaria, InmobiliariaDocument } from '../../auth/schemas/inmobiliaria.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    
    // 2. INYECTAR EL MODELO DE INMOBILIARIA
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

    // Normalizamos el email para las comparaciones
    const emailLower = email.toLowerCase();
    const isAffiEmail = emailLower.endsWith('@affi.net');

    // Identificamos si están intentando registrarse en la EMPRESA DUEÑA (AFFI)
    // Usamos los datos exactos que me diste
    const isAffiCorporate = (nit === '900053370' && codigoInmobiliaria === 'AFFI');

    // REGLA 1: PROTECCIÓN CORPORATIVA
    // Si intentan usar credenciales de AFFI, PERO el correo NO es @affi.net -> BLOQUEAR
    if (isAffiCorporate && !isAffiEmail) {
      throw new UnauthorizedException('Restringido: El código AFFI solo puede ser usado por correos corporativos @affi.net');
    }

    // REGLA 2: ASIGNACIÓN DE PROPIEDAD
    if (isAffiCorporate) {
      // CASO AFFI:
      // No guardamos "emailRegistrado" porque Affi permite múltiples usuarios internos.
      // Simplemente dejamos pasar (ya validamos arriba que sea @affi.net).
    } else {
      // CASO CLIENTE EXTERNO:
      // Validamos unicidad (un solo dueño por inmobiliaria)
      
      // Si ya tiene dueño...
      if (inmobiliaria.emailRegistrado) {
        // ...y es diferente al que intenta registrarse -> ERROR
        if (inmobiliaria.emailRegistrado !== emailLower) {
           throw new ConflictException('Esta inmobiliaria ya tiene un usuario administrador registrado.');
        }
      } else {
        // Si está libre, la asignamos a este usuario
        inmobiliaria.emailRegistrado = emailLower;
        await inmobiliaria.save();
      }
    }

    // ---------------------------------------------------------

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(32).toString('hex');

    const assignedRole = isAffiEmail ? 'admin' : 'user';

    // 5. Crear usuario
    const user = await this.userModel.create({
      name,
      email: emailLower,
      password: hashedPassword,
      role: assignedRole,
      nameInmo: inmobiliaria.nombreInmobiliaria,
      nit, 
      codigoInmobiliaria,
      activationToken: activationToken, 
      isVerified: false, 
      isActive: true, 
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

    // Buscamos al usuario (incluyendo password para comparar)
    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
    }).select('+password');

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 1. Validaciones previas
    if (!user.isVerified) {
      throw new UnauthorizedException('Debes activar tu cuenta. Revisa tu correo electrónico.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Su cuenta ha sido desactivada. Contacte al administrador.');
    }

    // 2. Verificar Contraseña
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // --- LÓGICA DE INTENTOS FALLIDOS ---
      
      // Incrementamos el contador (si no existe, empieza en 0)
      const currentAttempts = (user.loginAttempts || 0) + 1;
      const maxAttempts = 3;
      const remaining = maxAttempts - currentAttempts;

      // Actualizamos el contador en la BD
      user.loginAttempts = currentAttempts;
      
      if (currentAttempts >= maxAttempts) {
        // BLOQUEO DE CUENTA
        user.isActive = false; // Inactivamos al usuario
        await user.save();
        
        throw new UnauthorizedException(
          'Su cuenta ha sido desactivada por múltiples intentos fallidos. Para reactivarla, restablezca su contraseña.'
        );
      } else {
        // ADVERTENCIA
        await user.save();
        
        throw new UnauthorizedException(
          `Credenciales inválidas. Advertencia: Le quedan ${remaining} intento(s) antes de bloquear su cuenta.`
        );
      }
    }

    // --- SI LLEGA AQUÍ, EL LOGIN FUE EXITOSO ---

    // Reiniciamos el contador de intentos a 0
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
      },
      token,
    };
  }

  async activateAccount(email: string, token: string) {
    const user = await this.userModel.findOne({ 
      email: email.toLowerCase() 
    }).select('+activationToken');

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (user.isVerified) {
      return { message: 'La cuenta ya estaba verificada. Puedes iniciar sesión.' };
    }

    if (user.activationToken !== token) {
      throw new BadRequestException('Token de activación inválido o expirado');
    }

    user.isVerified = true;
    user.activationToken = undefined; 
    await user.save();

    return {
      message: 'Cuenta activada correctamente. Ya puedes iniciar sesión.',
    };
  }
  
  async requestPasswordReset(requestDto: RequestPasswordResetDto) {
    const { email } = requestDto;

    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
    });

    if (!user) {
      return {
        message:
          'Si el correo está registrado, te enviaremos un enlace para restablecer la contraseña.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    await this.passwordResetTokenModel.deleteMany({ userId: user._id });

    await this.passwordResetTokenModel.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const frontBase =
      this.configService.get<string>('FRONT_BASE_URL') ||
      'http://localhost:4200';
    const resetLink = `${frontBase}/auth/reset-password?token=${rawToken}&email=${encodeURIComponent(
      user.email,
    )}`;

    this.mailService.sendPasswordResetEmail(user.email, user.name, resetLink);

    return {
      message:
        'Si el correo está registrado, te enviaremos un enlace para restablecer la contraseña.',
    };
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    const { email, token, password } = resetDto;

    const user = await this.userModel.findOne({
      email: email.toLowerCase(),
    });

    if (!user) {
      throw new BadRequestException('Enlace inválido o expirado');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenDoc = await this.passwordResetTokenModel.findOne({
      userId: user._id,
      tokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      throw new BadRequestException('Enlace inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.loginAttempts = 0;
    user.isActive = true;
    await user.save();

    await this.passwordResetTokenModel.deleteMany({ userId: user._id });

    return {
      message:
        'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
    };
  }
}