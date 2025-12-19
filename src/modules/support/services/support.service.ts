import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { CreateCallTicketDto } from '../dto/call-ticket.dto';

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

  private readonly DEFAULT_OWNER_ID = '81381349';

  constructor(private configService: ConfigService) {}

  private getHeaders() {
    const token = this.configService.get<string>('HUBSPOT_ACCESS_TOKEN');
    if (!token) throw new InternalServerErrorException('HUBSPOT_ACCESS_TOKEN no configurado');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // --- 1. BÚSQUEDA PARA AUTOCOMPLETADO (Front) ---

  async searchHubSpotCompany(nit: string) {
    const searchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'numero_de_identificacion', operator: 'EQ', value: nit }] }],
      properties: [
        'name', 
        'numero_de_identificacion', 
        'hubspot_owner_id'
      ],
      limit: 1
    };

    try {
      // 1. Buscar la empresa
      const response = await axios.post(`${this.hubspotBaseUrl}/companies/search`, searchPayload, { headers: this.getHeaders() });
      
      if (response.data.total > 0) {
        const company = response.data.results[0];
        const ownerId = company.properties.hubspot_owner_id;
        let ownerName = '';

        // 2. Si tiene owner, buscamos su nombre (NUEVO)
        if (ownerId) {
          try {
            // Nota: La API de Owners es diferente a la de Objects, usamos la URL raíz de CRM
            const ownerUrl = 'https://api.hubapi.com/crm/v3/owners'; 
            const ownerResp = await axios.get(`${ownerUrl}/${ownerId}`, { headers: this.getHeaders() });
            const { firstName, lastName } = ownerResp.data;
            ownerName = `${firstName || ''} ${lastName || ''}`.trim();
          } catch (error) {
            this.logger.warn(`No se pudo resolver el nombre del owner ${ownerId}`);
            ownerName = 'No identificado';
          }
        }

        return { 
          found: true, 
          id: company.id, 
          name: company.properties.name, 
          nit: company.properties.numero_de_identificacion,
          // Devolvemos ambos datos:
          ownerId: ownerId,      // El ID (para crear el ticket luego)
          ownerName: ownerName   // El Nombre (para mostrar en el front)
        };
      }
      return { found: false };
    } catch (error) {
      this.logger.error(`Error buscando empresa HS: ${nit}`, error);
      return { found: false };
    }
  }

  async searchHubSpotContact(email: string) {
    const searchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['firstname', 'lastname', 'email', 'phone'],
      limit: 1
    };
    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/contacts/search`, searchPayload, { headers: this.getHeaders() });
      if (response.data.total > 0) {
        const contact = response.data.results[0];
        const fullName = `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim();
        return { 
          found: true, 
          id: contact.id, 
          name: fullName, 
          email: contact.properties.email, 
          phone: contact.properties.phone
        };
      }
      return { found: false };
    } catch (error) {
      this.logger.error(`Error buscando contacto HS: ${email}`, error);
      return { found: false };
    }
  }

  // --- 2. CREACIÓN DEL TICKET DE LLAMADA ---
  async createCallTicket(dto: CreateCallTicketDto, userEmail: string) {
    const headers = this.getHeaders(); // Usamos el helper para obtener headers

    // 1. Resolver IDs
    // Nota: findContactId y findCompanyId son métodos privados que tienes más abajo en tu archivo.
    // Asegúrate de que estén definidos (en tu archivo original lo estaban).
    const contactId = await this.findContactId(dto.contactEmail, headers);
    
    let companyId = null;
    if (dto.companyNit) {
       companyId = await this.findCompanyId(dto.companyNit, dto.contactEmail, headers);
    }

    // 2. Asociaciones
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

    const subject = `Llamada Estados Procesales - ${dto.contactName || 'Desconocido'}`;

    // 3. Payload
    const ticketData = {
      properties: {
        subject: subject,
        tipo_de_solicitud: "Estados procesales",
        hs_ticket_category: "Estados Procesales",
        hubspot_owner_id: this.DEFAULT_OWNER_ID,
        grupo_de_atencion: "Servicio al cliente",
        tipo_de_llamada: dto.callType,
        area_origen_transferencia: dto.transferArea || "",
        consulta: dto.query,
        identificacion_consultado: dto.inquilinoIdentificacion || "",
        nombre_consultado: dto.inquilinoNombre || "",
        numero_cuenta_consultado: dto.cuenta || "", 
        hs_pipeline: "0",
        hs_pipeline_stage: "2"
      },
      associations: associations
    };

    try {
      const response = await axios.post(`${this.hubspotBaseUrl}/tickets`, ticketData, { headers });
      return { 
        success: true, 
        ticketId: response.data.id, 
        message: 'Ticket de llamada creado correctamente' 
      };
    } catch (error) {
      // CAPTURAR EL ERROR REAL DE HUBSPOT
      const hubspotError = error?.response?.data;
      this.logger.error('Error creando ticket de llamada', hubspotError || error.message);
      
      // Lanzamos BadRequest con el mensaje específico de HubSpot para verlo en el Front
      throw new BadRequestException(
        hubspotError?.message || 'Error de validación en HubSpot (Revisa logs)'
      );
    }
  }

  // --- 3. CREACIÓN DEL TICKET DE SOPORTE TÉCNICO ---
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
        tipo_de_solicitud: "Estados procesales",
        hs_ticket_category: "Estados Procesales - Soporte",
        grupo_de_atencion: "Servicio al cliente",
        hubspot_owner_id: "81381349",
        hs_pipeline_stage: '1',
        hs_ticket_priority: 'HIGH',
        plataforma_estados_procesales: 'true',
        subject: dto.subject,
        content: finalContent,
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