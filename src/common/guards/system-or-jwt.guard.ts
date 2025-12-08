import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class SystemOrJwtGuard extends AuthGuard('jwt') {
  constructor(private configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // 1. Intentamos leer el header Authorization
    const authHeader = request.headers['authorization'];
    const systemToken = this.configService.get<string>('SYSTEM_TASK_TOKEN');

    // 2. LOGICA DE BYPASS: Si es la llave maestra, inyectamos un ADMIN FALSO
    if (authHeader && systemToken && authHeader === systemToken) {
      // Al poner role: 'admin', tu RolesGuard dejará pasar.
      request.user = { 
        id: 'system', 
        name: 'System Task',
        nombreInmobiliaria: 'System-Inmobiliaria',
        role: 'admin', // O usa ValidRoles.ADMIN
        nit: '800000000-System',
        permissions: [] // <--- AGREGADO: Para mantener consistencia con la interfaz de User
      };
      return true; 
    }

    // 3. Si no es la llave maestra, usamos la lógica normal (JWT/Cookies)
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (e) {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
  }
}