import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedelexController } from './controllers/redelex.controller';
import { RedelexService } from './services/redelex.service';
import { RedelexToken, RedelexTokenSchema } from './schemas/redelex-token.schema';
import { CedulaProceso, CedulaProcesoSchema } from './schemas/cedula-proceso.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RedelexToken.name, schema: RedelexTokenSchema },
      { name: CedulaProceso.name, schema: CedulaProcesoSchema },
    ]),
    AuthModule,
  ],
  controllers: [RedelexController],
  providers: [RedelexService],
  exports: [RedelexService], 
})
export class RedelexModule {}