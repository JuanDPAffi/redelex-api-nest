import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as xlsx from 'xlsx';
import { Inmobiliaria, InmobiliariaDocument } from '../schema/inmobiliaria.schema';
import { User, UserDocument } from '../../auth/schemas/user.schema';
import { CreateInmobiliariaDto, UpdateInmobiliariaDto } from '../dto/inmobiliaria.dto';

@Injectable()
export class InmobiliariaService {
  private readonly PROTECTED_NITS = ['900053370']; 

  constructor(
    @InjectModel(Inmobiliaria.name) private readonly inmoModel: Model<InmobiliariaDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  // ... (create, findAll, findOne, update, toggleStatus se mantienen IGUALES) ...
  async create(createDto: CreateInmobiliariaDto) {
    const existing = await this.inmoModel.findOne({ nit: createDto.nit, codigo: createDto.codigo });
    if (existing) throw new ConflictException('Ya existe una inmobiliaria con ese NIT y Código');
    const newInmo = new this.inmoModel(createDto);
    return newInmo.save();
  }

  async findAll() {
    return this.inmoModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string) {
    const inmo = await this.inmoModel.findById(id);
    if (!inmo) throw new NotFoundException('Inmobiliaria no encontrada');
    return inmo;
  }

  async update(id: string, updateDto: UpdateInmobiliariaDto, userEmail: string = 'Sistema') {
    const dataToUpdate = {
      ...updateDto,
      modifiedBy: userEmail,
      modificationSource: 'Edición Manual'
    };
    const updatedInmo = await this.inmoModel.findByIdAndUpdate(id, dataToUpdate, { new: true });
    if (!updatedInmo) throw new NotFoundException('Inmobiliaria no encontrada');
    
    if (updateDto.isActive !== undefined) {
       await this.syncUserStatus(updatedInmo.nit, updatedInmo.isActive);
    }
    return updatedInmo;
  }

  async toggleStatus(id: string) {
    const inmo = await this.inmoModel.findById(id);
    if (!inmo) throw new NotFoundException('Inmobiliaria no encontrada');
    inmo.isActive = !inmo.isActive;
    await inmo.save();
    await this.syncUserStatus(inmo.nit, inmo.isActive);
    return { message: `Inmobiliaria y usuarios ${inmo.isActive ? 'activados' : 'desactivados'}`, isActive: inmo.isActive };
  }

  private async syncUserStatus(nit: string, isActive: boolean) {
    await this.userModel.updateMany({ nit: nit }, { $set: { isActive: isActive } });
  }

  // --- LÓGICA DE IMPORTACIÓN ACTUALIZADA ---
  async importInmobiliarias(file: Express.Multer.File, userEmail: string = 'Sistema') {
    const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('El archivo Excel está vacío o no tiene formato válido');
    }

    // 1. DEDUPLICACIÓN EN MEMORIA (Solo agarramos el primero por NIT)
    const uniqueRawData = new Map<string, any>();

    rawData.forEach((row: any) => {
      const nit = String(row['Nit'] || row['NIT'] || '').trim();
      // Si el NIT existe y no lo hemos procesado aún, lo guardamos.
      // Si ya existe en el mapa, lo ignoramos (esto elimina los duplicados de oficinas).
      if (nit && !uniqueRawData.has(nit)) {
        uniqueRawData.set(nit, row);
      }
    });

    const uniqueRows = Array.from(uniqueRawData.values());

    // 2. MAPEO DE COLUMNAS SEGÚN TU EXCEL
    const excelInmos = uniqueRows.map((row: any) => {
      // Determinamos si está activa según la columna del Excel
      const estadoExcel = String(row['Estado Inmobiliaria'] || '').trim();
      const isActiveRow = estadoExcel === 'Activa'; // Solo es true si dice "Activa"

      return {
        nit: String(row['Nit'] || row['NIT'] || '').trim(),
        codigo: String(row['Cod. Inmobiliaria'] || row['Cod Inmobiliaria'] || '').trim(),
        nombreInmobiliaria: String(row['Inmobiliaria'] || row['NOMBRE'] || '').trim(),
        fechaInicioFianza: row['Fecha Incio Fianza'] || row['Fecha Inicio'] || null,
        departamento: String(row['Departamento'] || '').trim(),
        ciudad: String(row['Ciudad'] || '').trim(),
        telefono: String(row['Telefono'] || '').trim(),
        emailContacto: String(row['Email'] || row['EMAIL'] || '').trim().toLowerCase(), 
        isActive: isActiveRow 
      };
    }).filter(item => item.nit && item.codigo); // Filtro final de seguridad

    if (excelInmos.length === 0) throw new BadRequestException('No se encontraron registros válidos.');

    const currentInmosDocs = await this.inmoModel.find().select('nit codigo isActive');
    const currentNitsMap = new Set(currentInmosDocs.map(d => d.nit));
    const excelNits = new Set(excelInmos.map(i => i.nit));

    let created = 0;
    let updated = 0;
    let deactivated = 0;

    const inmoOperations = [];
    const nitsToUpdateUsers: { nit: string, isActive: boolean }[] = [];

    // 3. PROCESAR EXCEL (CREAR O ACTUALIZAR)
    for (const item of excelInmos) {
        // Preparamos operación DB
        inmoOperations.push({
          updateOne: {
            filter: { nit: item.nit },
            update: {
              $set: {
                nombreInmobiliaria: item.nombreInmobiliaria,
                codigo: item.codigo,
                fechaInicioFianza: item.fechaInicioFianza,
                departamento: item.departamento,
                ciudad: item.ciudad,
                telefono: item.telefono,
                emailContacto: item.emailContacto,
                isActive: item.isActive, // <--- Aquí usamos el estado calculado del Excel ("Activa" o no)
                
                // Auditoría
                modifiedBy: userEmail,
                modificationSource: 'Importación Excel'
              },
              $setOnInsert: { emailRegistrado: null }
            },
            upsert: true
          }
        });

        // Guardamos el NIT y el estado para sincronizar usuarios luego
        nitsToUpdateUsers.push({ nit: item.nit, isActive: item.isActive });

        if (currentNitsMap.has(item.nit)) {
          updated++;
        } else {
          created++;
        }
    }

    // 4. INACTIVAR LOS QUE NO ESTÁN EN EL EXCEL
    const nitsToDeactivate = Array.from(currentNitsMap).filter(nit => {
      if (excelNits.has(nit)) return false; // Está en el Excel, ya lo procesamos arriba
      if (this.PROTECTED_NITS.includes(nit)) return false; 
      return true; // No está, inactivar
    });
    
    if (nitsToDeactivate.length > 0) {
      inmoOperations.push({
        updateMany: {
          filter: { nit: { $in: nitsToDeactivate } },
          update: { 
            $set: { 
              isActive: false, // Inactivamos porque ya no viene en el archivo
              modifiedBy: userEmail,
              modificationSource: 'Inactivación Masiva por Excel'
            } 
          }
        }
      });
      deactivated = nitsToDeactivate.length;
      
      // Agregamos a la lista de sincronización de usuarios
      nitsToDeactivate.forEach(nit => nitsToUpdateUsers.push({ nit, isActive: false }));
    }

    // 5. EJECUTAR OPERACIONES DB
    if (inmoOperations.length > 0) {
      await this.inmoModel.bulkWrite(inmoOperations);
    }

    // 6. SINCRONIZAR USUARIOS (Lógica optimizada)
    // Separamos en dos grupos para hacer solo 2 consultas grandes en vez de una por una
    const nitsToActivate = nitsToUpdateUsers.filter(x => x.isActive).map(x => x.nit);
    const nitsToBlock = nitsToUpdateUsers.filter(x => !x.isActive).map(x => x.nit);

    if (nitsToActivate.length > 0) {
      await this.userModel.updateMany({ nit: { $in: nitsToActivate } }, { $set: { isActive: true } });
    }

    if (nitsToBlock.length > 0) {
      await this.userModel.updateMany({ nit: { $in: nitsToBlock } }, { $set: { isActive: false } });
    }

    return {
      message: 'Sincronización completada',
      resumen: {
        procesados_excel: excelInmos.length, // Cantidad ÚNICA (sin duplicados)
        nuevos: created,
        actualizados: updated,
        inactivados: deactivated 
      }
    };
  }
}