import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

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
    default: 'user', 
    enum: ['user', 'admin'] 
  })
  role: string;

  // Control de acceso
  @Prop({ default: true })
  isActive: boolean;

  // AGREGA ESTE NUEVO CAMPO
  @Prop({ default: 0 })
  loginAttempts: number;

  // Verificación de correo
  @Prop({ default: false })
  isVerified: boolean;

  // Agrega este campo a tu clase User
  @Prop({ select: false }) // Oculto por seguridad
  activationToken?: string;

  // NUEVOS: Datos de empresa 
  @Prop({ required: false, trim: true})
  nombreInmobiliaria?: string;

  @Prop({ required: false, trim: true })
  nit?: string;

  @Prop({ required: false, trim: true })
  codigoInmobiliaria?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);