import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import axios from 'axios';
import {
  RedelexToken,
  RedelexTokenDocument,
} from '../schemas/redelex-token.schema';
import {
  CedulaProceso,
  CedulaProcesoDocument,
} from '../schemas/cedula-proceso.schema';
import {
  ProcesoDetalleDto,
  ProcesoResumenDto,
  ProcesosPorIdentificacionResponse,
  InformeCedulaItem,
  MedidaCautelarDto,
  InformeInmobiliarRaw, // Importado
  InformeInmobiliarDto, // Importado
} from '../dto/redelex.dto';

@Injectable()
export class RedelexService {
  private readonly logger = new Logger(RedelexService.name);
  private readonly baseUrl = 'https://cloudapp.redelex.com/api';
  private readonly apiKey: string;

  constructor(
    @InjectModel(RedelexToken.name)
    private readonly redelexTokenModel: Model<RedelexTokenDocument>,
    @InjectModel(CedulaProceso.name)
    private readonly cedulaProcesoModel: Model<CedulaProcesoDocument>,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('REDELEX_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('REDELEX_API_KEY no está configurado');
    }
  }

  async getValidAuthToken(): Promise<string> {
    let tokenDoc = await this.redelexTokenModel
      .findOne()
      .sort({ createdAt: -1 });

    if (!tokenDoc) {
      return await this.generateAndStoreToken();
    }

    if (new Date() > tokenDoc.expiresAt) {
      return await this.generateAndStoreToken();
    }

    return tokenDoc.token;
  }

  private async generateAndStoreToken(): Promise<string> {
    if (!this.apiKey) {
      throw new Error('REDELEX_API_KEY no configurado');
    }

    const response = await axios.post(
      `${this.baseUrl}/apikeys/CreateApiKey`,
      { token: this.apiKey },
    );

    const authToken = response.data.authToken;
    const expiresIn = response.data.expiresInSeconds || 86400;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await this.redelexTokenModel.deleteMany();
    await this.redelexTokenModel.create({ token: authToken, expiresAt });

    this.logger.log('Nuevo token de Redelex generado y almacenado');

    return authToken;
  }

  async secureRedelexGet(url: string, params: any = {}) {
    let token = await this.getValidAuthToken();

    try {
      return (
        await axios.get(url, {
          params,
          headers: { Authorization: token },
        })
      ).data;
    } catch (err: any) {
      if (err.response?.status === 401) {
        this.logger.warn('Token expirado, regenerando...');
        token = await this.generateAndStoreToken();

        return (
          await axios.get(url, {
            params,
            headers: { Authorization: token },
          })
        ).data;
      }

      throw err;
    }
  }

  async getProcesoById(procesoId: number) {
    return this.secureRedelexGet(`${this.baseUrl}/Procesos/GetProceso`, {
      procesoId,
    });
  }

  async getProcesoDetalleById(
    procesoId: number,
  ): Promise<ProcesoDetalleDto | null> {
    const raw = await this.getProcesoById(procesoId);
    return this.mapRedelexProcesoToDto(raw);
  }

  // --- NUEVO MÉTODO PARA INMOBILIAR ---
  async getInformeInmobiliar(informeId: number): Promise<InformeInmobiliarDto[]> {
    if (!this.apiKey) {
      throw new Error('REDELEX_API_KEY no configurado');
    }

    // 1. Consumir API Externa
    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      {
        token: this.apiKey,
        informeId,
      },
    );

    // 2. Parsear el string JSON que viene dentro de la respuesta
    const rawString = data.jsonString as string;
    if (!rawString) return [];
    
    const items = JSON.parse(rawString) as InformeInmobiliarRaw[];

    // 3. Mapear a DTO limpio
    return items.map((item) => ({
      idProceso: item['ID Proceso'],
      claseProceso: item['Clase Proceso'],
      demandadoIdentificacion: item['Demandado - Identificacion'],
      demandadoNombre: item['Demandado - Nombre'],
      demandanteIdentificacion: item['Demandante - Identificacion'],
      demandanteNombre: item['Demandante - Nombre'],
      codigoAlterno: item['Codigo Alterno'],
      etapaProcesal: item['Etapa Procesal'],
      fechaRecepcionProceso: item['Fecha Recepcion Proceso'],
      sentenciaPrimeraInstancia: item['Sentencia - Primera Instancia'],
      despacho: item['Despacho'],
      numeroRadicacion: item['Numero Radicacion'] ? item['Numero Radicacion'].replace(/'/g, '') : '', // Quitamos comillas extra si vienen
      ciudadInmueble: item['CIUDAD DEL INMUEBLE'],
    }));
  }

  async syncInformeCedulaProceso(informeId: number) {
    if (!this.apiKey) {
      throw new Error('REDELEX_API_KEY no configurado');
    }

    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      {
        token: this.apiKey,
        informeId,
      },
    );

    const raw = data.jsonString as string;
    const items = JSON.parse(raw) as InformeCedulaItem[];

    const procesosFromJson = new Set<number>();

    const bulkOps = items.map((item) => {
      const procesoId = Math.round(item['ID Proceso']);
      procesosFromJson.add(procesoId);

      const demandadoNombre = String(item['Demandado - Nombre'] ?? '').trim();
      const demandadoIdentificacion = String(
        item['Demandado - Identificacion'] ?? '',
      ).trim();
      const demandanteNombre = String(
        item['Demandante - Nombre'] ?? '',
      ).trim();
      const demandanteIdentificacion = String(
        item['Demandante - Identificacion'] ?? '',
      ).trim();

      return {
        updateOne: {
          filter: { procesoId },
          update: {
            $set: {
              procesoId,
              demandadoNombre,
              demandadoIdentificacion,
              demandanteNombre,
              demandanteIdentificacion,
            },
          },
          upsert: true,
        },
      };
    });

    if (bulkOps.length === 0) {
      const deleteResult = await this.cedulaProcesoModel.deleteMany({});
      return {
        total: 0,
        upserted: 0,
        modified: 0,
        deleted: deleteResult.deletedCount ?? 0,
      };
    }

    const [bulkResult, deleteResult] = await Promise.all([
      this.cedulaProcesoModel.bulkWrite(bulkOps, { ordered: false }),
      this.cedulaProcesoModel.deleteMany({
        procesoId: { $nin: Array.from(procesosFromJson) },
      }),
    ]);

    const total = items.length;
    const upserted = bulkResult.upsertedCount ?? 0;
    const modified = bulkResult.modifiedCount ?? 0;
    const deleted = deleteResult.deletedCount ?? 0;

    this.logger.log(
      `Sincronización completada: ${total} total, ${upserted} insertados, ${modified} modificados, ${deleted} eliminados`,
    );

    return { total, upserted, modified, deleted };
  }

  async getProcesosByIdentificacion(
    identificacion: string,
  ): Promise<ProcesosPorIdentificacionResponse> {
    const value = identificacion.trim();
    const pattern = this.escapeRegex(value);

    const docs = await this.cedulaProcesoModel
      .find({
        $or: [
          {
            demandadoIdentificacion: {
              $regex: pattern,
              $options: 'i',
            },
          },
          {
            demandanteIdentificacion: {
              $regex: pattern,
              $options: 'i',
            },
          },
        ],
      })
      .sort({ procesoId: 1 });

    const procesos: ProcesoResumenDto[] = docs.map((d) => ({
      procesoId: d.procesoId,
      demandadoNombre: d.demandadoNombre || '',
      demandadoIdentificacion: d.demandadoIdentificacion || '',
      demandanteNombre: d.demandanteNombre || '',
      demandanteIdentificacion: d.demandanteIdentificacion || '',
    }));

    return {
      success: true,
      identificacion: value,
      procesos,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private mapMedidaCautelar(medida: any): MedidaCautelarDto {
    return {
      tipoBien: medida.TipoBien ?? null,
      sujeto: medida.Sujeto ?? null,
      tipoMedida: medida.TipoMedida ?? null,
      medidaEfectiva: medida.MedidaEfectiva ?? null,
      avaluoJudicial: medida.AvaluoJudicial ?? null,
      observaciones: medida.Observaciones ?? null,
    };
  }

  private mapRedelexProcesoToDto(raw: any): ProcesoDetalleDto | null {
    if (!raw || !raw.proceso) return null;
    const p = raw.proceso;

    const sujetos = Array.isArray(p.Sujetos) ? p.Sujetos : [];
    const abogados = Array.isArray(p.Abogados) ? p.Abogados : [];
    const medidas = Array.isArray(p.MedidasCautelares)
      ? p.MedidasCautelares
      : [];

    const medidasValidas: MedidaCautelarDto[] = medidas
      .filter((m: any) => {
        const efectiva = (m.MedidaEfectiva || '').trim().toUpperCase();
        return efectiva !== 'N';
      })
      .map((m: any) => this.mapMedidaCautelar(m));

    const actuaciones = Array.isArray(p.Actuaciones) ? p.Actuaciones : [];
    const ultimaActuacion =
      actuaciones
        .slice()
        .sort((a: any, b: any) => {
          const fa = new Date(a.FechaActuacion || 0).getTime();
          const fb = new Date(b.FechaActuacion || 0).getTime();
          return fb - fa;
        })[0] || null;

    const camposPersonalizados = Array.isArray(p.CamposPersonalizados)
      ? p.CamposPersonalizados
      : [];

    const campoUbicacionContrato = camposPersonalizados.find((c: any) =>
      String(c.Nombre || '')
        .toUpperCase()
        .includes('UBICACION CONTRATO'),
    );

    const calif = p.CalificacionContingenciaProceso || {};

    return {
      sujetos: sujetos,
      idProceso: p.ProcesoId ?? null,
      numeroRadicacion: p.Radicacion ?? null,
      codigoAlterno: p.CodigoAlterno ?? null,
      claseProceso: p.ClaseProceso ?? null,
      etapaProcesal: p.Etapa ?? null,
      estado: p.Estado ?? null,
      regional: p.Regional ?? null,
      tema: p.Tema ?? null,
      despacho: p.DespachoConocimiento ?? null,
      despachoOrigen: p.DespachoOrigen ?? null,
      fechaAdmisionDemanda: p.FechaAdmisionDemanda ?? null,
      fechaCreacion: p.FechaCreacion ?? null,
      fechaEntregaAbogado: p.FechaEntregaAbogado ?? null,
      fechaRecepcionProceso: p.FechaRecepcionProceso ?? null,
      ubicacionContrato: campoUbicacionContrato?.Valor?.trim() ?? null,
      camposPersonalizados: camposPersonalizados,
      fechaAceptacionSubrogacion: null,
      fechaPresentacionSubrogacion: null,
      motivoNoSubrogacion: null,
      calificacion: calif.Calificacion ?? null,
      sentenciaPrimeraInstanciaResultado: p.SentenciaPrimeraInstancia ?? null,
      sentenciaPrimeraInstanciaFecha: p.FechaSentenciaPrimeraInstancia ?? null,
      medidasCautelares: medidasValidas,
      ultimaActuacionFecha: ultimaActuacion?.FechaActuacion ?? null,
      ultimaActuacionTipo: ultimaActuacion?.Tipo ?? null,
      ultimaActuacionObservacion: ultimaActuacion?.Observacion ?? null,
      abogados: abogados,
    };
  }
}