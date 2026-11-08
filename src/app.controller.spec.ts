import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getHealth', () => {
    it('should report the API as running', () => {
      const result = appController.getHealth();

      expect(result.status).toBe('ok');
      expect(result.message).toBe('Space Booking API is running successfully');
    });

    it('should return a valid ISO timestamp and a non-negative uptime', () => {
      const result = appController.getHealth();

      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
      expect(Number.isInteger(result.uptime)).toBe(true);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
