import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
// 1. CAMBIO: Importamos el Guard Híbrido en lugar del JwtAuthGuard
import { SystemOrJwtGuard } from '../../common/guards/system-or-jwt.guard'; 
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('users')
// 2. CAMBIO: Usamos SystemOrJwtGuard. 
// Esto permite entrar con Token de Sistema O con JWT de usuario.
@UseGuards(SystemOrJwtGuard, RolesGuard) 
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin') 
  // NOTA: Como el SystemOrJwtGuard inyecta un usuario con rol 'admin' cuando
  // detecta la llave maestra, este @Roles('admin') dejará pasar al sistema automáticamente.
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id/status')
  @Roles('admin')
  async toggleStatus(@Param('id') id: string) {
    return this.usersService.toggleStatus(id);
  }
}