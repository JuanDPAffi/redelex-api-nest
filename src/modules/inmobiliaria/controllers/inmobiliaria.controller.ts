import { 
  Controller, Get, Post, Put, Patch, Body, Param, UseGuards, 
  UseInterceptors, UploadedFile, BadRequestException 
} from '@nestjs/common';
import { InmobiliariaService } from '../services/inmobiliaria.service';
import { CreateInmobiliariaDto, UpdateInmobiliariaDto } from '../dto/inmobiliaria.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions.constant';

@Controller('inmobiliarias')
@UseGuards(SystemOrJwtGuard, RolesGuard) // Protegemos todo el controlador
export class InmobiliariaController {
  constructor(private readonly inmoService: InmobiliariaService) {}

  @Post()
  @Permissions(PERMISSIONS.INMO_CREATE) // Solo quien tenga permiso de crear
  async create(@Body() createDto: CreateInmobiliariaDto) {
    return this.inmoService.create(createDto);
  }

  @Get()
  @Permissions(PERMISSIONS.INMO_VIEW) // Solo quien tenga permiso de ver
  async findAll() {
    return this.inmoService.findAll();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.INMO_VIEW)
  async findOne(@Param('id') id: string) {
    return this.inmoService.findOne(id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.INMO_EDIT) // Solo quien tenga permiso de editar
  async update(@Param('id') id: string, @Body() updateDto: UpdateInmobiliariaDto) {
    return this.inmoService.update(id, updateDto);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.INMO_ACTIVATE) // Permiso delicado: activar/desactivar
  async toggleStatus(@Param('id') id: string) {
    return this.inmoService.toggleStatus(id);
  }

  @Post('import')
  @Permissions(PERMISSIONS.INMO_IMPORT)
  @UseInterceptors(FileInterceptor('file')) // Nombre del campo en el form-data
  async importInmobiliarias(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se ha subido ningún archivo');
    return this.inmoService.importInmobiliarias(file);
  }
}