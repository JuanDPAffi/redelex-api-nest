import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { CreateTicketDto } from '../dto/create-ticket.dto';

interface UserContext {
  email: string;
  name: string;
  nit?: string;
  role?: string;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly hubspotBaseUrl = 'https://api.hubapi.com/crm/v3/objects';

  constructor(private configService: ConfigService) {}

  async createTicket(user: UserContext, dto: CreateTicketDto) {
    const token = this.configService.get<string>('HUBSPOT_ACCESS_TOKEN');
    
    if (!token) {
      this.logger.error('HUBSPOT_ACCESS_TOKEN no configurado');
      throw new InternalServerErrorException('Error de configuración en soporte');
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // 1. BUSCAR CONTACTO Y EMPRESA (Lógica existente)
    const contactId = await this.findContactId(user.email, headers);

    let companyId = null;
    const isAffi = user.role?.toLowerCase() === 'affi' || user.nit === '900053370';
    
    if (!isAffi && user.nit) {
      companyId = await this.findCompanyId(user.nit, user.email, headers);
    }

    // 2. PREPARAR ASOCIACIONES
    const associations = [];
    if (contactId) {
      associations.push({
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }]
      });
    }
    if (companyId) {
      associations.push({
        to: { id: companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 26 }]
      });
    }

    // 3. CONSTRUIR CONTENIDO INTELIGENTE (Nueva Lógica)
    let headerInfo = '';
    
    // CASO A: TICKET DE PROCESO (Viene con metadata)
    if (dto.metadata) {
      // Prefijo automático si no lo trae
      if (!dto.subject.startsWith('[APOYO JURÍDICO]')) {
        dto.subject = `[APOYO JURÍDICO] ${dto.subject}`;
      }

      headerInfo = `
================================
SOLICITUD DE APOYO JURÍDICO
================================
ID Proceso: ${dto.metadata.procesoId || 'N/A'}
Radicado: ${dto.metadata.radicado || 'N/A'}
Cuenta: ${dto.metadata.cuenta || 'N/A'}
Clase: ${dto.metadata.clase || 'N/A'}
Etapa Actual: ${dto.metadata.etapa || 'N/A'}
      `;
    } 
    // CASO B: TICKET DE SOPORTE TÉCNICO (Sin metadata)
    else {
      if (!dto.subject.startsWith('[SOPORTE]')) {
        dto.subject = `[SOPORTE] ${dto.subject}`;
      }
      
      headerInfo = `
================================
SOPORTE TÉCNICO - PLATAFORMA
================================
      `;
    }

    // Información del Usuario (Común para ambos)
    const userInfo = `
Usuario: ${user.name}
Email: ${user.email}
Rol: ${user.role || 'N/A'}
NIT: ${user.nit || 'N/A'}
--------------------------------
    `;

    // Ensamblar cuerpo final
    const finalContent = `
${headerInfo}
${userInfo}

MENSAJE DEL USUARIO:
${dto.content}
    `.trim();

    // 4. CREAR TICKET EN HUBSPOT
    const ticketData = {
      properties: {
        hs_pipeline: '0',
        hs_pipeline_stage: '1',
        hs_ticket_priority: 'HIGH',
        subject: dto.subject,
        content: finalContent, // Enviamos el contenido formateado
      },
      associations: associations.length > 0 ? associations : undefined
    };

    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/tickets`, ticketData, { headers });
      return { success: true, ticketId: response.data.id, associations: associations.length };
    } catch (error) {
      this.logger.error('Error creando ticket en HubSpot', error?.response?.data || error);
      throw new InternalServerErrorException('No se pudo crear el ticket de soporte');
    }
  }

  // --- MÉTODOS DE BÚSQUEDA (Sin cambios) ---

  private async findContactId(email: string, headers: any): Promise<string | null> {
    const searchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email'],
      limit: 1
    };
    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/contacts/search`, searchPayload, { headers });
      return response.data.total > 0 ? response.data.results[0].id : null;
    } catch (error) {
      this.logger.warn(`No se pudo buscar contacto: ${email}`);
      return null;
    }
  }

  private async findCompanyId(nit: string, email: string, headers: any): Promise<string | null> {
    const searchPayload = {
      filterGroups: [
        { filters: [{ propertyName: 'numero_de_identificacion', operator: 'EQ', value: nit }] },
        { filters: [{ propertyName: 'correo', operator: 'EQ', value: email }] }
      ],
      properties: ['numero_de_identificacion'],
      limit: 1
    };
    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/companies/search`, searchPayload, { headers });
      return response.data.total > 0 ? response.data.results[0].id : null;
    } catch (error) {
      this.logger.warn(`No se pudo buscar empresa NIT: ${nit}`);
      return null;
    }
  }
}