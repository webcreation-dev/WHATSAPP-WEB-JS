import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  imports: [
    HttpModule.register({
      baseURL: process.env.BACKEND_URL || 'http://localhost:4000',
      timeout: 10000,
      maxRedirects: 3,
    })
  ],
  providers: [WhatsAppService],
  controllers: [WhatsAppController],
  exports: [WhatsAppService],
})
export class WhatsAppModule { }