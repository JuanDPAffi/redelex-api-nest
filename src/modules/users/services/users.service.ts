import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, ValidRoles } from '../../auth/schemas/user.schema';
import { DEFAULT_ROLE_PERMISSIONS } from '../../../common/constants/permissions.constant';
import { UpdateUserDto } from '../dto/update-user.dto'; // Importa el DTO que acabamos de crear
import { Inmobiliaria, InmobiliariaDocument } from '../../inmobiliaria/schema/inmobiliaria.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Inmobiliaria.name) private readonly inmoModel: Model<InmobiliariaDocument>,
  ) {}

  // 1. Listar todos los usuarios
  async findAll() {
    return this.userModel.find()
      .select('-password -activationToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  // 2. Buscar uno por ID
  async findOne(id: string) {
    const user = await this.userModel.findById(id).select('-password -activationToken');
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // 3. Cambiar estado (Activar/Desactivar) -> Usado con permiso USERS_ACTIVATE
  async toggleStatus(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    user.isActive = !user.isActive;
    await user.save();

    return {
      message: `Usuario ${user.isActive ? 'activado' : 'desactivado'} correctamente`,
      isActive: user.isActive,
      id: user._id
    };
  }

  // 4. NUEVO: Cambiar Rol (y resetear permisos)
  async changeUserRole(userId: string, newRole: string) {
    // Validamos que sea un rol real
    if (!Object.values(ValidRoles).includes(newRole as ValidRoles)) {
       throw new BadRequestException('El rol proporcionado no es válido');
    }

    // Buscamos qué permisos por defecto tocan
    const defaultPermissions = DEFAULT_ROLE_PERMISSIONS[newRole] || [];

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { 
        role: newRole,
        permissions: defaultPermissions // <--- RESETEAMOS LOS PERMISOS
      },
      { new: true }
    ).select('-password');

    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // 5. NUEVO: Asignar Permisos Manuales (Personalización)
  async updatePermissions(userId: string, permissions: string[]) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { permissions: permissions }, // Reemplazamos el array custom
      { new: true }
    ).select('-password');

    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async update(id: string, updateDto: UpdateUserDto) {
    // 1. Obtenemos el usuario ACTUAL (antes de los cambios)
    const currentUser = await this.userModel.findById(id);
    if (!currentUser) throw new NotFoundException('Usuario no encontrado');

    // 2. Verificamos si hubo CAMBIO DE INMOBILIARIA (cambió el NIT)
    // Solo aplica si el usuario es Rol Inmobiliaria y el DTO trae un NIT diferente
    const isChangeInmo = updateDto.nit && updateDto.nit !== currentUser.nit;

    if (isChangeInmo) {
      const emailUsuario = updateDto.email || currentUser.email; // Usar el nuevo si lo cambió, o el viejo

      // A. LIBERAR LA VIEJA: Buscar la inmobiliaria anterior y quitarle el email
      if (currentUser.nit) {
        await this.inmoModel.findOneAndUpdate(
          { nit: currentUser.nit },
          { $set: { emailRegistrado: null } } // O string vacío ""
        );
      }

      // B. OCUPAR LA NUEVA: Buscar la nueva inmobiliaria y ponerle el email
      if (updateDto.nit) {
        await this.inmoModel.findOneAndUpdate(
          { nit: updateDto.nit },
          { $set: { emailRegistrado: emailUsuario } }
        );
      }
    }

    // 3. Actualizamos al usuario normalmente
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { $set: updateDto },
      { new: true }
    ).select('-password -activationToken');

    return updatedUser;
  }
}