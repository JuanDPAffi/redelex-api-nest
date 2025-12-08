import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as xlsx from 'xlsx';
import { Inmobiliaria, InmobiliariaDocument } from '../schema/inmobiliaria.schema';
import { CreateInmobiliariaDto, UpdateInmobiliariaDto } from '../dto/inmobiliaria.dto';

@Injectable()
export class InmobiliariaService {
  // 1. LISTA DE NITS INTOCABLES
  private readonly PROTECTED_NITS = ['900053370']; 

  constructor(
    @InjectModel(Inmobiliaria.name) private readonly inmoModel: Model<InmobiliariaDocument>,
  ) {}

  // ... (tus métodos create, findAll, etc. siguen igual) ...
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

  async update(id: string, updateDto: UpdateInmobiliariaDto) {
    const updatedInmo = await this.inmoModel.findByIdAndUpdate(id, updateDto, { new: true });
    if (!updatedInmo) throw new NotFoundException('Inmobiliaria no encontrada');
    return updatedInmo;
  }

  async toggleStatus(id: string) {
    const inmo = await this.inmoModel.findById(id);
    if (!inmo) throw new NotFoundException('Inmobiliaria no encontrada');
    inmo.isActive = !inmo.isActive;
    await inmo.save();
    return { message: `Inmobiliaria ${inmo.isActive ? 'activada' : 'desactivada'}`, isActive: inmo.isActive };
  }

  // --- LÓGICA DE IMPORTACIÓN MEJORADA (COMPARACIÓN REAL) ---
  async importInmobiliarias(file: Express.Multer.File) {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    const rawData = xlsx.utils.sheet_to_json(sheet);

    if (!rawData || rawData.length === 0) {
      throw new BadRequestException('El archivo Excel está vacío o no tiene formato válido');
    }

    const excelInmos = rawData.map((row: any) => {
      return {
        nit: String(row['NIT'] || row['nit'] || row['Nit'] || '').trim(),
        codigo: String(row['CODIGO'] || row['codigo'] || row['Cod. Inmobiliaria'] || row['Codigo'] || '').trim(),
        nombreInmobiliaria: String(row['NOMBRE'] || row['Inmobiliaria'] || row['nombre'] || row['NOMBRE INMOBILIARIA'] || '').trim(),
      };
    }).filter(item => item.nit && item.codigo);

    if (excelInmos.length === 0) {
      throw new BadRequestException('No se encontraron registros válidos.');
    }

    // 1. Obtener datos actuales para comparar
    const currentInmosDocs = await this.inmoModel.find().select('nit codigo nombreInmobiliaria isActive');
    
    // Creamos un MAPA para búsqueda rápida O(1) y comparación
    const currentMap = new Map();
    currentInmosDocs.forEach(doc => {
      currentMap.set(doc.nit, {
        nombre: doc.nombreInmobiliaria,
        codigo: doc.codigo,
        isActive: doc.isActive
      });
    });

    const excelNits = new Set(excelInmos.map(i => i.nit));

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let unchanged = 0; // Opcional: para saber cuántos ignoramos

    const operations = [];

    // 2. PROCESAR EXCEL (CREATE O UPDATE SI CAMBIÓ)
    for (const item of excelInmos) {
      const existing = currentMap.get(item.nit);

      if (!existing) {
        // CASO: NUEVO
        created++;
        operations.push({
          updateOne: {
            filter: { nit: item.nit },
            update: {
              $set: {
                nombreInmobiliaria: item.nombreInmobiliaria,
                codigo: item.codigo,
                isActive: true 
              },
              $setOnInsert: { emailRegistrado: "" }
            },
            upsert: true
          }
        });
      } else {
        // CASO: EXISTENTE - ¿CAMBIÓ ALGO?
        const hasChanges = 
          existing.nombre !== item.nombreInmobiliaria || 
          existing.codigo !== item.codigo ||
          existing.isActive === false; // Si estaba inactiva, la reactivamos (eso cuenta como update)

        if (hasChanges) {
          updated++;
          operations.push({
            updateOne: {
              filter: { nit: item.nit },
              update: {
                $set: {
                  nombreInmobiliaria: item.nombreInmobiliaria,
                  codigo: item.codigo,
                  isActive: true
                }
              }
            }
          });
        } else {
          // CASO: IDÉNTICO - NO HACEMOS NADA
          unchanged++;
        }
      }
    }

    // 3. DELETE CON PROTECCIÓN
    // Comparamos contra las llaves del mapa original
    const nitsToDelete = Array.from(currentMap.keys()).filter(nit => {
      if (excelNits.has(nit)) return false;
      if (this.PROTECTED_NITS.includes(nit)) return false;
      return true;
    });
    
    if (nitsToDelete.length > 0) {
      operations.push({
        deleteMany: { filter: { nit: { $in: nitsToDelete } } }
      });
      deleted = nitsToDelete.length;
    }

    // Solo ejecutamos si hay cambios reales
    if (operations.length > 0) {
      await this.inmoModel.bulkWrite(operations);
    }

    return {
      message: 'Sincronización completada',
      resumen: {
        procesados_excel: excelInmos.length,
        nuevos: created,
        actualizados: updated, // Ahora solo sumará si hubo cambios reales
        eliminados: deleted,
        sin_cambios: unchanged
      }
    };
  }
}