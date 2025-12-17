import { 
  Controller, Get, Post, Put, Patch, Body, Param, UseGuards, 
  UseInterceptors, UploadedFile, BadRequestException, 
  Req // <--- Importante: Debe estar importado aquí
} from '@nestjs/common';
import { InmobiliariaService } from '../services/inmobiliaria.service';
import { CreateInmobiliariaDto, UpdateInmobiliariaDto } from '../dto/inmobiliaria.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions.constant';

@Controller('inmobiliarias')
@UseGuards(SystemOrJwtGuard, RolesGuard)
export class InmobiliariaController {
  constructor(private readonly inmoService: InmobiliariaService) {}

  @Post()
  @Permissions(PERMISSIONS.INMO_CREATE)
  async create(@Body() createDto: CreateInmobiliariaDto) {
    return this.inmoService.create(createDto);
  }

  @Get()
  @Permissions(PERMISSIONS.INMO_VIEW)
  async findAll() {
    return this.inmoService.findAll();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.INMO_VIEW)
  async findOne(@Param('id') id: string) {
    return this.inmoService.findOne(id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.INMO_EDIT)
  async update(
    @Param('id') id: string, 
    @Body() updateDto: UpdateInmobiliariaDto,
    @Req() req: any // <--- Usamos 'any' para acceder a .user sin problemas de tipado estricto
  ) {
    // Obtenemos el email del usuario logueado o 'Sistema' si no existe
    const userEmail = req.user?.email || 'Sistema';
    
    // Pasamos el email como tercer argumento
    return this.inmoService.update(id, updateDto, userEmail);
  }

  @Patch(':id/status')
  @Permissions(PERMISSIONS.INMO_ACTIVATE)
  async toggleStatus(@Param('id') id: string) {
    return this.inmoService.toggleStatus(id);
  }

  @Post('import')
  @Permissions(PERMISSIONS.INMO_IMPORT)
  @UseInterceptors(FileInterceptor('file'))
  async importInmobiliarias(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any
  ) {
    if (!file) throw new BadRequestException('No se ha subido ningún archivo');
    
    const userEmail = req.user?.email || 'Sistema';

    // Pasamos el email como segundo argumento
    return this.inmoService.importInmobiliarias(file, userEmail);
  }
}