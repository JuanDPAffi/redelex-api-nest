import { IsNotEmpty, IsString, IsOptional, IsObject } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  // Si llega esto, es una consulta de proceso. Si no, es soporte general.
  @IsOptional()
  @IsObject()
  metadata?: {
    procesoId?: number | string;
    radicado?: string;
    cuenta?: string;
    clase?: string;
    etapa?: string;
  };
}