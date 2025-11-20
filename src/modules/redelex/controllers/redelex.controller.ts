import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RedelexService } from '../services/redelex.service';

@Controller('redelex')
@UseGuards(JwtAuthGuard) // Protege todas las rutas de este controlador
export class RedelexController {
  constructor(private readonly redelexService: RedelexService) {}

  /**
   * Obtener detalle de un proceso por ID
   * GET /api/redelex/proceso/:id
   */
  @Get('proceso/:id')
  async getProcesoDetalle(@Param('id', ParseIntPipe) id: number) {
    const data = await this.redelexService.getProcesoDetalleById(id);

    if (!data) {
      throw new NotFoundException('Proceso no encontrado en Redelex');
    }

    return {
      success: true,
      data,
    };
  }

  /**
   * Nuevo Endpoint para obtener informe Inmobiliar
   * GET /api/redelex/informe-inmobiliaria/:informeId
   */
  @Get('informe-inmobiliaria/:informeId')
  async getInformeInmobiliar(
    @Param('informeId', ParseIntPipe) informeId: number,
  ) {
    const data = await this.redelexService.getInformeInmobiliar(informeId);

    return {
      success: true,
      count: data.length,
      data,
    };
  }

  /**
   * Sincronizar cédula de procesos desde un informe
   * POST /api/redelex/sync-informe/:informeId
   */
  @Post('sync-informe/:informeId')
  async syncInformeCedula(
    @Param('informeId', ParseIntPipe) informeId: number,
  ) {
    const result = await this.redelexService.syncInformeCedulaProceso(
      informeId,
    );

    return {
      success: true,
      message: 'Sincronización completada',
      ...result,
    };
  }

  /**
   * Listar procesos por identificación
   * GET /api/redelex/procesos-por-identificacion/:identificacion
   */
  @Get('procesos-por-identificacion/:identificacion')
  async getProcesosPorIdentificacion(
    @Param('identificacion') identificacion: string,
  ) {
    if (!identificacion || identificacion.trim() === '') {
      throw new BadRequestException(
        'La identificación no puede estar vacía',
      );
    }

    return this.redelexService.getProcesosByIdentificacion(identificacion);
  }
}