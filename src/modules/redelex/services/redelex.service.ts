import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import axios from 'axios';
import { RedelexToken, RedelexTokenDocument } from '../schemas/redelex-token.schema';
import { CedulaProceso, CedulaProcesoDocument } from '../schemas/cedula-proceso.schema';
import { ProcesoDetalleDto, ProcesoResumenDto, ProcesosPorIdentificacionResponse, InformeCedulaItem, MedidaCautelarDto, InformeInmobiliariaRaw, InformeInmobiliariaDto } from '../dto/redelex.dto';

@Injectable()
export class RedelexService {
  private readonly logger = new Logger(RedelexService.name);
  private readonly baseUrl = 'https://cloudapp.redelex.com/api';
  private readonly apiKey: string;
  private readonly INFORME_MIS_PROCESOS_ID = 5632;
  private readonly licenseId = '2117C477-209F-44F5-9587-783D9F25BA8B';
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

  async getMisProcesosLive(userNit: string, nombreInmobiliaria: string = '') {
    if (!this.apiKey) throw new Error('REDELEX_API_KEY no configurado');

    const data = await this.secureRedelexGet(
      `${this.baseUrl}/Informes/GetInformeJson`,
      { token: this.apiKey, informeId: this.INFORME_MIS_PROCESOS_ID },
    );

    const rawString = data.jsonString as string;
    if (!rawString) return { success: true, identificacion: userNit, procesos: [] };

    const items = JSON.parse(rawString) as any[];
    const procesosMap = new Map<number, any>();

    items.forEach((item) => {
      const id = Number(item['ID Proceso']);
      if (!id) return;
      
      if (!procesosMap.has(id)) {
        procesosMap.set(id, {
          procesoId: id,
          claseProceso: String(item['Clase Proceso'] ?? '').trim(),
          numeroRadicacion: String(item['Numero Radicacion'] ?? '').replace(/'/g, '').trim(),
          despacho: String(item['Despacho'] ?? '').trim(),
          etapaProcesal: String(item['Etapa Procesal'] ?? '').trim(),
          fechaRecepcionProceso: String(item['Fecha Recepcion Proceso'] ?? '').trim(),
          sentencia: String(item['Sentencia'] ?? '').trim(),
          ciudadInmueble: String(item['Ciudad'] ?? '').trim(),
          demandadoNombre: '',
          demandadoIdentificacion: '',
          demandanteNombre: '',
          demandanteIdentificacion: ''
        });
      }

      const proceso = procesosMap.get(id);
      const rol = String(item['Sujeto Intervencion'] || '').toUpperCase().trim();

      const idSujeto = String(item['Sujeto Identificacion'] || item['Identificacion'] || item['Nit'] || '').trim();
      const nombreSujeto = String(item['Sujeto Nombre'] || '').trim();

      if (rol === 'DEMANDANTE') {
        proceso.demandanteNombre = nombreSujeto;
        proceso.demandanteIdentificacion = idSujeto;
      } 
      else if (rol === 'DEMANDADO') {
        proceso.demandadoNombre = nombreSujeto;
        proceso.demandadoIdentificacion = idSujeto;
      }
    });

    const nitBusqueda = userNit.trim();
    const nombreBusqueda = nombreInmobiliaria.toUpperCase().replace(/\./g, '').replace(' SAS', '').replace(' S.A.S', '').trim();
    
    const procesosFiltrados = Array.from(procesosMap.values()).filter(p => {
        const clase = String(p.claseProceso || '').toUpperCase();
        const esClaseValida = clase.includes('EJECUTIVO SINGULAR') || clase.includes('VERBAL SUMARIO');
        
        if (!esClaseValida) {
            return false;
        }

        const idDemandante = String(p.demandanteIdentificacion || '');
        const nombreDemandante = String(p.demandanteNombre || '').toUpperCase();

        if (idDemandante && idDemandante.includes(nitBusqueda)) {
            return true;
        }

        if (!idDemandante && nombreBusqueda.length > 3 && nombreDemandante.includes(nombreBusqueda)) {
            return true;
        }

        return false;
    });

    const procesosMapeados = procesosFiltrados.map(p => ({
        ...p,
        sentenciaPrimeraInstancia: p.sentencia 
    }));

    return {
      success: true,
      identificacion: userNit,
      procesos: procesosMapeados
    };
  }

  async getValidAuthToken(): Promise<string> {
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    let tokenDoc = await this.redelexTokenModel
      .findOne()
      .sort({ createdAt: -1 });

    if (!tokenDoc || new Date(Date.now() + 60000) > tokenDoc.expiresAt) {
      return await this.handleTokenRefresh();
    }

    return tokenDoc.token;
  }

  private async handleTokenRefresh(): Promise<string> {
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;

    this.tokenRefreshPromise = this.generateAndStoreToken().finally(() => {
      this.tokenRefreshPromise = null;
    });

    return this.tokenRefreshPromise;
  }

  private async generateAndStoreToken(): Promise<string> {
    if (!this.apiKey) {
      throw new Error('REDELEX_API_KEY no configurado');
    }

    this.logger.log('Generando nuevo token de Redelex...');

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

    const headers = {
      Authorization: `Bearer ${token}`,
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
        token = await this.handleTokenRefresh();
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
    this.logger.log(`Informe descargado. Registros crudos: ${items.length}`);

    const procesosMap = new Map<number, any>();

    for (const item of items) {
      const pId = Math.round(item['ID Proceso']);
      const rol = String(item['Sujeto Intervencion'] ?? '').toUpperCase().trim();

      if (!procesosMap.has(pId)) {
        procesosMap.set(pId, {
          procesoId: pId,
          numeroRadicacion: String(item['Numero Radicacion'] ?? '').replace(/'/g, '').trim(),
          codigoAlterno: String(item['Codigo Alterno'] ?? '').trim(),
          claseProceso: String(item['Clase Proceso'] ?? '').trim(),
          etapaProcesal: String(item['Etapa Procesal'] ?? '').trim(),
          demandadoNombre: '',
          demandadoIdentificacion: '',
          demandanteNombre: '',
          demandanteIdentificacion: ''
        });
      }

      const proceso = procesosMap.get(pId);

      if (rol === 'DEMANDANTE') {
        proceso.demandanteNombre = String(item['Sujeto Nombre'] ?? '').trim();
        proceso.demandanteIdentificacion = String(item['Sujeto Identificacion'] ?? '').trim();
      } 
      else if (rol === 'DEMANDADO') {
        proceso.demandadoNombre = String(item['Sujeto Nombre'] ?? '').trim();
        proceso.demandadoIdentificacion = String(item['Sujeto Identificacion'] ?? '').trim();
      }
    }

    const procesosUnicos = Array.from(procesosMap.values());
    const total = procesosUnicos.length;
    this.logger.log(`Procesos únicos consolidados: ${total}`);

    let upserted = 0;
    let modified = 0;
    const BATCH_SIZE = 1000;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = procesosUnicos.slice(i, i + BATCH_SIZE);
      
      const bulkOps = chunk.map((p) => ({
        updateOne: {
          filter: { procesoId: p.procesoId },
          update: { $set: p },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        const res = await this.cedulaProcesoModel.bulkWrite(bulkOps, {
          ordered: false,
        });
        upserted += res.upsertedCount;
        modified += res.modifiedCount;
      }
    }

    const idsProcesados = Array.from(procesosMap.keys());
    const deleteResult = await this.cedulaProcesoModel.deleteMany({
      procesoId: { $nin: idsProcesados },
    });
    const deleted = deleteResult.deletedCount ?? 0;

    this.logger.log(
      `Sync completada: ${total} únicos, ${upserted} insertados, ${modified} act., ${deleted} eliminados`,
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
      etapaProcesal: d.etapaProcesal || '', 
      numeroRadicacion: d.numeroRadicacion || '',
      codigoAlterno: d.codigoAlterno || ''
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
      descripcion: medida.Descripcion ?? null,
      medidaEfectiva: medida.MedidaEfectiva ?? null,
      avaluoJudicial: medida.AvaluoJudicial ?? null,
      observaciones: medida.Observaciones ?? null,
      identificacionSujeto: medida.Identificacion ?? null,
      area: medida.Area ?? null,
      fecha: medida.Fecha ?? null,
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

    const actuaciones = Array.isArray(p.Actuaciones) ? p.Actuaciones : [];
    const ultimaActuacionPrincipal =
      actuaciones.length > 0
        ? actuaciones
            .filter((act: any) => (act.Cuaderno || '').trim() === 'Principal')
            .sort((a: any, b: any) => {
              const fa = new Date(a.FechaActuacion || 0).getTime();
              const fb = new Date(b.FechaActuacion || 0).getTime();
              return fb - fa;
            })[0]
        : null;
    
    const actuacionesRecientesList = actuaciones
      .filter((act: any) => {
        const nombreCuaderno = String(act.Cuaderno || '').toUpperCase().trim();
        return nombreCuaderno.includes('PRINCIPAL');
      })
      .sort((a: any, b: any) => {
        return new Date(b.FechaActuacion || 0).getTime() - new Date(a.FechaActuacion || 0).getTime();
      })
      .map((act: any) => ({
        id: act.ActuacionId ? String(act.ActuacionId) : `act-${Math.random().toString(36).substr(2, 9)}`, 
        fecha: act.FechaActuacion,
        observacion: act.Observacion,
        etapa: act.Etapa,
        tipo: act.Tipo,
        cuaderno: act.Cuaderno
      }));

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
      ultimaActuacionFecha: ultimaActuacionPrincipal?.FechaActuacion ?? null,
      ultimaActuacionTipo: ultimaActuacionPrincipal?.Tipo ?? null,
      ultimaActuacionObservacion: ultimaActuacionPrincipal?.Observacion ?? null,
      actuacionesRecientes: actuacionesRecientesList,
      abogados: abogados,
    };
  }
}