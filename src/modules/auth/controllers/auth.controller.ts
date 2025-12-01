import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  HttpCode, 
  HttpStatus, 
  Res, 
  Req, 
  UseGuards // <--- Importante
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import {
  RegisterDto,
  LoginDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/auth.dto';
// 1. IMPORTAMOS TU NUEVO GUARD HÍBRIDO
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ============================================================
  // ENDPOINTS PÚBLICOS (NO LLEVAN GUARD)
  // ============================================================

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const loginResult = await this.authService.login(loginDto);
    
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookie('redelex_token', loginResult.token, {
      httpOnly: true, 
      secure: isProduction,   
      sameSite: isProduction ? 'none' : 'lax', 
      domain: isProduction ? 'affi.net' : undefined, 
      maxAge: 1000 * 60 * 30, 
    });

    return {
      user: loginResult.user, 
      message: 'Login exitoso'
    };
  }
  
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) response: Response) {
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookie('redelex_token', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? 'affi.net' : undefined,
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

  // ============================================================
  // ENDPOINTS PROTEGIDOS (AQUÍ APLICAMOS EL GUARD)
  // ============================================================

  /**
   * Este endpoint ahora responderá si:
   * 1. Viene un usuario normal con Cookie/JWT.
   * 2. Viene el SYSTEM_TASK_TOKEN en el header Authorization.
   */
  @UseGuards(SystemOrJwtGuard)
  @Get('profile')
  getProfile(@Req() req) {
    // Si entras con System Token, recuerda que req.user será el usuario "falso" Admin
    return req.user; 
  }
}