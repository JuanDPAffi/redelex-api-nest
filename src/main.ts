import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Configuración de CORS para permitir Cookies (Credenciales)
  app.enableCors({
    origin: 'https://estadosprocesales.affi.net', // <--- TU FRONTEND EXACTO
    credentials: true, // <--- Obligatorio para que viajen las cookies
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  // 2. Middleware para leer cookies
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const PORT = process.env.PORT || 4000;
  await app.listen(PORT);
  console.log(`🚀 API Redelex corriendo en puerto ${PORT}`);
}

bootstrap();