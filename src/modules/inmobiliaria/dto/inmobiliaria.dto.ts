import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class CreateInmobiliariaDto {
  @IsString()
  @IsNotEmpty()
  nombreInmobiliaria: string;

  @IsString()
  @IsNotEmpty()
  nit: string;

  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsOptional()
  @IsDateString()
  fechaInicioFianza?: Date;

  @IsString()
  @IsOptional()
  departamento?: string;

  @IsString()
  @IsOptional()
  ciudad?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsOptional()
  emailContacto?: string;
}

export class UpdateInmobiliariaDto {
  @IsString()
  @IsOptional()
  nombreInmobiliaria?: string;

  @IsString()
  @IsOptional()
  nit?: string;

  @IsString()
  @IsOptional()
  codigo?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  fechaInicioFianza?: Date;

  @IsString()
  @IsOptional()
  departamento?: string;

  @IsString()
  @IsOptional()
  ciudad?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsOptional()
  emailContacto?: string;
}