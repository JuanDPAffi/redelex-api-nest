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
  // Headers, <--- Ya no necesitamos leer headers manualmente
  // InternalServerErrorException <--- Ya no se usa aquí
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedelexService } from '../services/redelex.service';
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';

// 1. APLICAMOS EL GUARD HÍBRIDO A TODO EL CONTROLADOR
// Esto permite entrar con JWT de usuario O con el SYSTEM_TASK_TOKEN
@UseGuards(SystemOrJwtGuard)
@Controller('redelex')
export class RedelexController {
  constructor(
    private readonly redelexService: RedelexService,
    private readonly configService: ConfigService
  ) {}

  // ============================================================
  // ENDPOINTS PÚBLICOS / FRONTEND
  // ============================================================

  // Ya no necesitamos @UseGuards(JwtAuthGuard) aquí, lo hereda de la clase
@Get('mis-procesos')
  async getMisProcesos(@Req() req) {
    const user = req.user;
    const userNit = user.nit;
    
    // Obtenemos el nombre para mostrar en el título
    const nombreInmobiliaria = user.nombreInmobiliaria || user.name || 'Usuario Affi'; 

    if (!userNit) throw new BadRequestException('Su usuario no tiene un NIT asociado.');

    // --- CAMBIO AQUÍ ---
    // En lugar de consultar Mongo, llamamos al método LIVE con el informe 5632
    const respuestaServicio = await this.redelexService.getMisProcesosLive(userNit);

    return {
      success: true,
      identificacion: userNit,
      nombreInmobiliaria: nombreInmobiliaria,
      procesos: respuestaServicio.procesos || []
    };
  }

  @Get('procesos-por-identificacion/:identificacion')
  async getProcesosPorIdentificacion(@Param('identificacion') identificacion: string, @Req() req) {
    // El System Token entra como 'admin', así que PASA esta validación
    if (req.user.role !== 'admin') throw new ForbiddenException('No tiene permisos.');
    
    if (!identificacion) throw new BadRequestException('La identificación es obligatoria');
    return this.redelexService.getProcesosByIdentificacion(identificacion);
  }

  @Get('proceso/:id')
  async getProcesoDetalle(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const data = await this.redelexService.getProcesoDetalleById(id);
    if (!data) throw new NotFoundException('Proceso no encontrado');

    // El System Token entra como 'admin', así que SE SALTA esta validación de NIT
    if (req.user.role !== 'admin') {
      const userNit = req.user.nit;
      if (!userNit) throw new ForbiddenException('Usuario sin NIT.');
      
      const cleanUserNit = String(userNit).replace(/[^0-9]/g, '');
      
      if (!data.sujetos || !Array.isArray(data.sujetos)) {
         throw new ForbiddenException('Datos del proceso incompletos (sin sujetos).');
      }

      const esPropio = data.sujetos.some((sujeto: any) => {
        const rawId = sujeto.NumeroIdentificacion || sujeto.Identificacion || '';
        const cleanIdSujeto = String(rawId).replace(/[^0-9]/g, '');
        return cleanIdSujeto.includes(cleanUserNit) || cleanUserNit.includes(cleanIdSujeto);
      });

      if (!esPropio) throw new ForbiddenException('No tiene permisos sobre este proceso.');
    }
    return { success: true, data };
  }

  @Get('informe-inmobiliaria/:informeId')
  async getInformeInmobiliar(@Param('informeId', ParseIntPipe) informeId: number, @Req() req) {
    // El System Token entra como 'admin', así que PASA esta validación
    if (req.user.role !== 'admin') throw new ForbiddenException('Acceso denegado');
    const data = await this.redelexService.getInformeInmobiliaria(informeId);
    return { success: true, count: data.length, data };
  }

  // ============================================================
  // ENDPOINTS DE SISTEMA
  // ============================================================

  /**
   * REFACTORIZADO: Ya no valida el token manualmente.
   * El SystemOrJwtGuard ya validó el token antes de llegar aquí.
   * Si el token es válido, req.user.role será 'admin'.
   */
  @Post('sync-informe/:informeId')
  async syncInformeCedula(
    @Param('informeId', ParseIntPipe) informeId: number,
    @Req() req // Inyectamos request para verificar permisos
  ) {
    // Seguridad adicional: Solo permitimos a Admins (Usuarios Admin o Token de Sistema)
    // Esto evita que un usuario normal 'cliente' llame a este endpoint de sincronización.
    if (req.user.role !== 'admin') {
        throw new ForbiddenException('Requiere privilegios de administrador o sistema.');
    }

    // Ejecutar proceso directamente
    const result = await this.redelexService.syncInformeCedulaProceso(informeId);
    return { success: true, message: 'Sincronización completada', ...result };
  }
}