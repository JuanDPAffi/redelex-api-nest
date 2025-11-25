import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException, // <--- IMPORTANTE
  ParseIntPipe,
  Req, // <--- IMPORTANTE: Para leer el usuario del token
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RedelexService } from '../services/redelex.service';

@Controller('redelex')
@UseGuards(JwtAuthGuard)
export class RedelexController {
  constructor(private readonly redelexService: RedelexService) {}

  /**
   * 1. NUEVO ENDPOINT: Mis Procesos (Para Inmobiliarias)
   * GET /api/redelex/mis-procesos
   * No recibe parámetros, usa el NIT del usuario logueado.
   */
  @Get('mis-procesos')
  async getMisProcesos(@Req() req) {
    // Obtenemos el NIT seguro desde el Token (inyectado por JwtStrategy)
    const userNit = req.user.nit;

    if (!userNit) {
      throw new BadRequestException('Su usuario no tiene un NIT asociado para consultar.');
    }

    // Reutilizamos la lógica de búsqueda, pero forzando el NIT del usuario
    return this.redelexService.getProcesosByIdentificacion(userNit);
  }

  /**
   * 2. MODIFICADO: Listar procesos por identificación (Solo Admins)
   * GET /api/redelex/procesos-por-identificacion/:identificacion
   */
  @Get('procesos-por-identificacion/:identificacion')
  async getProcesosPorIdentificacion(
    @Param('identificacion') identificacion: string,
    @Req() req,
  ) {
    // SEGURIDAD: Solo los administradores pueden buscar por cualquier cédula
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('No tiene permisos para realizar búsquedas abiertas.');
    }

    if (!identificacion || identificacion.trim() === '') {
      throw new BadRequestException('La identificación no puede estar vacía');
    }

    return this.redelexService.getProcesosByIdentificacion(identificacion);
  }

  /**
   * 3. MODIFICADO: Obtener detalle (Blindado para que no vean procesos ajenos por ID)
   * GET /api/redelex/proceso/:id
   */
  @Get('proceso/:id')
  async getProcesoDetalle(
    @Param('id', ParseIntPipe) id: number, 
    @Req() req
  ) {
    const data = await this.redelexService.getProcesoDetalleById(id);

    if (!data) {
      throw new NotFoundException('Proceso no encontrado en Redelex');
    }

    // SEGURIDAD: Si es usuario normal, verificar propiedad
    if (req.user.role !== 'admin') {
      const userNit = req.user.nit; // string
      
      // Buscamos si el NIT del usuario está entre los sujetos del proceso
      const esPropio = data.sujetos.some((sujeto: any) => {
        const identificacion = sujeto.Identificacion ? String(sujeto.Identificacion).trim() : '';
        return identificacion === userNit;
      });

      if (!esPropio) {
        throw new ForbiddenException('No tiene permisos para ver los detalles de este proceso.');
      }
    }

    return {
      success: true,
      data,
    };
  }

  @Get('informe-inmobiliaria/:informeId')
  async getInformeInmobiliar(
    @Param('informeId', ParseIntPipe) informeId: number,
    @Req() req
  ) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Acceso denegado');
    
    const data = await this.redelexService.getInformeInmobiliaria(informeId);
    return { success: true, count: data.length, data };
  }

  @Post('sync-informe/:informeId')
  async syncInformeCedula(
    @Param('informeId', ParseIntPipe) informeId: number,
    @Req() req
  ) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Acceso denegado');

    const result = await this.redelexService.syncInformeCedulaProceso(informeId);
    return { success: true, message: 'Sincronización completada', ...result };
  }
}