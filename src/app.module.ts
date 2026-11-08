import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { configurations, databaseConfig } from './configuration';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    // Global: database, redis and mail config are injectable in every module.
    ConfigModule.forRoot({ isGlobal: true, load: configurations }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    UsersModule,
    RolesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
