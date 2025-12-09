import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SupportService } from '../services/support.service';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { SystemOrJwtGuard } from '../../../common/guards/system-or-jwt.guard';

@Controller('support')
@UseGuards(SystemOrJwtGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('ticket')
  async createTicket(@Req() req, @Body() createDto: CreateTicketDto) {
    // Extraemos todos los datos necesarios del JWT/Request
    const { email, name, nit, role } = req.user;
    
    return this.supportService.createTicket(
      { email, name, nit, role }, // Pasamos el objeto usuario completo
      createDto
    );
  }
}