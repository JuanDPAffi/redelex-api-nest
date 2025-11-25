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

  // NUEVO: Control de acceso (Puntos 6 y 7)
  @Prop({ default: true })
  isActive: boolean;

  // AGREGA ESTE NUEVO CAMPO
  @Prop({ default: 0 })
  loginAttempts: number;

  // NUEVO: Verificación de correo (Punto 4)
  @Prop({ default: false })
  isVerified: boolean;

  // Agrega este campo a tu clase User
  @Prop({ select: false }) // Oculto por seguridad
  activationToken?: string;

  // NUEVOS: Datos de empresa (Punto 3)
  @Prop({ required: false, trim: true })
  nit?: string;

  @Prop({ required: false, trim: true })
  codigoInmobiliaria?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);