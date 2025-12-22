import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { RedelexService } from '../services/redelex.service';
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions.constant';
import { ValidRoles } from '../../auth/schemas/user.schema';

@UseGuards(SystemOrJwtGuard, RolesGuard)
@Controller('redelex')
export class RedelexController {
  constructor(private readonly redelexService: RedelexService) {}

  // 1. MIS PROCESOS: Para Inmobiliarias (Ven solo lo suyo)
  @Get('mis-procesos')
  @Permissions(PERMISSIONS.PROCESOS_VIEW_OWN)
  async getMisProcesos(@Req() req) {
    const user = req.user;
    const userNit = user.nit;
    const nombreInmobiliaria = user.nombreInmobiliaria || user.name || 'Usuario'; 

    if (!userNit) throw new BadRequestException('Su usuario no tiene un NIT asociado.');

    const respuestaServicio = await this.redelexService.getMisProcesosLive(userNit);

    return {
      success: true,
      identificacion: userNit,
      nombreInmobiliaria: nombreInmobiliaria,
      procesos: respuestaServicio.procesos || []
    };
  }

  // 2. BUSCAR POR CÉDULA: Para Affi/Admin (Ven cualquiera)
  @Get('procesos-por-identificacion/:identificacion')
  @Permissions(PERMISSIONS.PROCESOS_VIEW_ALL)
  async getProcesosPorIdentificacion(@Param('identificacion') identificacion: string) {
    if (!identificacion) throw new BadRequestException('La identificación es obligatoria');
    return this.redelexService.getProcesosByIdentificacion(identificacion);
  }

  // 3. DETALLE DE PROCESO: Híbrido (Affi ve todo, Inmo solo lo suyo)
  // Nota: No ponemos @Permissions aquí porque la lógica es condicional interna,
  // pero sí requerimos autenticación básica.
  @Get('proceso/:id')
  async getProcesoDetalle(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const user = req.user;
    
    // Verificamos permisos manualmente para aplicar lógica condicional
    const canViewAll = user.role === ValidRoles.ADMIN || (user.permissions && user.permissions.includes(PERMISSIONS.PROCESOS_VIEW_ALL));
    
    const canViewOwn = user.permissions && user.permissions.includes(PERMISSIONS.PROCESOS_VIEW_OWN);

    if (!canViewAll && !canViewOwn) {
        throw new ForbiddenException('No tiene permisos para ver detalles de procesos.');
    }

    // Obtenemos la data
    const data = await this.redelexService.getProcesoDetalleById(id);
    if (!data) throw new NotFoundException('Proceso no encontrado');

    // SI PUEDE VER TODO (Admin/Affi) -> Retornamos directo
    if (canViewAll) {
        return { success: true, data };
    }

    // SI SOLO PUEDE VER PROPIOS (Inmobiliaria) -> Validamos NIT
    const userNit = user.nit;
    if (!userNit) throw new ForbiddenException('Usuario sin NIT configurado.');
    
    const cleanUserNit = String(userNit).replace(/[^0-9]/g, '');
    
    if (!data.sujetos || !Array.isArray(data.sujetos)) {
       // Si no hay sujetos, por seguridad denegamos al usuario externo
       throw new ForbiddenException('Datos del proceso protegidos.');
    }

    const esPropio = data.sujetos.some((sujeto: any) => {
      const rawId = sujeto.NumeroIdentificacion || sujeto.Identificacion || '';
      const cleanIdSujeto = String(rawId).replace(/[^0-9]/g, '');
      return cleanIdSujeto.includes(cleanUserNit) || cleanUserNit.includes(cleanIdSujeto);
    });

    if (!esPropio) throw new ForbiddenException('Este proceso no pertenece a su organización.');

    return { success: true, data };
  }

  // 4. INFORMES ESPECIALES: Solo Affi/Admin
  @Get('informe-inmobiliaria/:informeId')
  @Permissions(PERMISSIONS.REPORTS_VIEW)
  async getInformeInmobiliar(@Param('informeId', ParseIntPipe) informeId: number) {
    const data = await this.redelexService.getInformeInmobiliaria(informeId);
    return { success: true, count: data.length, data };
  }

  // 5. SINCRONIZACIÓN: Tarea de Sistema / Admin
  @Post('sync-informe/:informeId')
  // Usamos un permiso especial o restringimos a Admin. 
  // SYSTEM_CONFIG es buena opción si lo definiste, o solo Admin.
  @Permissions(PERMISSIONS.SYSTEM_CONFIG) 
  async syncInformeCedula(@Param('informeId', ParseIntPipe) informeId: number) {
    const result = await this.redelexService.syncInformeCedulaProceso(informeId);
    return { success: true, message: 'Sincronización completada', ...result };
  }
}