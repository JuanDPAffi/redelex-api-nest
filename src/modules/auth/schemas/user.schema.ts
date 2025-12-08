import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

// Definimos los roles validos para evitar errores de tipeo
export enum ValidRoles {
  ADMIN = 'admin',
  AFFI = 'affi',
  INMOBILIARIA = 'inmobiliaria',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  })
  email: string;

  @Prop({ required: true, minlength: 8, select: false })
  password: string;

  @Prop({ 
    required: true, 
    default: ValidRoles.INMOBILIARIA, 
    enum: ValidRoles 
  })
  role: string;

  // NUEVO: Array de permisos granulares para personalización
  // Esto permite que un 'affi' tenga permisos extra que otros 'affi' no tienen
  @Prop({ type: [String], default: [] })
  permissions: string[];

  // Control de acceso
  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  loginAttempts: number;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ select: false })
  activationToken?: string;

  // Datos de empresa 
  @Prop({ required: false, trim: true})
  nombreInmobiliaria?: string;

  @Prop({ required: false, trim: true })
  nit?: string;

  @Prop({ required: false, trim: true })
  codigoInmobiliaria?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);