import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { SessionSlidingInterceptor } from './common/interceptors/session-sliding.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'https://estadosprocesales.affi.net',
    'http://localhost:4200'
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('⛔ Bloqueado por CORS:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new SessionSlidingInterceptor());
  const PORT = process.env.PORT || 4000;
  await app.listen(PORT);
  console.log(`🚀 API Redelex corriendo en puerto ${PORT}`);
}

bootstrap();

// Desarrollo Finalizado V1 Juan Diego Pinilla Montoya 23/12/2025