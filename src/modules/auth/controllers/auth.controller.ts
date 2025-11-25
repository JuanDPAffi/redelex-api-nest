import { Controller, Post, Body, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import {
  RegisterDto,
  LoginDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    // Obtenemos el resultado de tu servicio
    const loginResult = await this.authService.login(loginDto);
    
    // CORRECCIÓN AQUÍ: Usamos 'loginResult.token' en lugar de 'access_token'
    // Configuración de la Cookie Segura
    response.cookie('redelex_token', loginResult.token, {
      httpOnly: true, 
      secure: true,   
      sameSite: 'none', 
      domain: 'affi.net', // Compartido entre subdominios
      maxAge: 1000 * 60 * 5, // 30 Minutos
    });

    // Retornamos el usuario y mensaje (el token ya va oculto en la cookie)
    return {
      user: loginResult.user, 
      message: 'Login exitoso'
    };
  }
  
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) response: Response) {
    response.cookie('redelex_token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      domain: 'affi.net', // Importante poner el dominio para poder borrarla
      expires: new Date(0), 
    });
    return { message: 'Sesión cerrada' };
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activateAccount(@Body() body: { email: string; token: string }) {
    return this.authService.activateAccount(body.email, body.token);
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() requestDto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(requestDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetDto);
  }
}