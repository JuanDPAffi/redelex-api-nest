import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InmobiliariaDocument = Inmobiliaria & Document;

@Schema({ timestamps: true })
export class Inmobiliaria {
  @Prop({ required: true, trim: true})
  nombreInmobiliaria: string;

  @Prop({ required: true, trim: true })
  nit: string;

  @Prop({ required: true, trim: true })
  codigo: string;

  @Prop({ default: null }) 
  emailRegistrado: string | null;

  @Prop({ default: true })
  isActive: boolean;
}

// Índice único compuesto: No pueden haber dos inmobiliarias con mismo NIT y Código
export const InmobiliariaSchema = SchemaFactory.createForClass(Inmobiliaria);
InmobiliariaSchema.index({ nit: 1, codigo: 1 }, { unique: true });