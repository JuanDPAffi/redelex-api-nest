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
  InformeInmobiliariaRaw,
  InformeInmobiliariaDto,
} from '../dto/redelex.dto';

@Injectable()
export class RedelexService {
  private readonly logger = new Logger(RedelexService.name);
  private readonly baseUrl = 'https://cloudapp.redelex.com/api';
  private readonly apiKey: string;
  private readonly INFORME_MIS_PROCESOS_ID = 5632;

  // NUEVO: ID de licencia para pasar el WAF
  private readonly licenseId = '2117C477-209F-44F5-9587-783D9F25BA8B';

  // OPTIMIZACIÓN 1: Variable para manejar la promesa de refresco y evitar race conditions
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(
    @InjectModel(RedelexToken.name)
    private readonly redelexTokenModel: Model<RedelexTokenDocument>,
    @InjectModel(CedulaProceso.name)
    private readonly cedulaProcesoModel: Model<CedulaProcesoDocument>,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('REDELEX_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('REDELEX_API_KEY no está configurado');
    }
  }

  async getMisProcesosLive(userNit: string) {
    if (!this.apiKey) throw new Error('REDELEX_API_KEY no configurado');

    // 1. Descargamos el JSON completo del informe 5632
    // No guardamos en BD, solo lo traemos a memoria RAM
    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      { token: this.apiKey, informeId: this.INFORME_MIS_PROCESOS_ID },
    );

    const rawString = data.jsonString as string;
    if (!rawString) return { success: true, identificacion: userNit, procesos: [] };

    const items = JSON.parse(rawString) as any[];

    // 2. FILTRADO EN MEMORIA
    // Buscamos solo los registros donde el Demandante (Inmobiliaria) coincida con el NIT del usuario
    const nitBusqueda = userNit.trim();
    
    const misProcesos = items.filter((item) => {
      // El informe trae ej: "805000082-4", tu usuario tiene "805000082"
      // Usamos includes para que coincida aunque tenga dígito de verificación
      const nitInforme = String(item['Demandante - Identificacion'] || '');
      return nitInforme.includes(nitBusqueda);
    });

    // 3. MAPEO PARA EL FRONTEND
    // Convertimos las llaves del JSON de Redelex a lo que espera tu tabla Angular
    const procesosMapeados = misProcesos.map((item) => ({
      procesoId: item['ID Proceso'],
      claseProceso: String(item['Clase Proceso'] ?? '').trim(),
      
      // Limpiamos la comilla simple del radicado ('68001...)
      numeroRadicacion: String(item['Numero Radicacion'] ?? '').replace(/'/g, '').trim(),
      
      demandadoNombre: String(item['Demandado - Nombre'] ?? '').trim(),
      demandadoIdentificacion: String(item['Demandado - Identificacion'] ?? '').trim(),
      
      demandanteNombre: String(item['Demandante - Nombre'] ?? '').trim(),
      demandanteIdentificacion: String(item['Demandante - Identificacion'] ?? '').trim(),
      fechaRecepcionProceso: String(item['Fecha Recepcion Proceso'] ?? '').trim(),
      sentencia: String(item['Sentencia'] ?? '').trim(),
      despacho: String(item['Despacho'] ?? '').trim(),
      etapaProcesal: String(item['Etapa Procesal'] ?? '').trim(),
      sentenciaPrimeraInstancia: String(item['Sentencia'] ?? '').trim(),
      ciudadInmueble: String(item['Ciudad'] ?? '').trim(),
    }));

    return {
      success: true,
      identificacion: userNit,
      procesos: procesosMapeados
    };
  }

  async getValidAuthToken(): Promise<string> {
    // Si ya hay una renovación en curso, devolvemos esa promesa para que todos esperen
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    let tokenDoc = await this.redelexTokenModel
      .findOne()
      .sort({ createdAt: -1 });

    // Margen de seguridad de 60 segundos para considerar el token expirado antes de tiempo
    if (!tokenDoc || new Date(Date.now() + 60000) > tokenDoc.expiresAt) {
      return await this.handleTokenRefresh();
    }

    return tokenDoc.token;
  }

  // Wrapper para gestionar la promesa de refresco
  private async handleTokenRefresh(): Promise<string> {
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;

    this.tokenRefreshPromise = this.generateAndStoreToken().finally(() => {
      this.tokenRefreshPromise = null; // Limpiamos la promesa al terminar (éxito o error)
    });

    return this.tokenRefreshPromise;
  }

  private async generateAndStoreToken(): Promise<string> {
    if (!this.apiKey) {
      throw new Error('REDELEX_API_KEY no configurado');
    }

    this.logger.log('Generando nuevo token de Redelex...');

    // MODIFICADO: Se agrega header api-license-id
    const response = await axios.post(
      `${this.baseUrl}/apikeys/CreateApiKey`,
      { token: this.apiKey },
      {
        headers: {
          'api-license-id': this.licenseId,
        },
      },
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

    // MODIFICADO: Objeto de headers unificado con la licencia
    const headers = {
      Authorization: token,
      'api-license-id': this.licenseId,
    };

    try {
      return (
        await axios.get(url, {
          params,
          headers: headers,
        })
      ).data;
    } catch (err: any) {
      if (err.response?.status === 401) {
        this.logger.warn('Token expirado (401), forzando regeneración...');
        // Forzamos regeneración
        token = await this.handleTokenRefresh();

        // Actualizamos el token en los headers para el reintento
        headers.Authorization = token;

        return (
          await axios.get(url, {
            params,
            headers: headers,
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

  async getInformeInmobiliaria(
    informeId: number,
  ): Promise<InformeInmobiliariaDto[]> {
    if (!this.apiKey) throw new Error('REDELEX_API_KEY no configurado');

    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      { token: this.apiKey, informeId },
    );

    const rawString = data.jsonString as string;
    if (!rawString) return [];

    const items = JSON.parse(rawString) as InformeInmobiliariaRaw[];

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
      numeroRadicacion: item['Numero Radicacion']
        ? String(item['Numero Radicacion']).replace(/'/g, '')
        : '',
      ciudadInmueble: item['Ciudad'],
    }));
  }

  // OPTIMIZACIÓN 2: Procesamiento por Lotes (Batching)
  async syncInformeCedulaProceso(informeId: number) {
    if (!this.apiKey) throw new Error('REDELEX_API_KEY no configurado');

    this.logger.log(`Iniciando descarga de informe ID: ${informeId}`);
    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      { token: this.apiKey, informeId },
    );

    const raw = data.jsonString as string;
    if (!raw) return { total: 0, upserted: 0, modified: 0, deleted: 0 };

    const items = JSON.parse(raw) as InformeCedulaItem[];
    const total = items.length;
    this.logger.log(`Informe descargado. Total registros a procesar: ${total}`);

    const procesosFromJson = new Set<number>();
    let upserted = 0;
    let modified = 0;

    // Tamaño del lote para no saturar la memoria ni la conexión a Mongo
    const BATCH_SIZE = 1000;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const bulkOps = chunk.map((item) => {
        const procesoId = Math.round(item['ID Proceso']);
        procesosFromJson.add(procesoId);

        return {
          updateOne: {
            filter: { procesoId },
            update: {
              $set: {
                procesoId,
                claseProceso: String(item['Clase Proceso'] ?? '').trim(),
                demandadoNombre: String(
                  item['Demandado - Nombre'] ?? '',
                ).trim(),
                demandadoIdentificacion: String(
                  item['Demandado - Identificacion'] ?? '',
                ).trim(),
                demandanteNombre: String(
                  item['Demandante - Nombre'] ?? '',
                ).trim(),
                demandanteIdentificacion: String(
                  item['Demandante - Identificacion'] ?? '',
                ).trim(),
              },
            },
            upsert: true,
          },
        };
      });

      if (bulkOps.length > 0) {
        const res = await this.cedulaProcesoModel.bulkWrite(bulkOps, {
          ordered: false,
        });
        upserted += res.upsertedCount;
        modified += res.modifiedCount;
      }
    }

    // OPTIMIZACIÓN DE BORRADO:
    // Si el set es muy grande, $nin puede fallar.
    // Nota: Si el informe trae SIEMPRE todos los procesos vigentes, esta lógica es correcta.
    const idsProcesados = Array.from(procesosFromJson);
    let deleted = 0;

    // Si son muchísimos IDs, es mejor hacerlo en batch o con cuidado.
    // Para < 50k registros, $nin suele aguantar, pero cuidado con > 100k.
    const deleteResult = await this.cedulaProcesoModel.deleteMany({
      procesoId: { $nin: idsProcesados },
    });
    deleted = deleteResult.deletedCount ?? 0;

    this.logger.log(
      `Sync completada: ${total} procesados, ${upserted} insertados, ${modified} act., ${deleted} eliminados`,
    );

    return { total, upserted, modified, deleted };
  }

  async getProcesosByIdentificacion(
    identificacion: string,
  ): Promise<ProcesosPorIdentificacionResponse> {
    const value = identificacion.trim();
    // Escapamos caracteres especiales para evitar inyecciones de Regex
    const pattern = this.escapeRegex(value);

    // Búsqueda insensible a mayúsculas/minúsculas
    const docs = await this.cedulaProcesoModel
      .find({
        $or: [
          { demandadoIdentificacion: { $regex: pattern, $options: 'i' } },
          { demandanteIdentificacion: { $regex: pattern, $options: 'i' } },
        ],
      })
      .sort({ procesoId: 1 });

    const procesos: ProcesoResumenDto[] = docs.map((d) => ({
      procesoId: d.procesoId,
      demandadoNombre: d.demandadoNombre || '',
      demandadoIdentificacion: d.demandadoIdentificacion || '',
      demandanteNombre: d.demandanteNombre || '',
      demandanteIdentificacion: d.demandanteIdentificacion || '',
      claseProceso: d.claseProceso || '',
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
      .filter((m: any) => (m.MedidaEfectiva || '').trim().toUpperCase() !== 'N')
      .map((m: any) => this.mapMedidaCautelar(m));

    // Ordenar actuaciones por fecha descendente
    const actuaciones = Array.isArray(p.Actuaciones) ? p.Actuaciones : [];
    // Usamos slice() para no mutar el array original si se reutiliza
    const ultimaActuacion =
      actuaciones.length > 0
        ? actuaciones.slice().sort((a: any, b: any) => {
            const fa = new Date(a.FechaActuacion || 0).getTime();
            const fb = new Date(b.FechaActuacion || 0).getTime();
            return fb - fa;
          })[0]
        : null;

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