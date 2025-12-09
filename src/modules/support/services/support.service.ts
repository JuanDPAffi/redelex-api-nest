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

    // 1. BUSCAR CONTACTO (Siempre)
    const contactId = await this.findContactId(user.email, headers);

    // 2. BUSCAR EMPRESA (Solo si NO es Affi y tiene NIT)
    let companyId = null;
    const isAffi = user.role?.toLowerCase() === 'affi' || user.nit === '900053370';
    
    if (!isAffi && user.nit) {
      companyId = await this.findCompanyId(user.nit, user.email, headers);
    }

    // 3. PREPARAR ASOCIACIONES
    const associations = [];

    // Asociación con Contacto (Tipo 16)
    if (contactId) {
      associations.push({
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }]
      });
    }

    // Asociación con Empresa (Tipo 26)
    if (companyId) {
      associations.push({
        to: { id: companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 26 }]
      });
    }

    // 4. CREAR TICKET
    const enrichedContent = `
      Usuario: ${user.name}
      Email: ${user.email}
      Rol: ${user.role || 'N/A'}
      NIT: ${user.nit || 'N/A'}
      ---------------------------
      ${dto.content}
    `;

    const ticketData = {
      properties: {
        hs_pipeline: '0',
        hs_pipeline_stage: '1',
        hs_ticket_priority: 'HIGH',
        subject: dto.subject,
        content: enrichedContent,
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

  // --- MÉTODOS DE BÚSQUEDA ---

  private async findContactId(email: string, headers: any): Promise<string | null> {
    const searchPayload = {
      filterGroups: [
        {
          filters: [{ propertyName: 'email', operator: 'EQ', value: email }]
        }
      ],
      properties: ['email', 'firstname'],
      limit: 1
    };

    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/contacts/search`, searchPayload, { headers });
      if (response.data.total > 0) {
        return response.data.results[0].id;
      }
    } catch (error) {
      this.logger.warn(`No se pudo buscar el contacto: ${email}`, error.message);
    }
    return null;
  }

  private async findCompanyId(nit: string, email: string, headers: any): Promise<string | null> {
    // Usamos el JSON guía que proporcionaste
    const searchPayload = {
      filterGroups: [
        {
          filters: [{ propertyName: 'numero_de_identificacion', operator: 'EQ', value: nit }]
        },
        // Opcional: Buscar también por correo de la empresa si el NIT falla (OR logic)
        {
           filters: [{ propertyName: 'correo', operator: 'EQ', value: email }]
        }
      ],
      properties: ['name', 'numero_de_identificacion'],
      limit: 1
    };

    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/companies/search`, searchPayload, { headers });
      if (response.data.total > 0) {
        return response.data.results[0].id;
      }
    } catch (error) {
      this.logger.warn(`No se pudo buscar la empresa con NIT: ${nit}`, error.message);
    }
    return null;
  }
}