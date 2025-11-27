import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ParseIntPipe,
  Req,
  Headers, // <--- Importamos Headers
  InternalServerErrorException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // <--- Importamos ConfigService
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RedelexService } from '../services/redelex.service';

// QUITAMOS EL GUARD GLOBAL DE AQUÍ
@Controller('redelex')
export class RedelexController {
  constructor(
    private readonly redelexService: RedelexService,
    private readonly configService: ConfigService // Inyectamos Config
  ) {}

  // ============================================================
  // ENDPOINTS PÚBLICOS / FRONTEND (Requieren JWT Usuario)
  // ============================================================

  @UseGuards(JwtAuthGuard) // <--- Lo movemos aquí
  @Get('mis-procesos')
  async getMisProcesos(@Req() req) {
    const userNit = req.user.nit;
    if (!userNit) throw new BadRequestException('Su usuario no tiene un NIT asociado.');
    return this.redelexService.getProcesosByIdentificacion(userNit);
  }

  @UseGuards(JwtAuthGuard) // <--- Lo movemos aquí
  @Get('procesos-por-identificacion/:identificacion')
  async getProcesosPorIdentificacion(@Param('identificacion') identificacion: string, @Req() req) {
    if (req.user.role !== 'admin') throw new ForbiddenException('No tiene permisos.');
    if (!identificacion) throw new BadRequestException('La identificación es obligatoria');
    return this.redelexService.getProcesosByIdentificacion(identificacion);
  }

  @UseGuards(JwtAuthGuard) // <--- Lo movemos aquí
  @Get('proceso/:id')
  async getProcesoDetalle(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const data = await this.redelexService.getProcesoDetalleById(id);
    if (!data) throw new NotFoundException('Proceso no encontrado');

    if (req.user.role !== 'admin') {
      const userNit = req.user.nit;
      if (!userNit) throw new ForbiddenException('Usuario sin NIT.');
      
      const cleanUserNit = String(userNit).replace(/[^0-9]/g, '');
      
      // Validación de sujetos (Fix anterior)
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

  @UseGuards(JwtAuthGuard) // <--- Lo movemos aquí
  @Get('informe-inmobiliaria/:informeId')
  async getInformeInmobiliar(@Param('informeId', ParseIntPipe) informeId: number, @Req() req) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Acceso denegado');
    const data = await this.redelexService.getInformeInmobiliaria(informeId);
    return { success: true, count: data.length, data };
  }

  // ============================================================
  // ENDPOINTS DE SISTEMA / BACKEND (Requieren System Token)
  // ============================================================

  /**
   * Endpoint protegido por SYSTEM_TASK_TOKEN
   * No requiere usuario logueado, solo la llave maestra en el Header.
   */
  @Post('sync-informe/:informeId')
  async syncInformeCedula(
    @Param('informeId', ParseIntPipe) informeId: number,
    @Headers('authorization') authHeader: string // Leemos el header manual
  ) {
    // 1. Obtener la llave maestra de las variables de entorno
    const systemToken = this.configService.get<string>('SYSTEM_TASK_TOKEN');

    // 2. Validar que la llave exista en el servidor
    if (!systemToken) {
      console.error('❌ SYSTEM_TASK_TOKEN no configurado en el servidor');
      throw new InternalServerErrorException('Error de configuración en el servidor');
    }

    // 3. Comparar el header con la llave (Simple Auth)
    if (authHeader !== systemToken) {
      throw new UnauthorizedException('Token de sistema inválido o ausente');
    }

    // 4. Ejecutar proceso
    const result = await this.redelexService.syncInformeCedulaProceso(informeId);
    return { success: true, message: 'Sincronización completada', ...result };
  }
}