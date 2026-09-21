import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  /**
   * How many reverse proxies sit in front of this process.
   *
   * The per-address rate limits on login, registration and public
   * verification read `request.ip`. Express only derives that from
   * X-Forwarded-For when told how far to trust the chain; left unset behind a
   * load balancer it reports the balancer on every request and the limits
   * collapse into one shared bucket. Trusting blindly is the opposite error -
   * a client could then forge the header and get a fresh bucket per attempt -
   * so this is a hop count, defaulting to none for local runs.
   */
  const trustProxy = config.get<number>('trustProxyHops') ?? 0;
  if (trustProxy > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything the DTO does not declare, so a client cannot smuggle
      // extra fields into an entity through create().
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new DomainExceptionFilter());

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // HttpOnly session cookie on the API host (cross-site SPA needs this).
    credentials: true,
    maxAge: 3600,
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  const port = config.get<number>('port') ?? 8081;

  const enableSwagger =
    process.env.ENABLE_SWAGGER === 'true' ||
    process.env.NODE_ENV !== 'production';

  if (enableSwagger) {
    const swagger = new DocumentBuilder()
      .setTitle('SANTRACK API')
      .setDescription('Product traceability, inventory and lifecycle management')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('api-docs', app, document);
  }

  await app.listen(port, '0.0.0.0');

  console.log(`SANTRACK API listening on http://0.0.0.0:${port}`);
  if (!enableSwagger) {
    console.log('Swagger UI disabled in production (set ENABLE_SWAGGER=true to expose).');
  }
}

void bootstrap();
