import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY } from '../decorators/roles.decorator';
import { ValidRoles } from '../../modules/auth/schemas/user.schema'; // Asegúrate que la ruta sea correcta

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Obtenemos roles y permisos requeridos por el decorador
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si la ruta no tiene decoradores de seguridad, dejamos pasar (o bloqueamos según tu política, aquí dejamos pasar)
    if (!requiredRoles && !requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
        throw new ForbiddenException('Usuario no identificado');
    }

    // 2. PODER ABSOLUTO: Si es admin, pasa siempre
    if (user.role === ValidRoles.ADMIN) {
        return true;
    }

    // 3. Validar Permisos Granulares (Si la ruta exige permisos específicos)
    if (requiredPermissions) {
        // Verificamos si el usuario tiene ALGUNO de los permisos requeridos en su array personal
        const hasPermission = requiredPermissions.some((perm) => user.permissions?.includes(perm));
        if (hasPermission) return true;
    }

    // 4. Validar Roles (Si la ruta exige roles específicos)
    if (requiredRoles) {
        const hasRole = requiredRoles.some((role) => user.role === role);
        if (hasRole) return true;
    }

    // Si llegó aquí, no cumplió ni rol ni permiso (y no es admin)
    throw new ForbiddenException('No tienes los permisos suficientes (Rol o Permiso) para esta acción');
  }
}