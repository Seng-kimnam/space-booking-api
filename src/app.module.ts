import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configurations, databaseConfig } from './configuration';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { SeatsModule } from './seats/seats.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configurations }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    UsersModule,
    RolesModule,
    AuthModule,
    SeatsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
