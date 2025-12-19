// cedula-proceso.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CedulaProcesoDocument = CedulaProceso & Document;

@Schema({ timestamps: true })
export class CedulaProceso {
  @Prop({ required: true, index: true })
  procesoId: number;

  // --- Nuevos campos solicitados ---
  @Prop()
  numeroRadicacion: string;

  @Prop()
  codigoAlterno: string;

  @Prop()
  etapaProcesal: string;
  // --------------------------------

  @Prop({ required: true })
  claseProceso: string;

  @Prop({ required: true })
  demandadoNombre: string;

  @Prop({ required: true })
  demandadoIdentificacion: string;

  @Prop({ required: true })
  demandanteNombre: string;

  @Prop({ required: true })
  demandanteIdentificacion: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CedulaProcesoSchema = SchemaFactory.createForClass(CedulaProceso);
CedulaProcesoSchema.index({ procesoId: 1 }, { unique: true });