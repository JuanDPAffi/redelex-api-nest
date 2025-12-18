import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCallTicketDto {
  @IsString()
  @IsNotEmpty()
  callType: string;

  @IsString()
  @IsOptional()
  transferArea?: string;

  @IsString()
  @IsNotEmpty()
  contactEmail: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @IsString()
  @IsNotEmpty()
  companyNit: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  // AGREGADO: Para recibir el ID del propietario de HubSpot
  @IsString()
  @IsOptional()
  gerenteComercial?: string;

  @IsString()
  @IsNotEmpty()
  query: string;

  // CORREGIDO: Transforma números a strings automáticamente
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value ? String(value) : value)
  procesoId?: string;

  // CORREGIDO: Renombrado de procesoRadicado a cuenta para coincidir con el Frontend
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value ? String(value) : value)
  cuenta?: string;
  
  @IsString()
  @IsOptional()
  inquilinoIdentificacion?: string;

  @IsString()
  @IsOptional()
  inquilinoNombre?: string;
}