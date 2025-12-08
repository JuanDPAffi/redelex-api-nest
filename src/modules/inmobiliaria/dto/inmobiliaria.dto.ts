import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

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
}