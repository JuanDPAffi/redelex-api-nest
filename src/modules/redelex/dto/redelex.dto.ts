// ... (Mantén tus interfaces anteriores ProcesoResumenDto, etc.)

// Tipos de respuesta de Redelex existentes...
export interface ProcesoResumenDto {
  procesoId: number;
  demandadoNombre: string;
  demandadoIdentificacion: string;
  demandanteNombre: string;
  demandanteIdentificacion: string;
}

export interface ProcesosPorIdentificacionResponse {
  success: boolean;
  identificacion: string;
  procesos: ProcesoResumenDto[];
}

export interface MedidaCautelarDto {
  tipoBien: string | null;
  sujeto: string | null;
  tipoMedida: string | null;
  medidaEfectiva: string | null;
  avaluoJudicial: string | null;
  observaciones: string | null;
}

export interface ProcesoDetalleDto {
  sujetos: any[];
  idProceso: number;
  numeroRadicacion: string | null;
  codigoAlterno: string | null;
  claseProceso: string | null;
  etapaProcesal: string | null;
  estado: string | null;
  regional: string | null;
  tema: string | null;
  despacho: string | null;
  despachoOrigen: string | null;
  fechaAdmisionDemanda: string | null;
  fechaCreacion: string | null;
  fechaEntregaAbogado: string | null;
  fechaRecepcionProceso: string | null;
  ubicacionContrato: string | null;
  camposPersonalizados: any[];
  fechaAceptacionSubrogacion: string | null;
  fechaPresentacionSubrogacion: string | null;
  motivoNoSubrogacion: string | null;
  calificacion: string | null;
  sentenciaPrimeraInstanciaResultado: string | null;
  sentenciaPrimeraInstanciaFecha: string | null;
  medidasCautelares: MedidaCautelarDto[];
  ultimaActuacionFecha: string | null;
  ultimaActuacionTipo: string | null;
  ultimaActuacionObservacion: string | null;
  abogados: any[];
}

export type InformeCedulaItem = {
  'ID Proceso': number;
  'Demandado - Nombre': string;
  'Demandado - Identificacion': string;
  'Demandante - Nombre': string;
  'Demandante - Identificacion': string;
};

// --- NUEVAS INTERFACES PARA INMOBILIAR ---

// 1. Estructura RAW (Como viene de Redelex con espacios y mayúsculas)
export interface InformeInmobiliarRaw {
  'ID Proceso': number;
  'Demandado - Identificacion': string;
  'Demandado - Nombre': string;
  'Demandante - Identificacion': string;
  'Demandante - Nombre': string;
  'Codigo Alterno': string;
  'Etapa Procesal': string;
  'Fecha Recepcion Proceso': string;
  'Sentencia - Primera Instancia': string;
  'Despacho': string;
  'Numero Radicacion': string;
  'CIUDAD DEL INMUEBLE': string | null;
}

// 2. Estructura DTO (Limpia para tu Frontend)
export interface InformeInmobiliarDto {
  idProceso: number;
  claseProceso: string,
  demandadoIdentificacion: string;
  demandadoNombre: string;
  demandanteIdentificacion: string;
  demandanteNombre: string;
  codigoAlterno: string;
  etapaProcesal: string;
  fechaRecepcionProceso: string;
  sentenciaPrimeraInstancia: string;
  despacho: string;
  numeroRadicacion: string;
  ciudadInmueble: string | null;
}